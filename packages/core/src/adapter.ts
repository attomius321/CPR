import type { SymbolDecl } from './model.js';
import type { RevisionSource } from './revision.js';

export interface LoadOptions {
  /** Config file to load, relative to the revision root (e.g. a tsconfig). Default: auto-detect. */
  project?: string;
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
}
