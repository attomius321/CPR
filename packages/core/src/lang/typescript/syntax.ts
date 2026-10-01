import { ts } from 'ts-morph';
import type { EdgeKind, SymbolId } from '../../model.js';

/** Pseudo-symbol for code at the top level of a file, outside any declaration. */
export const MODULE_SYMBOL = '(module)';

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

export function isDefaultExport(node: ts.Node): boolean {
  return (
    hasModifier(node, ts.SyntaxKind.ExportKeyword) &&
    hasModifier(node, ts.SyntaxKind.DefaultKeyword)
  );
}

/** Strips wrappers that do not change what a value is: parentheses, `as`, `satisfies`, `!`. */
export function unwrap(node: ts.Expression): ts.Expression;
export function unwrap(node: ts.Expression | undefined): ts.Expression | undefined;
export function unwrap(node: ts.Expression | undefined): ts.Expression | undefined {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

export function functionValue(
  node: ts.Expression | undefined,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  const value = unwrap(node);
  return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? value : undefined;
}

export function bindingNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

/** Name of a class member that is a symbol; undefined for static blocks, index signatures, `;`. */
export function memberName(member: ts.ClassElement, sf: ts.SourceFile): string | undefined {
  if (ts.isConstructorDeclaration(member)) return 'constructor';
  const { name } = member;
  if (!name) return undefined;
  if (ts.isComputedPropertyName(name)) {
    return `[${name.expression.getText(sf).replace(/\s+/g, ' ')}]`;
  }
  return name.text;
}

/** Member name as it appears in IDs: static members carry a `static:` prefix. */
export function memberLocalName(member: ts.ClassElement, sf: ts.SourceFile): string | undefined {
  const name = memberName(member, sf);
  if (name === undefined) return undefined;
  return `${hasModifier(member, ts.SyntaxKind.StaticKeyword) ? 'static:' : ''}${name}`;
}

/**
 * The ID of the symbol a node belongs to, named exactly like the extractor names declarations:
 * top-level declarations, class members, namespace members; anything nested inside a function
 * belongs to that function. Top-level code outside declarations belongs to `file#(module)`.
 * Returns undefined inside import and export declarations, which are not uses.
 */
export function enclosingSymbolId(
  node: ts.Node,
  sf: ts.SourceFile,
  file: string,
): SymbolId | undefined {
  const chain: ts.Node[] = [];
  for (let n: ts.Node | undefined = node; n && n !== sf; n = n.parent) chain.unshift(n);
  const qualified = qualifiedNameIn(chain, 0, '');
  return qualified === undefined ? undefined : `${file}#${qualified}`;
}

/** Walks a top-down ancestor chain from index `i` (a statement) and returns its qualified name. */
function qualifiedNameIn(chain: ts.Node[], i: number, prefix: string): string | undefined {
  const statement = chain[i];
  if (!statement) return MODULE_SYMBOL;

  if (
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isExportDeclaration(statement)
  ) {
    return undefined;
  }
  if (ts.isFunctionDeclaration(statement)) {
    const name = statement.name?.text ?? (isDefaultExport(statement) ? 'default' : undefined);
    return name === undefined ? MODULE_SYMBOL : `${prefix}${name}`;
  }
  if (ts.isClassDeclaration(statement)) {
    return classMember(chain, i, `${prefix}${statement.name?.text ?? 'default'}`, statement);
  }
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return `${prefix}${statement.name.text}`;
  }
  if (ts.isVariableStatement(statement)) {
    const declaration = chain[i + 2];
    if (!declaration || !ts.isVariableDeclaration(declaration)) {
      // The statement itself (e.g. its `export` keyword): its first name.
      const first = statement.declarationList.declarations[0];
      const name = first && bindingNames(first.name)[0];
      return name ? `${prefix}${name.text}` : MODULE_SYMBOL;
    }
    const name = bindingNames(declaration.name)[0]?.text;
    if (name === undefined) return MODULE_SYMBOL;
    const init = unwrap(declaration.initializer);
    if (init && ts.isClassExpression(init) && chain.includes(init)) {
      return classMember(chain, chain.indexOf(init), `${prefix}${name}`, init);
    }
    return `${prefix}${name}`;
  }
  if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
    const ns = `${prefix}${statement.name.text}`;
    const next = chain[i + 1];
    if (next && ts.isModuleBlock(next)) {
      // Code in the namespace body outside a declaration belongs to the namespace.
      const inner = qualifiedNameIn(chain, i + 2, `${ns}.`);
      return inner === MODULE_SYMBOL ? ns : inner;
    }
    if (next && ts.isModuleDeclaration(next)) return qualifiedNameIn(chain, i + 1, `${ns}.`);
    return ns;
  }
  if (ts.isExportAssignment(statement)) {
    if (statement.isExportEquals || ts.isIdentifier(unwrap(statement.expression))) return undefined;
    const init = unwrap(statement.expression);
    if (ts.isClassExpression(init) && chain.includes(init)) {
      return classMember(chain, chain.indexOf(init), 'default', init);
    }
    return 'default';
  }
  return MODULE_SYMBOL;
}

function classMember(
  chain: ts.Node[],
  classIndex: number,
  className: string,
  cls: ts.ClassLikeDeclaration,
): string {
  const member = chain[classIndex + 1];
  if (member && ts.isClassElement(member) && cls.members.includes(member)) {
    const local = memberLocalName(member, cls.getSourceFile());
    if (local !== undefined) return `${className}.${local}`;
  }
  return className;
}

/** The deepest node at a position (e.g. the identifier a reference points at). */
export function nodeAt(sf: ts.SourceFile, position: number): ts.Node {
  let current: ts.Node = sf;
  for (;;) {
    const child: ts.Node | undefined = current.forEachChild((c) =>
      c.getStart(sf) <= position && position < c.getEnd() ? c : undefined,
    );
    if (!child) return current;
    current = child;
  }
}

/** How a reference uses its target, from the identifier's position in the syntax tree. */
export function referenceKind(identifier: ts.Node): EdgeKind {
  let node = identifier;
  // `a.b.c` and `A.B.C`: classify the whole access, not just its last name.
  while (
    node.parent &&
    ((ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
      (ts.isQualifiedName(node.parent) && node.parent.right === node))
  ) {
    node = node.parent;
  }
  const parent = node.parent;
  if (!parent) return 'reference';

  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) {
    return ts.isNewExpression(parent) ? 'new' : 'call';
  }
  if (ts.isTaggedTemplateExpression(parent) && parent.tag === node) return 'call';
  if (ts.isDecorator(parent)) return 'call';
  if (
    (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
    parent.tagName === node
  ) {
    return 'call';
  }
  if (ts.isExpressionWithTypeArguments(parent) && ts.isHeritageClause(parent.parent)) {
    return parent.parent.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'extends';
  }
  let type: ts.Node = parent;
  while (ts.isQualifiedName(type) && type.parent) type = type.parent;
  if (ts.isTypeReferenceNode(type) || ts.isTypeQueryNode(type) || ts.isImportTypeNode(type)) {
    return 'type-reference';
  }
  return 'reference';
}
