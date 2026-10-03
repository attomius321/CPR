import type { PluginContext, PluginRevision, PluginSymbol, TsPlugin } from '@cpr/core';
import { componentContract } from './components.js';
import { isLoaderOrAction, routerFiles, routerUses, type RouterUses } from './exposures.js';
import { mdxNodes, mdxRoutes, mdxSymbol, type MdxRoutes } from './mdx-routes.js';
import { shimPath } from './mdx-shim.js';
import { dependencies, QWIK_PACKAGES, qwikProjects, type Projects } from './projects.js';

const VERSION = '0.1.0';

const QWIK_IMPORT = /from\s*['"](?:@builder\.io\/qwik|@qwik\.dev\/core)['"/]/;

const projectsByRevision = new WeakMap<PluginContext['syntax'], Projects>();
const mdxByRevision = new WeakMap<PluginContext['syntax'], MdxRoutes>();
const usesByProgram = new WeakMap<PluginRevision['program'], RouterUses>();
const routerFilesByProgram = new WeakMap<
  PluginRevision['program'],
  ReturnType<typeof routerFiles>
>();

/**
 * Qwik for CPR: what Qwik's router calls by name (request handlers, `head`, loaders, actions,
 * entries) is not an orphan, a `component$`'s props are its contract, compared from the side of
 * the JSX that passes them, and `.mdx` routes are templates whose components and expressions are
 * uses.
 */
const qwik: TsPlugin = {
  name: 'qwik',
  version: VERSION,
  apiVersion: 1,

  // At the root, or in any project below it (a repo can hold several apps).
  applies: (revision) =>
    [...dependencies(revision.packageJson)].some((name) => QWIK_PACKAGES.has(name)) ||
    revision.sourceFiles().some((file) => QWIK_IMPORT.test(revision.syntax(file)?.text ?? '')),

  matches: (path) => path.endsWith('.mdx'),

  virtualFiles: (revision) => [...mdxOf(revision).byFile.values()].map((route) => route.shim),

  extract: (revision, files) => {
    const routes = mdxOf(revision);
    const found: PluginSymbol[] = [];
    for (const file of files) {
      const route = routes.byFile.get(file);
      if (!route) continue;
      const shim = revision.virtual(shimPath(file));
      found.push({
        symbol: mdxSymbol(revision.ts, route),
        nodes: shim ? mdxNodes(revision.ts, shim) : [],
      });
    }
    return found;
  },

  contract: (revision, declaration) => componentContract(revision, declaration),

  exposure: (revision, symbol) => {
    // An MDX route is rendered by the router; every one of them calls the MDX provider.
    const mdx = mdxOf(revision);
    if (symbol.kind === 'template' && mdx.byFile.has(symbol.file)) return 'framework';
    if (symbol.name === 'useMDXComponents' && mdx.providers.has(symbol.file)) return 'framework';
    const uses = usesOf(revision);
    if (uses.byName.has(symbol.id)) return 'framework';
    const declaration = uses.ifLoader.get(symbol.id);
    if (declaration && isLoaderOrAction(revision, declaration, routerFilesOf(revision))) {
      return 'framework';
    }
    return undefined;
  },

  warnings: (revision) => [...projectsOf(revision).warnings, ...mdxOf(revision).warnings],
};

export default qwik;
export { qwik as plugin };

function projectsOf(revision: PluginContext): Projects {
  let projects = projectsByRevision.get(revision.syntax);
  if (!projects) projectsByRevision.set(revision.syntax, (projects = qwikProjects(revision)));
  return projects;
}

function mdxOf(revision: PluginContext): MdxRoutes {
  let routes = mdxByRevision.get(revision.syntax);
  if (!routes)
    mdxByRevision.set(revision.syntax, (routes = mdxRoutes(revision, projectsOf(revision))));
  return routes;
}

function usesOf(revision: PluginRevision): RouterUses {
  let uses = usesByProgram.get(revision.program);
  if (!uses)
    usesByProgram.set(revision.program, (uses = routerUses(revision, projectsOf(revision))));
  return uses;
}

function routerFilesOf(revision: PluginRevision): ReturnType<typeof routerFiles> {
  let found = routerFilesByProgram.get(revision.program);
  if (!found) routerFilesByProgram.set(revision.program, (found = routerFiles(revision)));
  return found;
}
