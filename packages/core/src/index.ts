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
export { listChangedLines, parseChangedLines, type ChangedLines } from './git/changed-lines.js';
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
  Shape,
  Position,
  Range,
  Site,
  SymbolDecl,
  SymbolId,
  SymbolKind,
} from './model.js';
export type { LanguageAdapter, LoadOptions } from './adapter.js';
export {
  createTypescriptAdapter,
  typescriptAdapter,
  type TsRevision,
  type TypescriptAdapterOptions,
} from './lang/typescript/index.js';
/** TypeScript's types, for plugins: the values come from `PluginContext.ts`. */
export type { ts } from 'ts-morph';
export {
  PLUGIN_API_VERSION,
  type ArgumentRoles,
  type Contract,
  type MappedPosition,
  type PluginContext,
  type PluginRevision,
  type PluginSymbol,
  type TsPlugin,
  type VirtualFile,
} from './lang/typescript/plugins.js';
export {
  changeFingerprint,
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
  type SinceInfo,
  type SinceStatus,
} from './pipeline.js';
export { linkNodeModules } from './deps.js';
export { isTestFile, runDetectors, type DetectorInput } from './detectors.js';
export { DEFAULT_IGNORES, ignoreMatcher, loadIgnores, type IgnoreMatcher } from './ignore.js';
export {
  buildGraph,
  SCHEMA_VERSION,
  type BuildGraphOptions,
  type Graph,
  type GraphChangeRequest,
  type GraphEdge,
  type GraphNode,
  type GraphPlugin,
  type GraphSide,
} from './graph.js';
export { compareShapes, compatibility, type Compatibility } from './compat.js';
export { readFileAtRevision } from './git/show.js';
export { fetchRefs, remoteUrl } from './git/remote.js';
