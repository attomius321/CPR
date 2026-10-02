import { posix } from 'node:path';
import type { PluginContext, ts } from '@cpr/core';

type TS = PluginContext['ts'];

/** The class decorators of `@angular/core` the plugin understands. */
export type NgKind = 'Component' | 'Directive' | 'Pipe' | 'NgModule' | 'Injectable';
const CLASS_DECORATORS: ReadonlySet<string> = new Set<NgKind>([
  'Component',
  'Directive',
  'Pipe',
  'NgModule',
  'Injectable',
]);
/** Member decorators whose member Angular calls or reads by itself. */
const HOST_DECORATORS: ReadonlySet<string> = new Set(['HostListener', 'HostBinding']);

/** A string in the source and where its contents start, for exact positions. */
export interface SourceString {
  text: string;
  /** Offset of the first character inside the quotes, in the file. */
  start: number;
  /** Offset of the closing quote. */
  end: number;
  /** Escapes make the source differ from `text`: positions inside are approximate. */
  escaped: boolean;
}

export type TemplateSource =
  { kind: 'external'; path: string } | { kind: 'inline'; literal: SourceString };

/** A class decorated by `@angular/core`. */
export interface NgClass {
  file: string;
  name: string;
  /** `<file>#<name>`. */
  id: string;
  kind: NgKind;
  /** How another module imports it; undefined if it is not exported. */
  exported: 'named' | 'default' | undefined;
  /** Number of type parameters (`Table<T>` → 1). */
  typeParameters: number;
  template?: TemplateSource;
  /** `host: { '(click)': 'onClick()' }` entries. */
  host: { key: string; value: SourceString }[];
  /** Members decorated with `@HostListener` or `@HostBinding`. */
  hostMembers: Set<string>;
  /** `@Component`/`@Directive` selector. */
  selector?: string;
  /** `exportAs` names (`#ref="name"`). */
  exportAs?: string[];
  /** `@Pipe({ name })`. */
  pipeName?: string;
  /** Own inputs: class property → binding name (aliases resolved). Inherited ones: `bindings`. */
  inputs: Map<string, string>;
  /** Own outputs: class property → binding name. */
  outputs: Map<string, string>;
  /** `extends Base`: the base's name and the module it is imported from, if imported. */
  base?: { name: string; module?: string };
  /** Injects `TemplateRef`: a structural directive (`*name`). */
  structural: boolean;
  /** A library's class: the entry point it is imported from (`@angular/forms`). */
  module?: string;
}

/** Signal functions that declare inputs and outputs. */
const SIGNAL_INPUTS = new Set(['input', 'model']);
const SIGNAL_OUTPUTS = new Set(['output', 'outputFromObservable']);

/** What `@angular/core` names are called in a file: local name → exported name. */
export interface AngularImports {
  named: Map<string, string>;
  namespaces: Set<string>;
}

const importsCache = new WeakMap<ts.SourceFile, AngularImports>();

export function angularImports(tsApi: TS, sf: ts.SourceFile): AngularImports {
  const cached = importsCache.get(sf);
  if (cached) return cached;
  const found: AngularImports = { named: new Map(), namespaces: new Set() };
  for (const statement of sf.statements) {
    if (
      !tsApi.isImportDeclaration(statement) ||
      !tsApi.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('@angular/core')
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (tsApi.isNamespaceImport(bindings)) {
      found.namespaces.add(bindings.name.text);
    } else {
      for (const element of bindings.elements) {
        found.named.set(element.name.text, (element.propertyName ?? element.name).text);
      }
    }
  }
  importsCache.set(sf, found);
  return found;
}

/** The `@angular/core` export a decorator calls (`Component`), or undefined. */
export function angularDecorator(tsApi: TS, decorator: ts.Decorator): string | undefined {
  const expression = decorator.expression;
  const callee = tsApi.isCallExpression(expression) ? expression.expression : expression;
  const imports = angularImports(tsApi, decorator.getSourceFile());
  if (tsApi.isIdentifier(callee)) return imports.named.get(callee.text);
  if (
    tsApi.isPropertyAccessExpression(callee) &&
    tsApi.isIdentifier(callee.expression) &&
    imports.namespaces.has(callee.expression.text)
  ) {
    return callee.name.text;
  }
  return undefined;
}

/** The object literal a decorator is called with (`@Component({ … })`), if any. */
export function decoratorOptions(
  tsApi: TS,
  decorator: ts.Decorator,
): ts.ObjectLiteralExpression | undefined {
  const expression = decorator.expression;
  if (!tsApi.isCallExpression(expression)) return undefined;
  const [first] = expression.arguments;
  return first && tsApi.isObjectLiteralExpression(first) ? first : undefined;
}

export function propertyName(tsApi: TS, property: ts.ObjectLiteralElementLike): string | undefined {
  const name = property.name;
  if (!name) return undefined;
  if (tsApi.isIdentifier(name) || tsApi.isStringLiteral(name)) return name.text;
  return undefined;
}

function sourceString(tsApi: TS, node: ts.Node, sf: ts.SourceFile): SourceString | undefined {
  if (!tsApi.isStringLiteral(node) && !tsApi.isNoSubstitutionTemplateLiteral(node)) {
    return undefined;
  }
  const start = node.getStart(sf) + 1;
  const end = node.end - 1;
  return { text: node.text, start, end, escaped: sf.text.slice(start, end) !== node.text };
}

/** Angular classes of a file, from its syntax. */
export function angularClasses(tsApi: TS, file: string, sf: ts.SourceFile): NgClass[] {
  if (!sf.text.includes('@angular/core')) return [];
  const imports = angularImports(tsApi, sf);
  if (imports.named.size === 0 && imports.namespaces.size === 0) return [];
  const exportedNames = new Set<string>();
  for (const statement of sf.statements) {
    if (tsApi.isExportDeclaration(statement) && !statement.moduleSpecifier) {
      const clause = statement.exportClause;
      if (clause && tsApi.isNamedExports(clause)) {
        for (const element of clause.elements) {
          exportedNames.add((element.propertyName ?? element.name).text);
        }
      }
    }
  }

  const found: NgClass[] = [];
  for (const statement of sf.statements) {
    if (!tsApi.isClassDeclaration(statement) || !statement.name) continue;
    const decorators = tsApi.getDecorators(statement) ?? [];
    const decorator = decorators.find((d) =>
      CLASS_DECORATORS.has(angularDecorator(tsApi, d) ?? ''),
    );
    if (!decorator) continue;
    const kind = angularDecorator(tsApi, decorator) as NgKind;
    const modifiers = tsApi.getModifiers(statement) ?? [];
    const isExported = modifiers.some((m) => m.kind === tsApi.SyntaxKind.ExportKeyword);
    const isDefault = modifiers.some((m) => m.kind === tsApi.SyntaxKind.DefaultKeyword);
    const name = statement.name.text;
    const ngClass: NgClass = {
      file,
      name,
      id: `${file}#${name}`,
      kind,
      exported:
        isExported && isDefault
          ? 'default'
          : isExported || exportedNames.has(name)
            ? 'named'
            : undefined,
      typeParameters: statement.typeParameters?.length ?? 0,
      host: [],
      hostMembers: new Set(),
      inputs: new Map(),
      outputs: new Map(),
      structural: statement.getText(sf).includes('TemplateRef'),
    };
    const extended = statement.heritageClauses?.find(
      (c) => c.token === tsApi.SyntaxKind.ExtendsKeyword,
    )?.types[0]?.expression;
    if (extended && tsApi.isIdentifier(extended)) {
      const module = moduleImports(tsApi, sf).get(extended.text);
      ngClass.base = { name: extended.text, ...(module ? { module } : {}) };
    }

    for (const property of decoratorOptions(tsApi, decorator)?.properties ?? []) {
      if (!tsApi.isPropertyAssignment(property)) continue;
      const key = propertyName(tsApi, property);
      const value = property.initializer;
      if (kind === 'Component' && key === 'templateUrl' && tsApi.isStringLiteralLike(value)) {
        ngClass.template = {
          kind: 'external',
          path: posix.normalize(posix.join(posix.dirname(file), value.text)),
        };
      } else if (kind === 'Component' && key === 'template') {
        const literal = sourceString(tsApi, value, sf);
        if (literal) ngClass.template = { kind: 'inline', literal };
      } else if (key === 'selector' && tsApi.isStringLiteralLike(value)) {
        ngClass.selector = value.text;
      } else if (key === 'exportAs' && tsApi.isStringLiteralLike(value)) {
        ngClass.exportAs = value.text.split(',').map((n) => n.trim());
      } else if (kind === 'Pipe' && key === 'name' && tsApi.isStringLiteralLike(value)) {
        ngClass.pipeName = value.text;
      } else if ((key === 'inputs' || key === 'outputs') && tsApi.isArrayLiteralExpression(value)) {
        for (const element of value.elements) {
          const binding = arrayBinding(tsApi, element);
          if (binding) ngClass[key].set(binding[0], binding[1]);
        }
      } else if (key === 'host' && tsApi.isObjectLiteralExpression(value)) {
        for (const entry of value.properties) {
          const hostKey = tsApi.isPropertyAssignment(entry) && propertyName(tsApi, entry);
          const hostValue = hostKey && sourceString(tsApi, entry.initializer, sf);
          if (hostKey && hostValue) ngClass.host.push({ key: hostKey, value: hostValue });
        }
      }
    }

    for (const member of statement.members) {
      const memberName =
        member.name && tsApi.isIdentifier(member.name) ? member.name.text : undefined;
      if (!memberName) continue;
      for (const d of tsApi.canHaveDecorators(member) ? (tsApi.getDecorators(member) ?? []) : []) {
        const decorator = angularDecorator(tsApi, d) ?? '';
        if (HOST_DECORATORS.has(decorator)) ngClass.hostMembers.add(memberName);
        if (decorator === 'Input' || decorator === 'Output') {
          const call = tsApi.isCallExpression(d.expression) ? d.expression : undefined;
          const alias = aliasOf(tsApi, call?.arguments ?? []);
          ngClass[decorator === 'Input' ? 'inputs' : 'outputs'].set(
            memberName,
            alias ?? memberName,
          );
        }
      }
      // Signal inputs and outputs: `x = input()`, `input.required()`, `model()`, `output()`.
      const initializer = tsApi.isPropertyDeclaration(member) ? member.initializer : undefined;
      if (initializer && tsApi.isCallExpression(initializer)) {
        const fn = signalFunction(tsApi, initializer.expression, imports);
        const alias = aliasOf(tsApi, initializer.arguments) ?? memberName;
        if (fn && SIGNAL_INPUTS.has(fn)) ngClass.inputs.set(memberName, alias);
        if (fn === 'model') ngClass.outputs.set(memberName, `${alias}Change`);
        if (fn && SIGNAL_OUTPUTS.has(fn)) ngClass.outputs.set(memberName, alias);
      }
    }
    found.push(ngClass);
  }
  return found;
}

/** `input`, `model`… for `input(…)`, `input.required(…)`, when imported from Angular. */
function signalFunction(
  tsApi: TS,
  callee: ts.Expression,
  imports: AngularImports,
): string | undefined {
  const root =
    tsApi.isPropertyAccessExpression(callee) && callee.name.text === 'required'
      ? callee.expression
      : callee;
  return tsApi.isIdentifier(root) ? imports.named.get(root.text) : undefined;
}

/** An alias given as `'alias'` or `{ alias: 'alias' }` among a call's arguments. */
function aliasOf(tsApi: TS, args: readonly ts.Expression[]): string | undefined {
  for (const arg of args) {
    if (tsApi.isStringLiteralLike(arg)) return arg.text;
    if (tsApi.isObjectLiteralExpression(arg)) {
      for (const property of arg.properties) {
        if (
          tsApi.isPropertyAssignment(property) &&
          propertyName(tsApi, property) === 'alias' &&
          tsApi.isStringLiteralLike(property.initializer)
        ) {
          return property.initializer.text;
        }
      }
    }
  }
  return undefined;
}

/** `'name'`, `'name: alias'` or `{ name, alias }` in `inputs`/`outputs` arrays. */
function arrayBinding(tsApi: TS, element: ts.Expression): [string, string] | undefined {
  if (tsApi.isStringLiteralLike(element)) {
    const [name = '', alias] = element.text.split(':').map((part) => part.trim());
    return name ? [name, alias || name] : undefined;
  }
  if (tsApi.isObjectLiteralExpression(element)) {
    let name: string | undefined;
    let alias: string | undefined;
    for (const property of element.properties) {
      if (
        !tsApi.isPropertyAssignment(property) ||
        !tsApi.isStringLiteralLike(property.initializer)
      ) {
        continue;
      }
      const key = propertyName(tsApi, property);
      if (key === 'name') name = property.initializer.text;
      if (key === 'alias') alias = property.initializer.text;
    }
    return name ? [name, alias ?? name] : undefined;
  }
  return undefined;
}

const moduleImportsCache = new WeakMap<ts.SourceFile, Map<string, string>>();

/** Local names imported by a file → their module specifier. */
function moduleImports(tsApi: TS, sf: ts.SourceFile): Map<string, string> {
  const cached = moduleImportsCache.get(sf);
  if (cached) return cached;
  const found = new Map<string, string>();
  for (const statement of sf.statements) {
    if (
      !tsApi.isImportDeclaration(statement) ||
      !tsApi.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const module = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause?.name) found.set(clause.name.text, module);
    const bindings = clause?.namedBindings;
    if (bindings && !tsApi.isNamespaceImport(bindings)) {
      for (const element of bindings.elements) found.set(element.name.text, module);
    }
  }
  moduleImportsCache.set(sf, found);
  return found;
}
