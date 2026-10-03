import { ts } from 'ts-morph';
import type { EdgeKind, EdgeRef, Site, SymbolDecl } from '../../model.js';
import { isTsSource } from './files.js';
import { mapVirtual, repoPath, type TsRevision } from './project.js';
import {
  bindingNames,
  enclosingSymbolId,
  hasModifier,
  nodeAt,
  referenceKind,
  unwrap,
} from './syntax.js';

const MAX_UNKNOWN_TEXT = 60;

/**
 * References to a symbol from elsewhere in the revision, found by the language service.
 *
 * The language service answers "what must change if this is renamed", so for a class member it
 * also returns the whole class family: the base declaration, siblings' overrides and every
 * `this.member` in sibling classes. Only code that could run on an instance of the member's
 * class uses it; the rest is dropped (see `FamilyFilter`).
 */
export function incomingTs(revision: TsRevision, symbol: SymbolDecl): EdgeRef[] {
  const { program, service, root } = revision;
  const checker = program.getTypeChecker();
  const edges = new Map<string, EdgeRef>();
  const nodes = revision.declarations.get(symbol.id) ?? [];
  const family = FamilyFilter.forMember(checker, nodes);

  for (const node of nodes) {
    const name = nameNode(node, symbol.name);
    if (!name) continue;
    const sf = node.getSourceFile();
    for (const group of service.findReferences(sf.fileName, name.getStart(sf)) ?? []) {
      for (const entry of group.references) {
        if (entry.isDefinition) continue;
        const file = repoPath(root, entry.fileName);
        const refSf = program.getSourceFile(entry.fileName);
        if (!file || !isTsSource(file) || !refSf) continue;
        // A plugin's virtual file: the reference belongs to its owner, at its real site.
        const mapped = mapVirtual(revision, entry.fileName, entry.textSpan.start);
        if (mapped === undefined) continue;

        const at = nodeAt(refSf, entry.textSpan.start);
        let kind = referenceKind(at);
        let possible = mapped?.possible === true;
        if (family) {
          const verdict = family.judge(at);
          if (verdict === 'drop') continue;
          if (verdict === 'overrides') kind = 'overrides';
          possible ||= verdict === 'possible';
        }
        const from = mapped ? mapped.owner : enclosingSymbolId(at, refSf, file);
        if (!from || from === symbol.id) continue;
        const site = mapped ? mapped.site : siteOf(refSf, file, entry.textSpan.start);
        const passes = jsxAttributes(at);
        edges.set(siteKey(site), {
          from,
          to: symbol.id,
          kind,
          resolution: 'resolved',
          ...(possible ? { possible: true as const } : {}),
          site,
          ...(passes ? { passes } : {}),
        });
      }
    }
  }
  return [...edges.values()];
}

/**
 * The attributes a JSX element passes when `name` is its tag (`<Badge>`, `<ui.Badge>`), and
 * `children` when it has some; undefined for any other reference, and with a spread attribute
 * (`{...props}`).
 */
function jsxAttributes(name: ts.Node): string[] | undefined {
  let tag = name;
  while (ts.isPropertyAccessExpression(tag.parent) && tag.parent.name === tag) tag = tag.parent;
  const element = tag.parent;
  if (
    !(ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) ||
    element.tagName !== tag
  ) {
    return undefined;
  }
  const passes: string[] = [];
  for (const attribute of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) return undefined;
    passes.push(attribute.name.getText());
  }
  // Children between the tags are passed as `children` (React; Qwik slots them).
  if (ts.isJsxOpeningElement(element) && element.parent.children.length > 0) {
    passes.push('children');
  }
  return passes;
}

/** What a symbol references: repo symbols, external packages, and calls it cannot resolve. */
export function outgoingTs(revision: TsRevision, symbol: SymbolDecl): EdgeRef[] {
  const { program, root } = revision;
  const checker = program.getTypeChecker();
  const edges = new Map<string, EdgeRef>();
  const own = revision.declarations.get(symbol.id) ?? [];

  const add = (edge: EdgeRef) => {
    if (edge.to !== symbol.id) edges.set(`${edge.to}|${edge.kind}|${siteKey(edge.site)}`, edge);
  };

  for (const node of own) {
    const sf = node.getSourceFile();
    const file = repoPath(root, sf.fileName);
    if (!file) continue;
    const ownName = nameNode(node, symbol.name);
    // In a plugin's virtual file, sites map back to the real file; scaffolding maps to nothing.
    const virtual = revision.virtual.has(sf.fileName);
    const locate = (n: ts.Node): { site: Site; possible?: boolean } | undefined =>
      virtual
        ? (mapVirtual(revision, sf.fileName, n.getStart(sf)) ?? undefined)
        : { site: siteOf(sf, file, n.getStart(sf)) };
    const site = (n: ts.Node): Site | undefined => locate(n)?.site;

    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n !== ownName) {
        const edge = resolveIdentifier(n);
        const at = edge && locate(n);
        if (edge && at) {
          add({
            from: symbol.id,
            ...edge,
            ...(at.possible ? { possible: true as const } : {}),
            site: at.site,
          });
        }
      } else if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const callee = unwrap(n.expression);
        const at = site(callee);
        if (
          at &&
          ts.isElementAccessExpression(callee) &&
          !ts.isStringLiteralLike(callee.argumentExpression)
        ) {
          add({ from: symbol.id, ...unknown(callee, sf, 'call'), site: at });
        }
      }
      ts.forEachChild(n, visit);
    };
    for (const scanned of scanRoots(node)) visit(scanned);

    // The base class or interface members this member overrides or implements.
    const nameSite = ownName && site(ownName);
    if (ts.isClassElement(node) && nameSite) {
      for (const decl of overriddenMembers(checker, node)) {
        const target = overrideTarget(decl);
        if (target) {
          add({
            from: symbol.id,
            ...target,
            kind: 'overrides',
            resolution: 'resolved',
            site: nameSite,
          });
        }
      }
    }
  }
  return [...edges.values()];

  function overrideTarget(decl: ts.Declaration): Pick<EdgeRef, 'to' | 'target'> | undefined {
    const declSf = decl.getSourceFile();
    if (program.isSourceFileDefaultLibrary(declSf)) return undefined;
    // Plugin shims are scaffolding, never a declaration of the project.
    if (revision.virtual.has(declSf.fileName)) return undefined;
    const declFile = repoPath(root, declSf.fileName);
    if (!declFile || declSf.fileName.includes('/node_modules/')) {
      const pkg = packageOf(declSf.fileName);
      return pkg ? { to: `${pkg}#${declarationPath(decl)}`, target: 'external' } : undefined;
    }
    if (declSf.isDeclarationFile) return undefined;
    // Interface members are not symbols of their own: the edge goes to the interface.
    const to = enclosingSymbolId(declarationName(decl) ?? decl, declSf, declFile);
    return to ? { to } : undefined;
  }

  function resolveIdentifier(id: ts.Identifier): Omit<EdgeRef, 'from' | 'site'> | undefined {
    const parent = id.parent;
    let sym: ts.Symbol | undefined;
    if (ts.isShorthandPropertyAssignment(parent)) {
      sym = checker.getShorthandAssignmentValueSymbol(parent);
    } else if (isDeclarationName(id)) {
      return undefined;
    } else {
      sym = checker.getSymbolAtLocation(id);
    }
    const kind = referenceKind(id);
    if (!sym) {
      return kind === 'call' || kind === 'new'
        ? unknown(calleeOf(id), id.getSourceFile(), kind)
        : undefined;
    }

    if (sym.flags & ts.SymbolFlags.Alias) {
      const target = checker.getAliasedSymbol(sym);
      if (!target.declarations?.length) return importedExternal(sym, kind);
      sym = target;
    }
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    if (!decl) return undefined;
    const declSf = decl.getSourceFile();
    if (program.isSourceFileDefaultLibrary(declSf)) return undefined;
    // Plugin shims are scaffolding, never a declaration of the project.
    if (revision.virtual.has(declSf.fileName)) return undefined;

    const path = declSf.fileName;
    const declFile = repoPath(root, path);
    if (!declFile || path.includes('/node_modules/')) {
      const pkg = packageOf(path);
      return pkg
        ? {
            to: `${pkg}#${declarationPath(decl)}`,
            kind,
            resolution: 'resolved',
            target: 'external',
          }
        : undefined;
    }
    if (declSf.isDeclarationFile) return undefined;
    // Locals and parameters of this symbol, members of type literals and object literals.
    if (own.some((n) => n.getSourceFile() === declSf && n.pos <= decl.pos && decl.end <= n.end)) {
      return undefined;
    }
    // Namespace imports (`import * as ns`) resolve to the module itself; its members resolve on their own.
    if (ts.isSourceFile(decl)) return undefined;
    if (
      ts.isTypeElement(decl) ||
      (decl.parent !== undefined && ts.isObjectLiteralExpression(decl.parent)) ||
      ts.isParameter(decl)
    ) {
      return undefined;
    }
    const to = enclosingSymbolId(declarationName(decl) ?? decl, declSf, declFile);
    return to ? { to, kind, resolution: 'resolved' } : undefined;
  }

  function importedExternal(
    alias: ts.Symbol,
    kind: EdgeKind,
  ): Omit<EdgeRef, 'from' | 'site'> | undefined {
    const decl = alias.declarations?.[0];
    let name: string | undefined;
    let importDecl: ts.Node | undefined;
    if (decl && ts.isImportSpecifier(decl)) {
      name = (decl.propertyName ?? decl.name).text;
      importDecl = decl.parent.parent.parent;
    } else if (decl && ts.isImportClause(decl)) {
      name = 'default';
      importDecl = decl.parent;
    } else if (decl && ts.isNamespaceImport(decl)) {
      name = '*';
      importDecl = decl.parent.parent;
    }
    if (!name || !importDecl || !ts.isImportDeclaration(importDecl)) return undefined;
    const specifier = (importDecl.moduleSpecifier as ts.StringLiteral).text;
    if (specifier.startsWith('.')) return undefined; // a relative import that did not resolve
    return { to: `${specifier}#${name}`, kind, resolution: 'resolved', target: 'external' };
  }
}

type Verdict = 'use' | 'possible' | 'overrides' | 'drop';

/**
 * Decides which references to a class member are uses, from the class of the object the member
 * is read from: the member's class or a subclass → a use; an ancestor class or an interface it
 * implements → a possible use (the object may be an instance of the member's class); any other
 * class (a sibling) → not a use; unknown (`any`, no receiver) → kept. Declarations returned by
 * the search are overrides when a subclass's member overrides this one, and dropped otherwise:
 * this member's own overrides come from its outgoing references.
 */
class FamilyFilter {
  private readonly ancestorsCache = new Map<ts.Node, Set<ts.Node>>();
  private readonly ancestors: Set<ts.Node>;

  private constructor(
    private readonly checker: ts.TypeChecker,
    private readonly cls: ts.ClassLikeDeclaration,
    private readonly declarations: readonly ts.Node[],
  ) {
    this.ancestors = this.ancestorsOf(cls);
  }

  /** A filter for a class member's declarations; undefined for anything else. */
  static forMember(checker: ts.TypeChecker, nodes: readonly ts.Node[]): FamilyFilter | undefined {
    const parent = nodes[0]?.parent;
    return parent && ts.isClassLike(parent) && nodes.every((n) => ts.isClassElement(n))
      ? new FamilyFilter(checker, parent, nodes)
      : undefined;
  }

  judge(at: ts.Node): Verdict {
    const parent = at.parent as (ts.Node & { name?: ts.Node }) | undefined;
    if (parent && parent.name === at && (ts.isClassElement(parent) || ts.isTypeElement(parent))) {
      return ts.isClassElement(parent) &&
        overriddenMembers(this.checker, parent).some((d) => this.declarations.includes(d))
        ? 'overrides'
        : 'drop';
    }
    const receiver = receiverOf(at);
    if (!receiver) return 'use';
    const relations = this.relations(this.checker.getTypeAtLocation(receiver));
    if (relations.has('self') || relations.has('descendant') || relations.has('unknown')) {
      return 'use';
    }
    return relations.has('ancestor') ? 'possible' : 'drop';
  }

  /** How the classes a type stands for relate to the member's class. */
  private relations(type: ts.Type, seen = new Set<ts.Type>()): Set<string> {
    const found = new Set<string>();
    if (seen.has(type)) return found;
    seen.add(type);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return new Set(['unknown']);
    if (type.isUnionOrIntersection()) {
      for (const part of type.types) for (const r of this.relations(part, seen)) found.add(r);
      return found;
    }
    if (type.isTypeParameter()) {
      // `this` and constrained generics stand for their constraint.
      const constraint = this.checker.getBaseConstraintOfType(type);
      return constraint && constraint !== type
        ? this.relations(constraint, seen)
        : new Set(['unknown']);
    }
    // (`isTypeParameter` narrows `type` to never past this point.)
    const classes = ((type as ts.Type).getSymbol()?.declarations ?? []).filter(isClassOrInterface);
    if (classes.length === 0) return new Set(['unknown']);
    for (const decl of classes) {
      if (decl === this.cls) found.add('self');
      else if (this.ancestors.has(decl)) found.add('ancestor');
      else if (this.ancestorsOf(decl).has(this.cls)) found.add('descendant');
      else found.add('unrelated');
    }
    return found;
  }

  /** Every class and interface a class or interface extends or implements, transitively. */
  private ancestorsOf(decl: ts.Node): Set<ts.Node> {
    const cached = this.ancestorsCache.get(decl);
    if (cached) return cached;
    const found = new Set<ts.Node>();
    this.ancestorsCache.set(decl, found);
    const clauses = (decl as { heritageClauses?: ts.NodeArray<ts.HeritageClause> }).heritageClauses;
    for (const clause of clauses ?? []) {
      for (const type of clause.types) {
        const declarations = this.checker.getTypeAtLocation(type).getSymbol()?.declarations ?? [];
        for (const base of declarations.filter(isClassOrInterface)) {
          if (found.has(base)) continue;
          found.add(base);
          for (const further of this.ancestorsOf(base)) found.add(further);
        }
      }
    }
    return found;
  }
}

function isClassOrInterface(node: ts.Node): boolean {
  return ts.isClassLike(node) || ts.isInterfaceDeclaration(node);
}

/** The object a member is read from: `x` in `x.member` or `x['member']`. */
function receiverOf(at: ts.Node): ts.Expression | undefined {
  const parent = at.parent;
  if (!parent) return undefined;
  if (ts.isPropertyAccessExpression(parent) && parent.name === at) return parent.expression;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === at) {
    return parent.expression;
  }
  return undefined;
}

/**
 * Declarations of the base class and interface members a class member overrides or implements:
 * the same-named member of each type in its class's `extends` and `implements` clauses.
 */
function overriddenMembers(checker: ts.TypeChecker, member: ts.ClassElement): ts.Declaration[] {
  const cls = member.parent;
  const name = member.name;
  if (
    !ts.isClassLike(cls) ||
    ts.isConstructorDeclaration(member) ||
    hasModifier(member, ts.SyntaxKind.StaticKeyword) ||
    !name ||
    !(ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
  ) {
    return [];
  }
  const found: ts.Declaration[] = [];
  for (const clause of cls.heritageClauses ?? []) {
    for (const type of clause.types) {
      for (const decl of checker.getTypeAtLocation(type).getProperty(name.text)?.declarations ??
        []) {
        if (!found.includes(decl)) found.push(decl);
      }
    }
  }
  return found;
}

/** Nodes to scan for outgoing references: members of classes and namespaces are scanned on their own. */
function scanRoots(node: ts.Node): ts.Node[] {
  if (ts.isClassLike(node)) {
    return [
      ...(ts.getDecorators(node) ?? []),
      ...(node.typeParameters ?? []),
      ...(node.heritageClauses ?? []),
    ];
  }
  if (ts.isModuleDeclaration(node)) return [];
  return [node];
}

/** The identifier to search references from. */
export function nameNode(node: ts.Node, name: string): ts.Node | undefined {
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      const found = bindingNames(declaration.name).find((id) => id.text === name);
      if (found) return found;
    }
    return undefined;
  }
  if (ts.isVariableDeclaration(node)) return bindingNames(node.name).find((id) => id.text === name);
  if (ts.isConstructorDeclaration(node)) {
    return node.getChildren().find((c) => c.kind === ts.SyntaxKind.ConstructorKeyword);
  }
  if (ts.isExportAssignment(node)) {
    return node.getChildren().find((c) => c.kind === ts.SyntaxKind.DefaultKeyword);
  }
  const declared = declarationName(node);
  if (declared) return declared;
  if (ts.canHaveModifiers(node)) {
    return ts.getModifiers(node)?.find((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  }
  return undefined;
}

function declarationName(node: ts.Node): ts.Node | undefined {
  const name = (node as { name?: ts.Node }).name;
  return name &&
    (ts.isIdentifier(name) ||
      ts.isPrivateIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name) ||
      ts.isComputedPropertyName(name))
    ? name
    : undefined;
}

/** Whether an identifier names a declaration (parameter, local, property key) rather than using one. */
function isDeclarationName(id: ts.Identifier): boolean {
  const parent = id.parent as ts.Node & { name?: ts.Node };
  if (ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) return false;
  return parent.name === id;
}

/** The callee expression for an identifier used as (part of) a callee. */
function calleeOf(id: ts.Identifier): ts.Node {
  let node: ts.Node = id;
  while (node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
    node = node.parent;
  }
  return node;
}

function unknown(node: ts.Node, sf: ts.SourceFile, kind: EdgeKind): Omit<EdgeRef, 'from' | 'site'> {
  let text = node.getText(sf).replace(/\s+/g, ' ');
  if (text.length > MAX_UNKNOWN_TEXT) text = `${text.slice(0, MAX_UNKNOWN_TEXT - 1)}…`;
  return { to: `unknown:${text}`, kind, resolution: 'unknown', target: 'unknown' };
}

/** `node_modules/@scope/pkg/…` → `@scope/pkg`; `@types/node` → `node`. */
export function packageOf(path: string): string | undefined {
  const index = path.lastIndexOf('/node_modules/');
  if (index === -1) return undefined;
  const parts = path.slice(index + '/node_modules/'.length).split('/');
  const name = parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (!name) return undefined;
  if (name.startsWith('@types/')) {
    const typed = name.slice('@types/'.length);
    return typed.includes('__') ? `@${typed.replace('__', '/')}` : typed;
  }
  return name;
}

/** `Response.json` for a member, `useState` for a function: the declaration's dotted path. */
function declarationPath(decl: ts.Node): string {
  const names: string[] = [];
  for (let n: ts.Node | undefined = decl; n && !ts.isSourceFile(n); n = n.parent) {
    const name = declarationName(n);
    if (
      name &&
      (n === decl ||
        ts.isClassLike(n) ||
        ts.isInterfaceDeclaration(n) ||
        ts.isModuleDeclaration(n) ||
        ts.isEnumDeclaration(n))
    ) {
      names.unshift(name.getText());
    }
  }
  return names.join('.') || 'default';
}

function siteOf(sf: ts.SourceFile, file: string, position: number): Site {
  const { line, character } = sf.getLineAndCharacterOfPosition(position);
  return { file, line: line + 1, col: character + 1 };
}

function siteKey(site: Site): string {
  return `${site.file}:${site.line}:${site.col}`;
}
