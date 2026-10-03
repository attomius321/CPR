import { posix } from 'node:path';
import type { PluginRevision, ts } from '@cpr/core';
import { calls, unwrap } from './imports.js';
import { parseJson, ROUTER_PACKAGES, type Projects } from './projects.js';
import { HANDLERS, moduleKind, routeExports } from './routes.js';

const LOADERS_AND_ACTIONS = new Set(['routeLoader$', 'routeAction$', 'globalAction$']);
/** The router's types for them (`Loader` is declared as `Loader_2` in its typings). */
const ROUTER_TYPES = new Set(['Loader', 'Loader_2', 'Action']);
const ROUTERS = new Set(ROUTER_PACKAGES.keys());

/** What the router uses of a revision, by symbol ID. */
export interface RouterUses {
  /** Read by name, or every export of an entry. */
  byName: Set<string>;
  /** Other exports of pages and layouts: used when they are loaders or actions. */
  ifLoader: Map<string, ts.VariableDeclaration>;
}

/**
 * Every export the router reads: from each page, layout, server plugin, entry and service worker
 * module, followed through re-exports (`export { useProduct } from '~/loaders/product'`) to the
 * declaration it names.
 */
export function routerUses(revision: PluginRevision, projects: Projects): RouterUses {
  const uses: RouterUses = { byName: new Set(), ifLoader: new Map() };
  const { checker, program, root } = revision;
  const tsApi = revision.ts;
  for (const file of revision.sourceFiles()) {
    const project = projects.of(file);
    const kind = project && moduleKind(project, file);
    if (!project || !kind) continue;
    const sf = program.getSourceFile(posix.join(root, file));
    const module = sf && checker.getSymbolAtLocation(sf);
    if (!module) continue;
    const named = kind === 'plugin' ? HANDLERS : routeExports(project);
    for (const exported of checker.getExportsOfModule(module)) {
      const target =
        exported.flags & tsApi.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      for (const [id, declaration] of declarations(revision, target)) {
        if (kind === 'app-entry' || kind === 'entry' || kind === 'service-worker') {
          uses.byName.add(id);
        } else if (named.has(exported.name)) {
          uses.byName.add(id);
        } else if (kind !== 'plugin' && tsApi.isVariableDeclaration(declaration)) {
          uses.ifLoader.set(id, declaration);
        }
      }
    }
  }
  return uses;
}

/**
 * Whether a variable holds a loader or an action: typed as the router's `Loader` or `Action`
 * (any wrapper, e.g. a form library's), or made by `routeLoader$`, `routeAction$` or
 * `globalAction$` imported from the router (Qwik not installed).
 */
export function isLoaderOrAction(
  revision: PluginRevision,
  declaration: ts.VariableDeclaration,
  routerFile: (fileName: string) => boolean,
): boolean {
  const tsApi = revision.ts;
  const value = unwrap(tsApi, declaration.initializer);
  if (value && tsApi.isCallExpression(value) && calls(tsApi, value, ROUTERS, LOADERS_AND_ACTIONS))
    return true;
  const type = revision.checker.getTypeAtLocation(declaration.name);
  const alias = type.aliasSymbol;
  return (
    !!alias &&
    ROUTER_TYPES.has(alias.name) &&
    !!alias.declarations?.some((d) => routerFile(d.getSourceFile().fileName))
  );
}

/**
 * Whether a file belongs to Qwik's router: installed (`node_modules/@builder.io/qwik-city/…`)
 * or, in a monorepo, a package named like it (Qwik's own repo).
 */
export function routerFiles(revision: PluginRevision): (fileName: string) => boolean {
  const byFolder = new Map<string, boolean>();
  const named = (folder: string): boolean => {
    let found = byFolder.get(folder);
    if (found === undefined) {
      const rel = posix.relative(revision.root, folder);
      const manifest = rel.startsWith('..')
        ? undefined
        : parseJson(revision.readFile(posix.join(rel, 'package.json')));
      found =
        typeof manifest?.name === 'string'
          ? ROUTERS.has(manifest.name)
          : folder !== revision.root &&
            folder !== posix.dirname(folder) &&
            named(posix.dirname(folder));
      byFolder.set(folder, found);
    }
    return found;
  };
  return (fileName) => {
    if (/\/node_modules\/(?:@builder\.io\/qwik-city|@qwik\.dev\/router)\//.test(fileName))
      return true;
    if (fileName.includes('/node_modules/') || !fileName.startsWith(`${revision.root}/`))
      return false;
    return named(posix.dirname(fileName));
  };
}

/** The repo symbols a module symbol stands for: top-level declarations in repo files. */
function declarations(revision: PluginRevision, symbol: ts.Symbol): [string, ts.Declaration][] {
  const tsApi = revision.ts;
  const found: [string, ts.Declaration][] = [];
  for (const declaration of symbol.declarations ?? []) {
    const sf = declaration.getSourceFile();
    if (sf.isDeclarationFile || !sf.fileName.startsWith(`${revision.root}/`)) continue;
    if (sf.fileName.includes('/node_modules/')) continue;
    const file = sf.fileName.slice(revision.root.length + 1);
    const name = topLevelName(tsApi, declaration);
    if (name) found.push([`${file}#${name}`, declaration]);
  }
  return found;
}

/** A top-level declaration's name as CPR names symbols (`default` for anonymous defaults). */
function topLevelName(tsApi: typeof ts, declaration: ts.Declaration): string | undefined {
  if (tsApi.isVariableDeclaration(declaration)) {
    const statement = declaration.parent.parent;
    return tsApi.isIdentifier(declaration.name) && tsApi.isSourceFile(statement.parent)
      ? declaration.name.text
      : undefined;
  }
  if (tsApi.isExportAssignment(declaration)) return 'default';
  if (
    (tsApi.isFunctionDeclaration(declaration) || tsApi.isClassDeclaration(declaration)) &&
    tsApi.isSourceFile(declaration.parent)
  ) {
    return declaration.name?.text ?? 'default';
  }
  return undefined;
}
