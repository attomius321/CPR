import type { PluginContext, PluginRevision, TsPlugin } from '@cpr/core';
import { componentContract } from './components.js';
import { isLoaderOrAction, routerFiles, routerUses, type RouterUses } from './exposures.js';
import { dependencies, QWIK_PACKAGES, qwikProjects, type Projects } from './projects.js';

const VERSION = '0.1.0';

const QWIK_IMPORT = /from\s*['"](?:@builder\.io\/qwik|@qwik\.dev\/core)['"/]/;

const projectsByRevision = new WeakMap<PluginContext['syntax'], Projects>();
const usesByProgram = new WeakMap<PluginRevision['program'], RouterUses>();
const routerFilesByProgram = new WeakMap<
  PluginRevision['program'],
  ReturnType<typeof routerFiles>
>();

/**
 * Qwik for CPR: what Qwik's router calls by name (request handlers, `head`, loaders, actions,
 * entries) is not an orphan, and a `component$`'s props are its contract, compared from the
 * side of the JSX that passes them.
 */
const qwik: TsPlugin = {
  name: 'qwik',
  version: VERSION,
  apiVersion: 1,

  // At the root, or in any project below it (a repo can hold several apps).
  applies: (revision) =>
    [...dependencies(revision.packageJson)].some((name) => QWIK_PACKAGES.has(name)) ||
    revision.sourceFiles().some((file) => QWIK_IMPORT.test(revision.syntax(file)?.text ?? '')),

  contract: (revision, declaration) => componentContract(revision, declaration),

  exposure: (revision, symbol) => {
    const uses = usesOf(revision);
    if (uses.byName.has(symbol.id)) return 'framework';
    const declaration = uses.ifLoader.get(symbol.id);
    if (declaration && isLoaderOrAction(revision, declaration, routerFilesOf(revision))) {
      return 'framework';
    }
    return undefined;
  },

  warnings: (revision) => projectsOf(revision).warnings,
};

export default qwik;
export { qwik as plugin };

function projectsOf(revision: PluginContext): Projects {
  let projects = projectsByRevision.get(revision.syntax);
  if (!projects) projectsByRevision.set(revision.syntax, (projects = qwikProjects(revision)));
  return projects;
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
