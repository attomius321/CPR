import { posix } from 'node:path';
import type { LanguageAdapter } from '../../adapter.js';
import type { Dangling } from '../../model.js';
import type { DeclaredProject } from '../../projects.js';
import { danglingTs, exposureTs, publicApiTs } from './detect.js';
import { extractTs } from './extract.js';
import { isTsSource } from './files.js';
import { PLUGIN_API_VERSION, runHook, type PluginProject, type TsPlugin } from './plugins.js';
import { loadTsProject, pluginRevision, type TsRevision } from './project.js';
import { incomingTs, outgoingTs } from './references.js';

export type { TsRevision } from './project.js';

export interface TypescriptAdapterOptions {
  /** Framework plugins (e.g. Angular templates); none by default. */
  plugins?: readonly TsPlugin[];
}

/**
 * The TypeScript/JavaScript adapter, optionally extended by plugins. Without plugins it is the
 * same adapter for every project; plugins only add (files, symbols, references, exposures).
 */
export function createTypescriptAdapter({
  plugins = [],
}: TypescriptAdapterOptions = {}): LanguageAdapter<TsRevision> {
  for (const plugin of plugins) {
    const apiVersion: number = plugin.apiVersion;
    if (apiVersion !== PLUGIN_API_VERSION) {
      throw new Error(
        `plugin ${plugin.name} targets plugin API ${apiVersion}; this Symbiote implements ${PLUGIN_API_VERSION}`,
      );
    }
  }
  const matchers = plugins.flatMap((plugin) => (plugin.matches ? [plugin] : []));

  return {
    id: 'typescript',
    matches: (path) =>
      isTsSource(path) ||
      matchers.some((plugin) => {
        try {
          return plugin.matches?.(path) ?? false;
        } catch {
          return false;
        }
      }),
    // Defer so a bad config rejects instead of throwing synchronously.
    load: (source, options) =>
      Promise.resolve().then(() => loadTsProject(source, options, plugins)),
    extract: extractTs,
    incoming: incomingTs,
    outgoing: outgoingTs,
    dangling: (revision, removed, base) => {
      const found = danglingTs(revision, removed);
      for (const active of revision.plugins) {
        const dangling = active.plugin.dangling;
        // Only a plugin that applies to both sides can compare them.
        const before = base.plugins.find((p) => p.plugin === active.plugin);
        if (!dangling || !before || before.failed) continue;
        found.push(
          ...runHook(active, 'dangling', revision.warnings, [] as Dangling[], () =>
            dangling(pluginRevision(revision, active), removed, pluginRevision(base, before)),
          ),
        );
      }
      return found;
    },
    exposure: (revision, symbol) => {
      const own = exposureTs(revision, symbol);
      // That a default export is loaded by convention is a guess: a plugin may know.
      if (own && own !== 'default-export') return own;
      for (const active of revision.plugins) {
        const exposure = active.plugin.exposure;
        if (!exposure) continue;
        const why = runHook(active, 'exposure', revision.warnings, undefined, () =>
          exposure(pluginRevision(revision, active), symbol),
        );
        if (why) return why;
      }
      return own;
    },
    publicApi: publicApiTs,
    projects: (revision) => {
      const found: DeclaredProject[] = [];
      for (const active of revision.plugins) {
        const projects = active.plugin.projects;
        if (!projects) continue;
        const declared = runHook(active, 'projects', revision.warnings, [] as PluginProject[], () =>
          projects(revision.context),
        );
        for (const { folder, name, kind } of declared) {
          const skip = (why: string) =>
            revision.warnings.push(`plugin ${active.plugin.name}: ${why}; skipped`);
          // Plugins are not type-checked against this contract at run time.
          if (typeof folder !== 'string' || typeof name !== 'string') {
            skip('a project without a folder or name');
            continue;
          }
          const repoFolder = inRepo(folder);
          if (repoFolder === undefined) {
            skip(`project folder ${folder} is outside the repository`);
            continue;
          }
          found.push({
            folder: repoFolder,
            name,
            ...(kind === 'application' || kind === 'library' ? { kind } : {}),
            plugin: active.plugin.name,
          });
        }
      }
      return found;
    },
    warnings: (revision) => {
      for (const active of revision.plugins) {
        const warnings = active.plugin.warnings;
        if (!warnings) continue;
        const found = runHook(active, 'warnings', revision.warnings, [] as string[], () =>
          warnings(pluginRevision(revision, active)),
        );
        for (const warning of found) {
          const text = `plugin ${active.plugin.name}: ${warning}`;
          if (!revision.warnings.includes(text)) revision.warnings.push(text);
        }
      }
      return revision.warnings;
    },
  };
}

export const typescriptAdapter: LanguageAdapter<TsRevision> = createTypescriptAdapter();

/** A plugin's repo-relative folder, normalized (`./src/` → `src`, `.` → `''`); undefined outside.
 * */
function inRepo(folder: string): string | undefined {
  const normalized = posix.normalize(folder.replace(/\\/g, '/')).replace(/\/$/, '');
  if (normalized === '..' || normalized.startsWith('../') || posix.isAbsolute(normalized)) {
    return undefined;
  }
  return normalized === '.' ? '' : normalized;
}
