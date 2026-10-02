import * as ng from '@angular/compiler';
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

  name(text: string, offset: number): void {
    this.names.push({
      start: this.text.length,
      end: this.text.length + text.length,
      owner: this.owner,
      offset,
      file: this.file,
    });
    this.text += text;
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

/**
 * Writes a template's statements as the body of a function whose `this` is the component:
 * every expression becomes a statement, `@for`/`*ngFor` loops become `for…of` over their
 * collection, aliases (`@if (x; as y)`, `*ngIf="x as y"`) constants, and other template locals
 * (`let-`, `#ref`, `@for` context variables) `any`-typed variables in the block of their view.
 */
export function writeTemplate(parsed: ParsedTemplate, out: Out): void {
  const scope: Scope = { bound: parsed.bound, params: new Set(), event: false };
  view(parsed.nodes, out, scope, '  ');
}

function view(nodes: readonly ng.TmplAstNode[], out: Out, scope: Scope, indent: string): void {
  // References (`#box`) are visible anywhere in their view, before their element too.
  for (const ref of viewReferences(nodes)) out.write(`${indent}let ${ref.name}: any;\n`);
  for (const node of nodes) writeNode(node, out, scope, indent);
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

function writeNode(node: ng.TmplAstNode, out: Out, scope: Scope, indent: string): void {
  const inner = `${indent}  `;
  if (node instanceof ng.TmplAstBoundText) {
    statement(node.value, out, scope, indent);
  } else if (node instanceof ng.TmplAstElement) {
    for (const input of node.inputs) statement(input.value, out, scope, indent);
    for (const output of node.outputs) event(output.handler, out, scope, indent);
    for (const child of node.children) writeNode(child, out, scope, indent);
  } else if (node instanceof ng.TmplAstTemplate) {
    writeTemplateNode(node, out, scope, indent);
  } else if (node instanceof ng.TmplAstContent) {
    for (const child of node.children) writeNode(child, out, scope, indent);
  } else if (node instanceof ng.TmplAstForLoopBlock) {
    out.write(`${indent}for (const ${node.item.name} of (`);
    writeExpression(node.expression, out, scope);
    out.write(')!) {\n');
    for (const variable of node.contextVariables) out.write(`${inner}let ${variable.name}: any;\n`);
    statement(node.trackBy, out, scope, inner);
    view(node.children, out, scope, inner);
    out.write(`${indent}}\n`);
    if (node.empty) block(node.empty.children, out, scope, indent);
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
      view(branch.children, out, scope, inner);
      out.write(`${indent}}\n`);
    }
  } else if (node instanceof ng.TmplAstSwitchBlock) {
    statement(node.expression, out, scope, indent);
    for (const group of node.groups) {
      out.write(`${indent}{\n`);
      for (const c of group.cases) if (c.expression) statement(c.expression, out, scope, inner);
      view(group.children, out, scope, inner);
      out.write(`${indent}}\n`);
    }
  } else if (node instanceof ng.TmplAstDeferredBlock) {
    for (const trigger of deferTriggers(node)) {
      if (trigger instanceof ng.TmplAstBoundDeferredTrigger) {
        statement(trigger.value, out, scope, indent);
      }
    }
    block(node.children, out, scope, indent);
    for (const part of [node.placeholder, node.loading, node.error]) {
      if (part) block(part.children, out, scope, indent);
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

function block(nodes: readonly ng.TmplAstNode[], out: Out, scope: Scope, indent: string): void {
  out.write(`${indent}{\n`);
  view(nodes, out, scope, `${indent}  `);
  out.write(`${indent}}\n`);
}

/**
 * An `<ng-template>` or a structural directive (`*ngFor`, `*ngIf`). Its bindings are read in the
 * outer view, its variables live in its own. `ngFor` and `ngIf` are known by name: the loop
 * variable is an item of the collection, the alias the condition's value.
 */
function writeTemplateNode(node: ng.TmplAstTemplate, out: Out, scope: Scope, indent: string): void {
  const inner = `${indent}  `;
  const bound = (name: string) =>
    node.templateAttrs.find(
      (a): a is ng.TmplAstBoundAttribute =>
        a instanceof ng.TmplAstBoundAttribute && a.name === name,
    );
  const forOf = bound('ngForOf');
  const ngIf = bound('ngIf');
  const special = forOf ?? ngIf;

  // `<div *ngFor>`'s own bindings belong to the `<div>` inside; only `<ng-template>` has its own.
  if (node.tagName === 'ng-template') {
    for (const input of node.inputs) statement(input.value, out, scope, indent);
    for (const output of node.outputs) event(output.handler, out, scope, indent);
  }
  for (const attr of node.templateAttrs) {
    if (attr instanceof ng.TmplAstBoundAttribute && attr !== special) {
      statement(attr.value, out, scope, indent);
    }
  }

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
  view(node.children, out, scope, inner);
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
