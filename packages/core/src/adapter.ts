import type { EdgeRef, SymbolDecl } from './model.js';
import type { RevisionSource } from './revision.js';

export interface LoadOptions {
  /** Config file to load, relative to the revision root (e.g. a tsconfig). Default: auto-detect. */
  project?: string;
  /** Repo-relative files that must be analyzable even if no config includes them. */
  files?: readonly string[];
}

/**
 * Everything language-specific lives behind this interface; diffing, detectors and graph
 * output are shared. `L` is the adapter's loaded form of one revision.
 */
export interface LanguageAdapter<L = unknown> {
  readonly id: string;
  /** Whether this adapter analyzes the file at this repo-relative path. */
  matches(path: string): boolean;
  load(source: RevisionSource, options?: LoadOptions): Promise<L>;
  /** Declarations in the given repo-relative files. Files that do not exist are skipped. */
  extract(revision: L, files: readonly string[]): SymbolDecl[];
  /** References to an extracted symbol from elsewhere in the revision: its callers and users. */
  incoming(revision: L, symbol: SymbolDecl): EdgeRef[];
  /** What an extracted symbol references: callees, types, base classes. */
  outgoing(revision: L, symbol: SymbolDecl): EdgeRef[];
  /** Problems worth telling the user about (configs that failed to load, skipped files). */
  warnings(revision: L): string[];
}
