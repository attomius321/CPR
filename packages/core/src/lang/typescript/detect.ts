import { existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { ts } from 'ts-morph';
import type { Dangling, Exposure, Site, SymbolDecl, SymbolId } from '../../model.js';
import { isTsSource } from './files.js';
import { mapVirtual, readJson, repoPath, sourceEntry, type TsRevision } from './project.js';
import { enclosingSymbolId, hasModifier, isDefaultExport } from './syntax.js';

const MEMBER_KINDS = new Set(['method', 'property', 'accessor', 'constructor']);

/**
 * Uses of removed symbols' names that no longer resolve: an import of an export that is gone,
 * an unknown identifier, or a property missing from its receiver's type. In TS files the
 * compiler would report these (`resolved`); in JS or on `any` receivers it is a guess.
 */
export function danglingTs(revision: TsRevision, removed: readonly SymbolDecl[]): Dangling[] {
  const { program, root } = revision;
  const checker = program.getTypeChecker();
  const byName = new Map<string, SymbolDecl[]>();
  for (const symbol of removed) {
    const group = byName.get(symbol.name);
    if (group) group.push(symbol);
    else byName.set(symbol.name, [symbol]);
  }
  if (byName.size === 0) return [];

  const found: Dangling[] = [];
  for (const sf of program.getSourceFiles()) {
    const file = repoPath(root, sf.fileName);
    if (!file || !isTsSource(file) || sf.isDeclarationFile) continue;
    if (![...byName.keys()].some((name) => sf.text.includes(name))) continue;
    const typed = /\.[cm]?tsx?$/.test(file);
    // A plugin's virtual file: hits belong to their owner, at their real site.
    const virtual = revision.virtual.has(sf.fileName);
    const locate = (node: ts.Node): { owner: SymbolId; site: Site } | undefined => {
      const start = node.getStart(sf);
      if (virtual) return mapVirtual(revision, sf.fileName, start) ?? undefined;
      const owner = enclosingSymbolId(node, sf, file);
      if (!owner) return undefined;
      const { line, character } = sf.getLineAndCharacterOfPosition(start);
      return { owner, site: { file, line: line + 1, col: character + 1 } };
    };

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && byName.has(node.text) && !isDeclarationName(node)) {
        const result = classify(node, typed);
        const at = result && locate(node);
        if (result && at) {
          for (const target of byName.get(node.text) ?? []) {
            found.push({
              target: target.id,
              from: at.owner,
              site: at.site,
              certainty: result.certainty,
              viaImport:
                result.importedFrom !== undefined && sameModule(result.importedFrom, target.file),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;

  function classify(
    id: ts.Identifier,
    typed: boolean,
  ): { certainty: Dangling['certainty']; importedFrom?: string } | undefined {
    const symbol = checker.getSymbolAtLocation(id);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      const target = checker.getAliasedSymbol(symbol);
      if (target.declarations?.length) return undefined;
      const importedFrom = importSource(symbol, id.getSourceFile());
      return {
        certainty: typed ? 'resolved' : 'unknown',
        ...(importedFrom ? { importedFrom } : {}),
      };
    }
    if (symbol) return undefined;

    const parent = id.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === id) {
      const receiver = checker.getTypeAtLocation(parent.expression);
      const untyped = (receiver.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
      return { certainty: typed && !untyped ? 'resolved' : 'unknown' };
    }
    return { certainty: typed ? 'resolved' : 'unknown' };
  }
}

/** Repo-relative path an alias was imported from (relative specifiers only). */
function importSource(alias: ts.Symbol, sf: ts.SourceFile): string | undefined {
  const decl = alias.declarations?.[0];
  let importDecl: ts.Node | undefined = decl;
  while (importDecl && !ts.isImportDeclaration(importDecl)) importDecl = importDecl.parent;
  if (!importDecl || !ts.isStringLiteral(importDecl.moduleSpecifier)) return undefined;
  const specifier = importDecl.moduleSpecifier.text;
  if (!specifier.startsWith('.')) return undefined;
  return posix.join(posix.dirname(sf.fileName), specifier);
}

/** `/repo/src/math` (import) vs `src/math.ts` (symbol file): same module, any extension/index. */
function sameModule(imported: string, file: string): boolean {
  const strip = (p: string) => p.replace(/\.[cm]?[jt]sx?$/, '').replace(/\/index$/, '');
  return strip(imported).endsWith(`/${strip(file)}`);
}

function isDeclarationName(id: ts.Identifier): boolean {
  const parent = id.parent as ts.Node & { name?: ts.Node };
  if (ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) return false;
  return parent.name === id || (ts.isImportSpecifier(parent) && parent.propertyName === id);
}

/**
 * Why a symbol may be used although nothing in the repo references it: it is exported from its
 * package's entry point (public API), it overrides or implements an inherited member (called
 * through the base type), or it is a default export (often loaded by framework convention).
 */
export function exposureTs(revision: TsRevision, symbol: SymbolDecl): Exposure | undefined {
  const nodes = revision.declarations.get(symbol.id) ?? [];
  const checker = revision.program.getTypeChecker();

  if (MEMBER_KINDS.has(symbol.kind) && nodes[0]?.parent && ts.isClassLike(nodes[0].parent)) {
    if (overridesInherited(checker, nodes[0].parent, symbol.name)) return 'override';
  }
  if (
    symbol.name === 'default' ||
    nodes.some((n) => isDefaultExport(n) || ts.isExportAssignment(n))
  ) {
    return 'default-export';
  }
  if (!symbol.exported) return undefined;
  return exportedFromEntry(revision, symbol, nodes) ? 'entry-export' : undefined;
}

/**
 * Whether code outside the repository can use the symbol: it is exported from the entry point
 * of a package that is published (not `"private": true`), and is not a private class member.
 */
export function publicApiTs(revision: TsRevision, symbol: SymbolDecl): boolean {
  if (!symbol.exported) return false;
  const nodes = revision.declarations.get(symbol.id) ?? [];
  const isPrivate = (node: ts.Node) => {
    const name = (node as { name?: ts.Node }).name;
    return (
      hasModifier(node, ts.SyntaxKind.PrivateKeyword) ||
      (name !== undefined && ts.isPrivateIdentifier(name))
    );
  };
  if (nodes.some(isPrivate)) return false;
  const pkg = nearestPackage(revision, symbol.file);
  if (!pkg || pkg.manifest.private === true) return false;
  return exportedFromEntry(revision, symbol, nodes);
}

/** Exported (directly or re-exported) by its package's entry; class members through their class. */
function exportedFromEntry(revision: TsRevision, symbol: SymbolDecl, nodes: ts.Node[]): boolean {
  const checker = revision.program.getTypeChecker();
  const owner = MEMBER_KINDS.has(symbol.kind) && nodes[0]?.parent ? [nodes[0].parent] : nodes;
  for (const entry of packageEntries(revision, symbol.file)) {
    const sf = revision.program.getSourceFile(entry);
    const module = sf && checker.getSymbolAtLocation(sf);
    if (!module) continue;
    for (const exported of checker.getExportsOfModule(module)) {
      const target =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (target.declarations?.some((d) => owner.some((n) => n === d || n === d.parent))) {
        return true;
      }
    }
  }
  return false;
}

function overridesInherited(
  checker: ts.TypeChecker,
  cls: ts.ClassLikeDeclaration,
  name: string,
): boolean {
  const bases: ts.Type[] = [];
  for (const clause of cls.heritageClauses ?? []) {
    for (const type of clause.types) bases.push(checker.getTypeAtLocation(type));
  }
  return bases.some((base) => base.getProperty(name) !== undefined);
}

/** Source entry files of the package that contains `file`. */
function packageEntries(revision: TsRevision, file: string): string[] {
  const pkg = nearestPackage(revision, file);
  const entry = pkg && sourceEntry(pkg.dir, pkg.manifest);
  return entry ? [entry] : [];
}

/** The nearest package.json above `file`, within the revision. */
function nearestPackage(
  revision: TsRevision,
  file: string,
): { dir: string; manifest: Record<string, unknown> } | undefined {
  for (
    let dir = dirname(join(revision.root, file));
    dir.startsWith(revision.root);
    dir = dirname(dir)
  ) {
    const path = join(dir, 'package.json');
    if (existsSync(path)) {
      const manifest = readJson(path) as Record<string, unknown> | undefined;
      return manifest ? { dir, manifest } : undefined;
    }
    if (dir === revision.root) break;
  }
  return undefined;
}
