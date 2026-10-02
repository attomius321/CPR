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
}

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
      statement.moduleSpecifier.text !== '@angular/core'
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
    };

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
      } else if (key === 'host' && tsApi.isObjectLiteralExpression(value)) {
        for (const entry of value.properties) {
          const hostKey = tsApi.isPropertyAssignment(entry) && propertyName(tsApi, entry);
          const hostValue = hostKey && sourceString(tsApi, entry.initializer, sf);
          if (hostKey && hostValue) ngClass.host.push({ key: hostKey, value: hostValue });
        }
      }
    }

    for (const member of statement.members) {
      if (!member.name || !tsApi.canHaveDecorators(member)) continue;
      const decorated = (tsApi.getDecorators(member) ?? []).some((d) =>
        HOST_DECORATORS.has(angularDecorator(tsApi, d) ?? ''),
      );
      const memberName = tsApi.isIdentifier(member.name) ? member.name.text : undefined;
      if (decorated && memberName) ngClass.hostMembers.add(memberName);
    }
    found.push(ngClass);
  }
  return found;
}
