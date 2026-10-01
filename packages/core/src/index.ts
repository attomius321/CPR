/** Version of the graph JSON contract. See docs/graph-schema.md. */
export const SCHEMA_VERSION = '0.1.0';

export { CprError } from './errors.js';
export { directorySource, type RevisionSource } from './revision.js';
export { openRepo, type GitRepo } from './git/repo.js';
export {
  NoMergeBaseError,
  resolveCommit,
  resolveRevisions,
  type ResolveOptions,
  type ResolvedRevisions,
} from './git/revisions.js';
export {
  listChangedFiles,
  parseNameStatus,
  type ChangedFile,
  type FileChangeStatus,
} from './git/changed-files.js';
export { checkoutRevision, defaultCacheDir, type CheckoutOptions } from './git/worktree.js';
