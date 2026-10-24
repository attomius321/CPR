import type {
  Dangling,
  EdgeRef,
  Exposure,
  Mention,
  MentionQuery,
  StyleScope,
  SymbolDecl,
  SymbolId,
} from './model.js';
import type { IgnoreMatcher } from './ignore.js';
import type { DeclaredProject } from './projects.js';
import type { RevisionSource } from './revision.js';

export interface LoadOptions {
  /** Config file to load, relative to the revision root (e.g. a tsconfig). Default: auto-detect. */
  project?: string;
  /** Repo-relative files that must be analyzable even if no config includes them. */
  files?: readonly string[];
  /**
   * Repo-relative paths left out of analysis and of the program. Default: the default ignores
   * plus the `.symbioteignore` at the revision's root.
   */
  ignore?: IgnoreMatcher;
  /**
   * What the other languages of the analysis name of this one (markup's classes, for
   * stylesheets): given by `combineAdapters`, usable once every language has loaded.
   */
  peers?: Peers;
}

/** The other languages' mentions and style scopes, for the language that defines the names. */
export interface Peers {
  mentions(query: MentionQuery): Mention[];
  styleScopes(): StyleScope[];
}

export interface ExtractOptions {
  /**
   * Whether to infer types (return types, variable types) for a symbol. Inference is the costly
   * part of extraction; without it, inferred types are left out of hashes and signatures.
   * Default: always.
   */
  infer?: (id: SymbolId) => boolean;
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
  extract(revision: L, files: readonly string[], options?: ExtractOptions): SymbolDecl[];
  /** References to an extracted symbol from elsewhere in the revision: its callers and users. */
  incoming(revision: L, symbol: SymbolDecl): EdgeRef[];
  /** What an extracted symbol references: callees, types, base classes. */
  outgoing(revision: L, symbol: SymbolDecl): EdgeRef[];
  /**
   * Uses of the removed symbols in this revision (head) that no longer resolve; `removed` also
   * holds the old declarations of moved and renamed symbols. `base` is the revision they come
   * from, for uses found by what the symbol was (a selector, say) rather than by its name.
   */
  dangling(revision: L, removed: readonly SymbolDecl[], base: L): Dangling[];
  /** Why an extracted symbol may be used without in-repo references, if it may. */
  exposure(revision: L, symbol: SymbolDecl): Exposure | undefined;
  /** Whether code outside the repository can use the symbol (a published package's API). */
  publicApi(revision: L, symbol: SymbolDecl): boolean;
  /**
   * Projects the revision's frameworks declare (from plugins, e.g. `angular.json`'s), before
   * those found by convention (workspaces, packages).
   */
  projects?(revision: L): DeclaredProject[];
  /**
   * The language of a repo-relative file it reads (`css`), when it is not the analysis's default
   * (TypeScript); for nodes without a declaration, such as a file's top-level code.
   */
  languageOf?(path: string): string | undefined;
  /** Where this language's code names what another defines: classes, custom properties. */
  mentions?(revision: L, query: MentionQuery): Mention[];
  /** Stylesheets this language's code applies to only some markup (a component's own). */
  styleScopes?(revision: L): StyleScope[];
  /**
   * Edges from another language's mentions to this one's symbols: a rendered class to the rules
   * that style it. Needs `LoadOptions.peers` for the scopes.
   */
  mentioned?(revision: L, mentions: readonly Mention[]): EdgeRef[];
  /** Problems worth telling the user about (configs that failed to load, skipped files). */
  warnings(revision: L): string[];
}
