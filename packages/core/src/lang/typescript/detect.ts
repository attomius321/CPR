import { existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { ts } from 'ts-morph';
import type { Dangling, Exposure, SymbolDecl } from '../../model.js';
import { isTsSource } from './files.js';
import { readJson, repoPath, sourceEntry, type TsRevision } from './project.js';
import { enclosingSymbolId, isDefaultExport } from './syntax.js';

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

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && byName.has(node.text) && !isDeclarationName(node)) {
        const result = classify(node, typed);
        if (result) {
          const from = enclosingSymbolId(node, sf, file);
          if (from) {
            const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            for (const target of byName.get(node.text) ?? []) {
              found.push({
                target: target.id,
                from,
                site: { file, line: line + 1, col: character + 1 },
                certainty: result.certainty,
                viaImport:
                  result.importedFrom !== undefined && sameModule(result.importedFrom, target.file),
              });
            }
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

  // A class member is public API when its class is.
  const owner = MEMBER_KINDS.has(symbol.kind) && nodes[0]?.parent ? [nodes[0].parent] : nodes;
  for (const entry of packageEntries(revision, symbol.file)) {
    const sf = revision.program.getSourceFile(entry);
    const module = sf && checker.getSymbolAtLocation(sf);
    if (!module) continue;
    for (const exported of checker.getExportsOfModule(module)) {
      const target =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (target.declarations?.some((d) => owner.some((n) => n === d || n === d.parent))) {
        return 'entry-export';
      }
    }
  }
  return undefined;
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

/** Source entry files of the package that contains `file` (nearest package.json). */
function packageEntries(revision: TsRevision, file: string): string[] {
  for (
    let dir = dirname(join(revision.root, file));
    dir.startsWith(revision.root);
    dir = dirname(dir)
  ) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = readJson(manifest) as Record<string, unknown> | undefined;
      const entry = pkg && sourceEntry(dir, pkg);
      return entry ? [entry] : [];
    }
    if (dir === revision.root) break;
  }
  return [];
}
