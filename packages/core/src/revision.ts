import { resolve } from 'node:path';

/** A source tree for one side of a diff. */
export interface RevisionSource {
  /** Absolute path of the tree root. */
  readonly root: string;
  /** Commit SHA, when the tree comes from git. */
  readonly sha?: string;
  /** Releases the tree (for a worktree, unlocks its slot). Safe to call more than once. */
  dispose(): Promise<void>;
}

/** Uses a plain folder as a revision. Test fixtures use this. */
export function directorySource(root: string): RevisionSource {
  return { root: resolve(root), dispose: () => Promise.resolve() };
}
