import type { LanguageAdapter } from '../../adapter.js';
import type { Dangling } from '../../model.js';
import { danglingTs, exposureTs, publicApiTs } from './detect.js';
import { extractTs } from './extract.js';
import { isTsSource } from './files.js';
import { PLUGIN_API_VERSION, runHook, type TsPlugin } from './plugins.js';
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
        `plugin ${plugin.name} targets plugin API ${apiVersion}; this CPR implements ${PLUGIN_API_VERSION}`,
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
      if (own) return own;
      for (const active of revision.plugins) {
        const exposure = active.plugin.exposure;
        if (!exposure) continue;
        const why = runHook(active, 'exposure', revision.warnings, undefined, () =>
          exposure(pluginRevision(revision, active), symbol),
        );
        if (why) return why;
      }
      return undefined;
    },
    publicApi: publicApiTs,
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
