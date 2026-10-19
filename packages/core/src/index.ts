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
  type PluginProject,
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
  type AnalysisPhase,
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
export {
  changeProjects,
  projectResolver,
  type DeclaredProject,
  type Project,
  type ProjectKind,
  type ProjectSide,
  type ProjectSource,
} from './projects.js';
export { listTreeAt, readFileAtRevision } from './git/show.js';
export { mapLine, workingLine, type LineHunk, type WorkingLine } from './git/working-line.js';
export {
  commitDetails,
  hasCommitGraph,
  HISTORY_SCOPES,
  historyState,
  isCommit,
  parseLog,
  streamHistory,
  type Commit,
  type CommitRef,
  type HistoryPage,
  type HistoryRow,
  type HistoryScope,
  type HistoryRefs,
  type HistoryShape,
  type HistoryState,
} from './git/log.js';
export { fetchRefs, remoteUrl } from './git/remote.js';
export {
  listRefs,
  type LocalBranch,
  type RefList,
  type RemoteBranch,
  type Tag,
} from './git/refs.js';
export {
  checkMerge,
  commitsBetween,
  defaultBranch,
  defaultBranchTips,
  forkPoint,
  isAncestor,
  mergeBase,
  trackedFiles,
  upstreamOf,
  userEmail,
  type BranchMerge,
  type BranchReviewInfo,
  type BranchReviewList,
  type BranchReviewRef,
  type BranchReviewSummary,
  type FinishResult,
  type LocalReview,
  type MergeCheck,
  type Verdict,
  type VerdictComment,
  type VerdictEvent,
} from './git/branches.js';
export {
  AGENT_KINDS,
  PERMISSION_MODES,
  WORK_KINDS,
  type AgentKind,
  type AgentOption,
  type BriefPart,
  type BriefParts,
  type CheckGuess,
  type AgentStateName,
  type WorkspaceAgentState,
  type WorkspaceList,
  type WorkspaceOptions,
  type WorkspaceReplied,
  type WorkspaceReply,
  type WorkspaceRequest,
  type WorkspaceStart,
  type WorkspaceSummary,
  type WorkspaceTerminalRequest,
  type WorkspaceThread,
  type PermissionMode,
  type TerminalAvailability,
  type ThreadEntry,
  type ThreadQuestion,
  type WorkKind,
  type WorkKindSpec,
} from './workspaces.js';
export {
  commitSubject,
  fastForwardBranch,
  mergeInWorktree,
  MergeStepRefused,
  pushCommit,
  resetMergeWorktree,
  type MergeOutcome,
} from './git/merging.js';
export {
  MERGE_STATES,
  type MergeCheckRun,
  type MergeEntry,
  type MergeList,
  type MergeRequest,
  type MergeState,
  type MergeTargets,
} from './merges.js';
export {
  addWorktree,
  branchNameProblem,
  commitFolders,
  deleteMergedBranch,
  listWorktrees,
  mainWorktree,
  removeWorktree,
  uncommittedFiles,
  WorktreeRefused,
  type Worktree,
} from './git/worktrees.js';
export {
  checkout,
  CheckoutRefused,
  UnknownCheckoutTarget,
  workingState,
  type CheckoutResult,
  type CheckoutTarget,
  type Operation,
  type RepoStatus,
  type WorkingState,
} from './git/checkout.js';
