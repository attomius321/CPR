export { SymbioteError } from './errors.js';
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
  listLineCounts,
  parseNameStatus,
  parseNumstat,
  type ChangedFile,
  type FileChangeStatus,
  type LineCount,
} from './git/changed-files.js';
export {
  fileChangedSince,
  listChangedLines,
  parseChangedLines,
  type ChangedLines,
} from './git/changed-lines.js';
export { fileDiff, type ReviewFile } from './git/file-diff.js';
export { checkoutRevision, defaultCacheDir, type CheckoutOptions } from './git/worktree.js';
export type {
  Dangling,
  Edge,
  EdgeKind,
  EdgeRef,
  Exposure,
  Finding,
  Mention,
  MentionQuery,
  RuleId,
  Severity,
  Shape,
  Position,
  Range,
  Site,
  StyleScope,
  SymbolDecl,
  SymbolId,
  SymbolKind,
} from './model.js';
export type { LanguageAdapter, LoadOptions, Peers } from './adapter.js';
export {
  combineAdapters,
  createAdapter,
  defaultAdapter,
  type CombinedRevision,
} from './adapters.js';
export { stylesheetAdapter, type CssRevision } from './lang/css/index.js';
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
  type PluginStyleScope,
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
export { fileForCheckout, listTreeAt, readFileAtRevision } from './git/show.js';
// git's runner, for the packages that read a repository their own way (`@symbiote/monitor`, RM1).
export { git, gitInput, GitError } from './git/exec.js';
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
  fileGitState,
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
  type FileGitState,
  type FinishResult,
  type LocalReview,
  type MergeCheck,
  type Verdict,
  type VerdictComment,
  type VerdictEvent,
} from './git/branches.js';
export {
  PROMPT_KEYS,
  type PromptChange,
  type PromptKey,
  type PromptPlaceholder,
  type PromptSetting,
  type PromptSettings,
} from './prompts.js';
export { type Skill, type SkillChange, type SkillFolder, type SkillsState } from './skills.js';
export {
  type ScoutAgent,
  type ScoutAsk,
  type ScoutConversation,
  type ScoutEffortChange,
  type ScoutEfforts,
  type ScoutModelChange,
  type ScoutOpen,
  type ScoutState,
  type ScoutStateName,
  type ScoutTerminalRequest,
} from './scout.js';
export type { McpAnswer, McpAsk, McpAsks, McpCaller, McpVia } from './mcp.js';
export {
  AGENT_KINDS,
  EFFORT_LEVEL,
  MODEL_ID,
  PERMISSION_MODES,
  WORK_KINDS,
  type AgentKind,
  type AgentEfforts,
  type AgentModel,
  type AgentModels,
  type AgentOption,
  type DefaultModel,
  type BriefPart,
  type BriefParts,
  type CheckGuess,
  type ActivityEntry,
  type AgentStateName,
  type ToolActivity,
  type WorkspaceActivity,
  type WorkspaceAgentState,
  type WorkspaceChanges,
  type WorkspaceCommit,
  type WorkspaceDocument,
  type WorkspaceFileChange,
  type WorkspaceList,
  type WorkspaceOptions,
  type StartBranch,
  type WorkspaceReplied,
  type WorkspaceReply,
  type WorkspaceRequest,
  type WorkspaceStart,
  type WorkspaceSummary,
  type WorkspaceShell,
  type WorkspaceShells,
  type WorkspaceTerminalOpened,
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
  abortMerge,
  commitResolution,
  conflictKinds,
  type ConflictKind,
} from './git/merging.js';
export type { UsageReport, UsageSubscription, UsageWindow } from './usage.js';
export {
  MERGE_STATES,
  type MergeAgentEvent,
  type MergeCheckRun,
  type MergeConflict,
  type MergeEntry,
  type MergeList,
  type MergeLogLine,
  type MergeLogRead,
  type MergeRegion,
  type MergeRequest,
  type MergeResolution,
  type MergeState,
  type MergeStep,
  type MergeTargets,
} from './merges.js';
export {
  addWorktree,
  branchNameProblem,
  commitFolders,
  deleteMergedBranch,
  listWorktrees,
  mainWorktree,
  parseWorktreeStatus,
  removeWorktree,
  uncommittedFiles,
  worktreeStatus,
  WorktreeRefused,
  type Worktree,
  type WorktreeFile,
  type WorktreeFileStatus,
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
