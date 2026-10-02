import * as ng from '@angular/compiler';
import type { NgClass } from './classes.js';
import { directiveSite, isMeta, type Meta } from './directives.js';
import { writeExpression, writeStatements, type Out, type Scope } from './expressions.js';
import { deferTriggers, type ParsedTemplate } from './template.js';

/** A name in the shim and where it came from. */
export interface MappedName {
  start: number;
  end: number;
  owner: string;
  /** Offset in the source file (the template, or the `.ts` for inline templates and hosts). */
  offset: number;
  file: string;
  /** Not certainly a use: one of several components matching an element. */
  possible: boolean;
}

/** Builds a shim's text and remembers where each template name landed in it. */
export class ShimBuilder implements Out {
  text = '';
  readonly names: MappedName[] = [];
  private owner = '';
  private file = '';

  write(text: string): void {
    this.text += text;
  }

  name(text: string, offset: number, possible = false): void {
    this.names.push({
      start: this.text.length,
      end: this.text.length + text.length,
      owner: this.owner,
      offset,
      file: this.file,
      possible,
    });
    this.text += text;
  }

  /** Adds text before everything written so far (imports known only at the end). */
  prepend(text: string): void {
    this.text = text + this.text;
    for (const name of this.names) {
      name.start += text.length;
      name.end += text.length;
    }
  }

  /** Names written from now on belong to `owner` and come from `file`. */
  source(owner: string, file: string): void {
    this.owner = owner;
    this.file = file;
  }

  /** The mapped name at a shim offset, if any. */
  at(offset: number): MappedName | undefined {
    let low = 0;
    let high = this.names.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const name = this.names[mid] as MappedName;
      if (offset < name.start) high = mid - 1;
      else if (offset >= name.end) low = mid + 1;
      else return name;
    }
    return undefined;
  }
}

/** What a template's shim refers to besides its component: the repo's directives and pipes. */
export interface Repo {
  bound: ng.BoundTarget<Meta>;
  /** The shim's name for a repo class, importing it; undefined if it cannot be imported. */
  use(cls: NgClass): string | undefined;
  pipes: ReadonlyMap<string, NgClass>;
}

interface Ctx {
  out: Out;
  repo: Repo;
  /** Counter for the shim's own locals. */
  locals: { next: number };
}

/** `Table<T>` → `__cpr_D0<any>`. */
export function typeOf(alias: string, cls: NgClass): string {
  return cls.typeParameters > 0
    ? `${alias}<${Array.from({ length: cls.typeParameters }, () => 'any').join(', ')}>`
    : alias;
}

/**
 * Writes a template's statements as the body of a function whose `this` is the component:
 * every expression becomes a statement, `@for`/`*ngFor` loops become `for…of` over their
 * collection, aliases (`@if (x; as y)`, `*ngIf="x as y"`) constants, and other template locals
 * (`let-`, `#ref`, `@for` context variables) `any`-typed variables in the block of their view.
 * An element matching a repo component or directive references its class; its bindings set
 * the directive's inputs and listen to its outputs; a repo pipe calls `transform`.
 */
export function writeTemplate(parsed: ParsedTemplate, out: Out, repo: Repo): void {
  const scope: Scope = {
    bound: repo.bound,
    params: new Set(),
    event: false,
    pipe: (name) => {
      const cls = repo.pipes.get(name);
      return cls && repo.use(cls);
    },
  };
  view(parsed.nodes, { out, repo, locals: { next: 0 } }, scope, '  ');
}

function view(nodes: readonly ng.TmplAstNode[], ctx: Ctx, scope: Scope, indent: string): void {
  // References (`#box`) are visible anywhere in their view, before their element too. One to a
  // repo directive (`#p="appPreview"`, or on a component's element) has its class's type.
  for (const ref of viewReferences(nodes)) {
    const target = ctx.repo.bound.getReferenceTarget(ref);
    const directive = target && 'directive' in target ? target.directive : undefined;
    const alias = isMeta(directive) ? ctx.repo.use(directive.ref.cls) : undefined;
    ctx.out.write(
      alias && isMeta(directive)
        ? `${indent}let ${ref.name}!: ${typeOf(alias, directive.ref.cls)};\n`
        : `${indent}let ${ref.name}: any;\n`,
    );
  }
  for (const node of nodes) writeNode(node, ctx, scope, indent);
}

function viewReferences(nodes: readonly ng.TmplAstNode[]): ng.TmplAstReference[] {
  const found: ng.TmplAstReference[] = [];
  const names = new Set<string>();
  const walk = (list: readonly ng.TmplAstNode[]) => {
    for (const node of list) {
      if (node instanceof ng.TmplAstElement || node instanceof ng.TmplAstTemplate) {
        for (const ref of node.references) {
          if (!names.has(ref.name)) found.push(ref);
          names.add(ref.name);
        }
      }
      // An element's children share its view; a template's children are a view of their own.
      if (node instanceof ng.TmplAstElement || node instanceof ng.TmplAstContent) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return found;
}

function statement(ast: ng.AST, out: Out, scope: Scope, indent: string): void {
  out.write(indent);
  writeExpression(ast, out, scope);
  out.write(';\n');
}

function event(handler: ng.AST, out: Out, scope: Scope, indent: string): void {
  out.write(`${indent}(($event: any) => {\n`);
  writeStatements(handler, out, { ...scope, event: true }, `${indent}  `);
  out.write(`${indent}});\n`);
}

/**
 * The directives an element or template matches and its bindings: inputs set on the
 * directive that declares them, outputs subscribed to, anything else read as an expression.
 */
function writeBindings(
  node: ng.TmplAstElement | ng.TmplAstTemplate,
  ctx: Ctx,
  scope: Scope,
  indent: string,
  skip: ReadonlySet<ng.TmplAstBoundAttribute> = new Set(),
): void {
  const { out, repo } = ctx;
  const metas = (repo.bound.getDirectivesOfNode(node) ?? []).filter(isMeta);
  // Two components cannot share an element in a compiling app: global matching found more.
  const possible = metas.filter((m) => m.isComponent).length > 1;
  const instances = new Map<Meta, string>();
  const inner = `${indent}  `;
  for (const meta of metas) {
    const alias = repo.use(meta.ref.cls);
    if (!alias) continue;
    if (instances.size === 0) out.write(`${indent}{\n`);
    const instance = `__cpr_d${ctx.locals.next++}`;
    out.write(`${inner}const ${instance} = null! as ${typeOf(alias, meta.ref.cls)};\n${inner}`);
    out.name(alias, directiveSite(node, meta.selector), possible && meta.isComponent);
    out.write('();\n');
    instances.set(meta, instance);
  }
  const at = instances.size > 0 ? inner : indent;
  const target = (
    binding: ng.TmplAstBoundAttribute | ng.TmplAstBoundEvent | ng.TmplAstTextAttribute,
  ) => {
    const consumer = repo.bound.getConsumerOfBinding(binding);
    if (!isMeta(consumer)) return undefined;
    const instance = instances.get(consumer);
    const fields = binding instanceof ng.TmplAstBoundEvent ? consumer.outputs : consumer.inputs;
    const field = fields.getByBindingPropertyName(binding.name)?.[0]?.classPropertyName;
    return instance && field
      ? { instance, field, possible: possible && consumer.isComponent }
      : undefined;
  };
  const key = (binding: { keySpan?: ng.ParseSourceSpan; sourceSpan: ng.ParseSourceSpan }) =>
    (binding.keySpan ?? binding.sourceSpan).start.offset;

  const isTemplate = node instanceof ng.TmplAstTemplate;
  // `<div *ngFor>`'s own bindings belong to the `<div>` inside; only `<ng-template>` has its own.
  const own = !isTemplate || node.tagName === 'ng-template';
  const attributes = [
    ...(own ? node.attributes : []),
    ...(own ? node.inputs : []),
    ...(isTemplate ? node.templateAttrs : []),
  ];
  for (const attribute of attributes) {
    if (attribute instanceof ng.TmplAstBoundAttribute && skip.has(attribute)) continue;
    const input = target(attribute);
    if (input) {
      out.write(`${at}${input.instance}.`);
      out.name(input.field, key(attribute), input.possible);
      out.write(' = ');
      if (attribute instanceof ng.TmplAstTextAttribute) out.write(JSON.stringify(attribute.value));
      else writeExpression(attribute.value, out, scope);
      out.write(';\n');
    } else if (attribute instanceof ng.TmplAstBoundAttribute) {
      statement(attribute.value, out, scope, at);
    }
  }
  for (const output of own ? node.outputs : []) {
    const listened = target(output);
    if (!listened) {
      event(output.handler, out, scope, at);
      continue;
    }
    out.write(`${at}${listened.instance}.`);
    out.name(listened.field, key(output), listened.possible);
    out.write('.subscribe(($event) => {\n');
    writeStatements(output.handler, out, { ...scope, event: true }, `${at}  `);
    out.write(`${at}});\n`);
  }
  if (instances.size > 0) out.write(`${indent}}\n`);
}

function writeNode(node: ng.TmplAstNode, ctx: Ctx, scope: Scope, indent: string): void {
  const { out } = ctx;
  const inner = `${indent}  `;
  if (node instanceof ng.TmplAstBoundText) {
    statement(node.value, out, scope, indent);
  } else if (node instanceof ng.TmplAstElement) {
    writeBindings(node, ctx, scope, indent);
    for (const child of node.children) writeNode(child, ctx, scope, indent);
  } else if (node instanceof ng.TmplAstTemplate) {
    writeTemplateNode(node, ctx, scope, indent);
  } else if (node instanceof ng.TmplAstContent) {
    for (const child of node.children) writeNode(child, ctx, scope, indent);
  } else if (node instanceof ng.TmplAstForLoopBlock) {
    out.write(`${indent}for (const ${node.item.name} of (`);
    writeExpression(node.expression, out, scope);
    out.write(')!) {\n');
    for (const variable of node.contextVariables) out.write(`${inner}let ${variable.name}: any;\n`);
    statement(node.trackBy, out, scope, inner);
    view(node.children, ctx, scope, inner);
    out.write(`${indent}}\n`);
    if (node.empty) block(node.empty.children, ctx, scope, indent);
  } else if (node instanceof ng.TmplAstIfBlock) {
    for (const branch of node.branches) {
      out.write(`${indent}{\n`);
      if (branch.expression && branch.expressionAlias) {
        out.write(`${inner}const ${branch.expressionAlias.name} = (`);
        writeExpression(branch.expression, out, scope);
        out.write(')!;\n');
      } else if (branch.expression) {
        statement(branch.expression, out, scope, inner);
      }
      view(branch.children, ctx, scope, inner);
      out.write(`${indent}}\n`);
    }
  } else if (node instanceof ng.TmplAstSwitchBlock) {
    statement(node.expression, out, scope, indent);
    for (const group of node.groups) {
      out.write(`${indent}{\n`);
      for (const c of group.cases) if (c.expression) statement(c.expression, out, scope, inner);
      view(group.children, ctx, scope, inner);
      out.write(`${indent}}\n`);
    }
  } else if (node instanceof ng.TmplAstDeferredBlock) {
    for (const trigger of deferTriggers(node)) {
      if (trigger instanceof ng.TmplAstBoundDeferredTrigger) {
        statement(trigger.value, out, scope, indent);
      }
    }
    block(node.children, ctx, scope, indent);
    for (const part of [node.placeholder, node.loading, node.error]) {
      if (part) block(part.children, ctx, scope, indent);
    }
  } else if (node instanceof ng.TmplAstLetDeclaration) {
    out.write(`${indent}const ${node.name} = `);
    writeExpression(node.value, out, scope);
    out.write(';\n');
  } else if (node instanceof ng.TmplAstIcu) {
    for (const part of [...Object.values(node.vars), ...Object.values(node.placeholders)]) {
      if (part instanceof ng.TmplAstBoundText) statement(part.value, out, scope, indent);
    }
  }
}

function block(nodes: readonly ng.TmplAstNode[], ctx: Ctx, scope: Scope, indent: string): void {
  ctx.out.write(`${indent}{\n`);
  view(nodes, ctx, scope, `${indent}  `);
  ctx.out.write(`${indent}}\n`);
}

/**
 * An `<ng-template>` or a structural directive (`*ngFor`, `*ifAuthenticated`). Its bindings are
 * read in the outer view, its variables live in its own. `ngFor` and `ngIf` are known by name:
 * the loop variable is an item of the collection, the alias the condition's value.
 */
function writeTemplateNode(node: ng.TmplAstTemplate, ctx: Ctx, scope: Scope, indent: string): void {
  const { out } = ctx;
  const inner = `${indent}  `;
  const bound = (name: string) =>
    node.templateAttrs.find(
      (a): a is ng.TmplAstBoundAttribute =>
        a instanceof ng.TmplAstBoundAttribute && a.name === name,
    );
  const forOf = bound('ngForOf');
  const ngIf = bound('ngIf');
  const special = forOf ?? ngIf;
  writeBindings(node, ctx, scope, indent, new Set(special ? [special] : []));

  const declared = new Set<string>();
  if (forOf) {
    const item = node.variables.find((v) => v.value === '$implicit');
    out.write(`${indent}for (const ${item?.name ?? '__cpr_item'} of (`);
    writeExpression(forOf.value, out, scope);
    out.write(')!) {\n');
    if (item) declared.add(item.name);
  } else {
    out.write(`${indent}{\n`);
    if (ngIf) {
      const aliases = node.variables.filter((v) => v.value === 'ngIf' || v.value === '$implicit');
      const [first, ...rest] = aliases;
      if (first) {
        out.write(`${inner}const ${first.name} = (`);
        writeExpression(ngIf.value, out, scope);
        out.write(')!;\n');
        for (const alias of rest) out.write(`${inner}const ${alias.name} = ${first.name};\n`);
        for (const alias of aliases) declared.add(alias.name);
      } else {
        statement(ngIf.value, out, scope, inner);
      }
    }
  }
  for (const variable of node.variables) {
    if (!declared.has(variable.name)) out.write(`${inner}let ${variable.name}: any;\n`);
  }
  view(node.children, ctx, scope, inner);
  out.write(`${indent}}\n`);
}

/** Host bindings: `'(event)': 'handler()'` and `'[prop]': 'expression'`. */
export function writeHost(
  host: readonly { key: string; value: { text: string; start: number } }[],
  out: Out,
  url: string,
): string[] {
  const errors: string[] = [];
  const parser = new ng.Parser(new ng.Lexer());
  const scope: Scope = { params: new Set(), event: false, bound: EMPTY_BOUND };
  for (const { key, value } of host) {
    const isEvent = key.startsWith('(') && key.endsWith(')');
    const isProperty = key.startsWith('[') && key.endsWith(']');
    if (!isEvent && !isProperty) continue;
    const file = new ng.ParseSourceFile(value.text, url);
    const location = new ng.ParseLocation(file, 0, 0, 0);
    const span = new ng.ParseSourceSpan(location, location);
    try {
      const ast = isEvent
        ? parser.parseAction(value.text, span, value.start)
        : parser.parseBinding(value.text, span, value.start);
      if (ast.errors.length > 0) {
        errors.push(`host ${key}: ${ast.errors.map((e) => e.msg).join('; ')}`);
        continue;
      }
      if (isEvent) event(ast, out, scope, '  ');
      else statement(ast, out, scope, '  ');
    } catch (error) {
      errors.push(`host ${key}: ${(error as Error).message}`);
    }
  }
  return errors;
}

/** A binder over nothing: host expressions have no template locals. */
const EMPTY_BOUND = new ng.R3TargetBinder(new ng.SelectorMatcher<ng.DirectiveMeta[]>()).bind({
  template: [],
});
