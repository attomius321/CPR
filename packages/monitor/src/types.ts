/**
 * What a file is, for what counts as the repository's code (RM1, decision 323): its own source,
 * its tests, its docs, its data, anything else, or set aside (not written here, or not text).
 */
export type FileKind = 'source' | 'test' | 'docs' | 'data' | 'other' | 'aside';

/**
 * Why a file is set aside: not text (`binary`), a package manager's lockfile, marked
 * `linguist-generated` or `linguist-vendored` in `.gitattributes`, left out by `.symbioteignore`
 * or its defaults (`ignored`), or a minified bundle (`*.min.*`).
 */
export type AsideReason = 'binary' | 'lockfile' | 'generated' | 'vendored' | 'ignored' | 'minified';

/** A text's lines: each one blank, a comment (only a comment), or code (anything else). */
export interface LineCounts {
  lines: number;
  code: number;
  comments: number;
  blank: number;
}

/** A file at the commit read, with its kind, its language and its lines. */
export interface CodeFile extends LineCounts {
  /** Repo-relative POSIX path. */
  path: string;
  kind: FileKind;
  /** Why the file is set aside, when its kind is `aside`. */
  aside?: AsideReason;
  /** `TypeScript`, `CSS`, …; `Text` in no known language; `Binary` when not text. */
  language: string;
}

/** Every file of a commit, counted (`GET /api/monitor`, RM1). */
export interface CodeMap {
  version: 1;
  /** The full SHA read. */
  commit: string;
  /** The branch checked out, when `HEAD` is on one. */
  branch?: string;
  /** Sorted by path. Symlinks and submodules are not this repository's code: left out. */
  files: CodeFile[];
}
