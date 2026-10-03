import type { ts } from '@cpr/core';

/** What a file imports: local name → module and imported name; namespaces → module. */
export interface Imports {
  named: Map<string, { module: string; imported: string }>;
  namespaces: Map<string, string>;
}

const cache = new WeakMap<ts.SourceFile, Imports>();

export function importsOf(tsApi: typeof ts, sf: ts.SourceFile): Imports {
  let found = cache.get(sf);
  if (found) return found;
  found = { named: new Map(), namespaces: new Map() };
  for (const statement of sf.statements) {
    if (!tsApi.isImportDeclaration(statement) || !tsApi.isStringLiteral(statement.moduleSpecifier))
      continue;
    const module = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (tsApi.isNamespaceImport(bindings)) {
      found.namespaces.set(bindings.name.text, module);
    } else {
      for (const element of bindings.elements) {
        found.named.set(element.name.text, {
          module,
          imported: (element.propertyName ?? element.name).text,
        });
      }
    }
  }
  cache.set(sf, found);
  return found;
}

/**
 * Whether a call's callee is one of `names` imported from one of `modules`, directly
 * (`component$`, `component$ as c$`) or through a namespace (`Q.component$`).
 */
export function calls(
  tsApi: typeof ts,
  call: ts.CallExpression,
  modules: ReadonlySet<string>,
  names: ReadonlySet<string>,
): boolean {
  const imports = importsOf(tsApi, call.getSourceFile());
  const callee = call.expression;
  if (tsApi.isIdentifier(callee)) {
    const imported = imports.named.get(callee.text);
    return !!imported && modules.has(imported.module) && names.has(imported.imported);
  }
  if (tsApi.isPropertyAccessExpression(callee) && tsApi.isIdentifier(callee.expression)) {
    const module = imports.namespaces.get(callee.expression.text);
    return !!module && modules.has(module) && names.has(callee.name.text);
  }
  return false;
}

/** Strips parentheses, `as`, `satisfies` and `!` around a value. */
export function unwrap(
  tsApi: typeof ts,
  node: ts.Expression | undefined,
): ts.Expression | undefined {
  let current = node;
  while (
    current &&
    (tsApi.isParenthesizedExpression(current) ||
      tsApi.isAsExpression(current) ||
      tsApi.isSatisfiesExpression(current) ||
      tsApi.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}
