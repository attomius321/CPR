import type { LanguageAdapter, Peers } from './adapter.js';
import { stylesheetAdapter } from './lang/css/index.js';
import { createTypescriptAdapter, type TypescriptAdapterOptions } from './lang/typescript/index.js';
import type { Dangling, EdgeRef, SymbolDecl } from './model.js';
import type { DeclaredProject } from './projects.js';

/**
 * The adapter Symbiote analyzes with: TypeScript and JavaScript (with the given framework
 * plugins) and stylesheets.
 */
export function createAdapter(options: TypescriptAdapterOptions = {}): LanguageAdapter {
  return combineAdapters([createTypescriptAdapter(options), stylesheetAdapter]);
}

/** `createAdapter()` without plugins: the default of `analyzeGit` and `analyzeDirectories`. */
export const defaultAdapter: LanguageAdapter = createAdapter();

/** One loaded revision per adapter, in the adapters' order. */
export interface CombinedRevision {
  readonly parts: readonly unknown[];
}

/**
 * Several languages as one adapter: a file, and a symbol by its file, go to the first adapter
 * that reads that file, so each adapter sees only its own (TypeScript never meets a stylesheet).
 */
export function combineAdapters(
  adapters: readonly LanguageAdapter[],
): LanguageAdapter<CombinedRevision> {
  const owner = (path: string) => adapters.findIndex((adapter) => adapter.matches(path));
  /** The adapter of a symbol's file, with its part of the revision. */
  const of = (revision: CombinedRevision, symbol: SymbolDecl) => {
    const i = owner(symbol.file);
    return i < 0 ? undefined : { adapter: adapters[i] as LanguageAdapter, part: revision.parts[i] };
  };
  /** Files grouped by the adapter that reads them, in the adapters' order. */
  const byOwner = <T>(items: readonly T[], file: (item: T) => string) =>
    adapters.map((_, i) => items.filter((item) => owner(file(item)) === i));

  return {
    id: adapters.map((adapter) => adapter.id).join('+'),
    matches: (path) => owner(path) >= 0,
    load: async (source, options = {}) => {
      const files = options.files && byOwner(options.files, (file) => file);
      const parts: unknown[] = [];
      // What every language names of the others, once all have loaded (asked lazily).
      const peers: Peers = {
        mentions: (query) =>
          adapters.flatMap((adapter, i) => adapter.mentions?.(parts[i], query) ?? []),
        styleScopes: () => adapters.flatMap((adapter, i) => adapter.styleScopes?.(parts[i]) ?? []),
      };
      // One after the other: a TypeScript program is large, and its load is mostly synchronous.
      for (const [i, adapter] of adapters.entries()) {
        const own = files ? { ...options, files: files[i] } : options;
        parts.push(await adapter.load(source, { ...own, peers }));
      }
      return { parts };
    },
    extract: (revision, files, options) =>
      byOwner(files, (file) => file).flatMap((own, i) =>
        own.length === 0
          ? []
          : (adapters[i] as LanguageAdapter).extract(revision.parts[i], own, options),
      ),
    incoming: (revision, symbol): EdgeRef[] => {
      const found = of(revision, symbol);
      return found ? found.adapter.incoming(found.part, symbol) : [];
    },
    outgoing: (revision, symbol): EdgeRef[] => {
      const found = of(revision, symbol);
      if (!found) return [];
      const refs = found.adapter.outgoing(found.part, symbol);
      // What it names of another language: the rules its classes reach.
      const mentions = found.adapter.mentions?.(found.part, { from: symbol.id }) ?? [];
      if (mentions.length === 0) return refs;
      for (const [i, adapter] of adapters.entries()) {
        if (adapter !== found.adapter && adapter.mentioned) {
          refs.push(...adapter.mentioned(revision.parts[i], mentions));
        }
      }
      return refs;
    },
    dangling: (revision, removed, base) =>
      byOwner(removed, (symbol) => symbol.file).flatMap((own, i): Dangling[] =>
        own.length === 0
          ? []
          : (adapters[i] as LanguageAdapter).dangling(revision.parts[i], own, base.parts[i]),
      ),
    exposure: (revision, symbol) => {
      const found = of(revision, symbol);
      return found?.adapter.exposure(found.part, symbol);
    },
    publicApi: (revision, symbol) => {
      const found = of(revision, symbol);
      return found ? found.adapter.publicApi(found.part, symbol) : false;
    },
    projects: (revision) =>
      adapters.flatMap((adapter, i): DeclaredProject[] =>
        adapter.projects ? adapter.projects(revision.parts[i]) : [],
      ),
    languageOf: (path) => {
      const i = owner(path);
      return i < 0 ? undefined : adapters[i]?.languageOf?.(path);
    },
    warnings: (revision) => adapters.flatMap((adapter, i) => adapter.warnings(revision.parts[i])),
  };
}
