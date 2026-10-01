import { ts } from 'ts-morph';
import type { EdgeKind, EdgeRef, Site, SymbolDecl } from '../../model.js';
import { isTsSource } from './files.js';
import { repoPath, type TsRevision } from './project.js';
import { bindingNames, enclosingSymbolId, nodeAt, referenceKind, unwrap } from './syntax.js';

const MAX_UNKNOWN_TEXT = 60;

/** References to a symbol from elsewhere in the revision, found by the language service. */
export function incomingTs(revision: TsRevision, symbol: SymbolDecl): EdgeRef[] {
  const { program, service, root } = revision;
  const edges = new Map<string, EdgeRef>();

  for (const node of revision.declarations.get(symbol.id) ?? []) {
    const name = nameNode(node, symbol.name);
    if (!name) continue;
    const sf = node.getSourceFile();
    for (const group of service.findReferences(sf.fileName, name.getStart(sf)) ?? []) {
      for (const entry of group.references) {
        if (entry.isDefinition) continue;
        const file = repoPath(root, entry.fileName);
        const refSf = program.getSourceFile(entry.fileName);
        if (!file || !isTsSource(file) || !refSf) continue;

        const at = nodeAt(refSf, entry.textSpan.start);
        const from = enclosingSymbolId(at, refSf, file);
        if (!from || from === symbol.id) continue;
        const site = siteOf(refSf, file, entry.textSpan.start);
        edges.set(siteKey(site), {
          from,
          to: symbol.id,
          kind: referenceKind(at),
          resolution: 'resolved',
          site,
        });
      }
    }
  }
  return [...edges.values()];
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
    const site = (n: ts.Node) => siteOf(sf, file, n.getStart(sf));

    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n !== ownName) {
        const edge = resolveIdentifier(n);
        if (edge) add({ from: symbol.id, ...edge, site: site(n) });
      } else if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const callee = unwrap(n.expression);
        if (
          ts.isElementAccessExpression(callee) &&
          !ts.isStringLiteralLike(callee.argumentExpression)
        ) {
          add({ from: symbol.id, ...unknown(callee, sf, 'call'), site: site(callee) });
        }
      }
      ts.forEachChild(n, visit);
    };
    for (const scanned of scanRoots(node)) visit(scanned);
  }
  return [...edges.values()];

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
    if (
      ts.isTypeElement(decl) ||
      ts.isObjectLiteralExpression(decl.parent) ||
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
