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
export type {
  Dangling,
  Edge,
  EdgeKind,
  EdgeRef,
  Exposure,
  Finding,
  RuleId,
  Severity,
  Position,
  Range,
  Site,
  SymbolDecl,
  SymbolId,
  SymbolKind,
} from './model.js';
export type { LanguageAdapter, LoadOptions } from './adapter.js';
export { typescriptAdapter, type TsRevision } from './lang/typescript/index.js';
export {
  diffSymbols,
  MIN_MOVE_BODY_SIZE,
  type ChangeStatus,
  type Delta,
  type DiffInput,
  type SymbolChange,
} from './diff.js';
export { listChangedFilesInDirectories } from './fs-diff.js';
export {
  analyzeDirectories,
  analyzeGit,
  type Analysis,
  type AnalyzeGitOptions,
  type AnalyzeOptions,
  type ContextSymbol,
  type RevisionsInfo,
} from './pipeline.js';
export { linkNodeModules } from './deps.js';
export { runDetectors, type DetectorInput } from './detectors.js';
export { DEFAULT_IGNORES, ignoreMatcher, loadIgnores, type IgnoreMatcher } from './ignore.js';
