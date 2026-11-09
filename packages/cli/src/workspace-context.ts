// What `workspaces()` is given, shares and returns (decision 962): its options, where things are
// kept, the lookups every module uses, the state two modules share; the service's interface. A
// module takes a `Pick<>` of `WorkspacesContext` (decision 963).
import type {
  AgentKind,
  BranchMerge,
  CheckGuess,
  WorkspaceAgainst,
  WorkspaceChanges,
  WorkspaceDocument,
  WorkspaceHistory,
  WorkspaceList,
  WorkspaceOptions,
  WorkspaceReplied,
  WorkspaceReply,
  WorkspaceRequest,
  SuggestRequest,
  WorkspaceSuggestion,
  WorkspaceShell,
  WorkspaceShells,
  WorkspaceStart,
  WorkspaceSummary,
  WorkspaceTerminalOpened,
  WorkspaceTerminalRequest,
  WorkspaceThread,
  WorkspaceTools,
  GitRepo,
  PermissionMode,
  EffortChange,
  AgentLevels,
  ModelChange,
  WorkKind,
} from '@symbiote/core';
import type { AdvisingAgent, AdvisorPick } from './workspace-advice.js';
import type { Run, RunWithInput } from './programs.js';
import type { Codex } from './codex.js';
import type { OpenFolder } from './editor.js';
import type { ClaudeCode } from './claude-code.js';
import type { HivePacing } from './hive-pacing.js';
import { workspaceCodex } from './workspace-codex.js';
import type { Terminals } from './terminal.js';
import type { ReviewPlace } from './reviews.js';
import type { ActivityExport, ExportFormat } from './activity-export.js';

/** What `symbiote/config.json` says of workspaces and their agent; anything unknown is ignored. */
export interface WorkspaceConfig {
  branchPrefixes: Record<WorkKind, string>;
  worktrees?: string;
  /** The agent offered first (`agent.kind`, V20a). */
  agent?: AgentKind;
  /** Claude Code's permission mode and model. */
  permissionMode: PermissionMode;
  model?: string;
  /** Nucleus's and Scribe's levels (`nucleus.effort`, `scribe.effort`): words; absent, the agent's. */
  nucleusEffort?: string;
  scribeEffort?: string;
  /** Nucleus's and Scribe's models (`nucleus.model`, `scribe.model`, V47): IDs; absent, the default. */
  nucleusModel?: string;
  scribeModel?: string;
  /** `nucleus.web: false` (NU1, decision 594): Nucleus's next conversations without the web. */
  nucleusWeb?: false;
  /**
   * The advisor's model and level on each agent (`advisor.claude`, `advisor.codex`: `model`,
   * `effort`; V75c); absent, its small model at `low`.
   */
  advisor?: Partial<Record<AdvisingAgent, AdvisorPick>>;
}

/** What the server needs of workspaces. */
export interface Workspaces {
  options(): Promise<WorkspaceOptions>;
  list(): Promise<WorkspaceList>;
  /**
   * The finished workspaces (V77), newest first, each with what became of its branch: from
   * records, reviews and git, never an agent (decision 564).
   */
  history(): Promise<WorkspaceHistory>;
  /**
   * A finished workspace as a workspace's tabs read it (V77): its agent not running, `tip` the
   * commit it ended at (decision 565); 404 unless its record is finished.
   */
  finished(branch: string): Promise<WorkspaceSummary>;
  /** Makes the branch, its worktree and record, then starts the agent. Rejects with
   * `FeatureRefused`. */
  start(request: WorkspaceRequest): Promise<WorkspaceStart>;
  /**
   * What the advisor suggests for a start of `request`'s brief (V75): the model, the level and
   * plan first, from the picked agent's small model. Nothing is started.
   */
  suggest(request: SuggestRequest): Promise<WorkspaceSuggestion>;
  /**
   * The advisor's models and levels on `agent` for Settings (V75c), and the project's picks; no
   * agent when it is not installed. Refused (400) for an agent the advisor does not run on.
   */
  advisor(agent: AgentKind): Promise<AgentLevels>;
  /** Sets the advisor's model on `agent` (`advisor.<agent>.model`), or removes it (null). */
  setAdvisorModel(agent: AgentKind, change: ModelChange): Promise<AgentLevels>;
  /** Sets the advisor's level on `agent` (`advisor.<agent>.effort`), or removes it (null). */
  setAdvisorEffort(agent: AgentKind, change: EffortChange): Promise<AgentLevels>;
  /** Starts a workspace's agent again (after a failed start, or once it ended). */
  startAgent(branch: string): Promise<WorkspaceStart>;
  /** The prompt its agent was given, to copy. */
  prompt(branch: string): Promise<string>;
  /**
   * The check command guessed from the root files of the commit a workspace would start from
   * (V24b), for the start page's Done when; null when none is found.
   */
  check(at: string): Promise<CheckGuess | null>;
  /**
   * The start page's draft (V24c, decision 128): kept in Symbiote's cache for the repository, so a
   * new `symbiote view` (another port, other browser storage) has it; `{}` when none.
   */
  draft(): Promise<Record<string, unknown>>;
  saveDraft(value: Record<string, unknown>): Promise<void>;
  /**
   * Keeps a file for a workspace about to start (V40), in Symbiote's cache until a start moves it
   * beside the record: its ID, the name it will have, its size. Rejects one over 20 MB (413).
   */
  saveDocument(name: string, bytes: Uint8Array): Promise<WorkspaceDocument>;
  /** Stops its agent while it works or waits. */
  stopAgent(branch: string): Promise<WorkspaceStart>;
  /** Opens its worktree's folder in the editor (V12's VS Code). */
  openWorktree(branch: string): Promise<void>;
  /**
   * Opens a file its changes list as a diff in the editor (V43), exactly what the row counts: one
   * of the branch's from the fork point to the tip, one not committed (`uncommitted`) from its
   * worktree's HEAD to the worktree; a new file alone, as it is. `previousPath`: where a renamed
   * file was.
   */
  openDiff(
    branch: string,
    file: { path: string; previousPath?: string; uncommitted?: true },
  ): Promise<void>;
  /**
   * Its branch's commits and files since the fork point (what Review will show), and its
   * worktree's files not committed (V29d).
   */
  changes(branch: string): Promise<WorkspaceChanges>;
  /**
   * Whether its branch merges cleanly into the branch it is reviewed against (V17's check, V65),
   * once per pair.
   */
  merge(branch: string): Promise<BranchMerge>;
  /** The branch its review is against, where it started, and the branches to pick (V65). */
  against(branch: string): Promise<WorkspaceAgainst>;
  /**
   * Reviews it against `against` (V65): its Review, changes, count and merge check start at the
   * fork point with that branch; null, where it started again. A name no branch has, or its own,
   * is refused (400).
   */
  setAgainst(branch: string, against: string | null): Promise<WorkspaceAgainst>;
  /** Its thread (V18c): what its agent was given and reported, and its review's last verdict. */
  thread(branch: string): Promise<WorkspaceThread>;
  /** Its agent's tools for its Activity tab (V48f, V73): the newest megabyte of them. */
  tools(branch: string): Promise<WorkspaceTools>;
  /**
   * Its activity taken out (V84): its record, its whole thread and tools, its commits and its
   * review's verdict, as Markdown or JSON Lines, redacted; what could not be read said in it.
   * `maxBytes`: the Markdown within that size, its oldest messages left out first (the MCP's).
   */
  exportActivity(
    branch: string,
    format: ExportFormat,
    options?: { maxBytes?: number },
  ): Promise<ActivityExport>;
  /** Sends a message to its agent: continues its session with the text (V18c). */
  reply(request: WorkspaceReply): Promise<WorkspaceReplied>;
  /**
   * Notes in a workspace's thread a message the page is about to type into its agent's terminal
   * (AR2, decision 741): the verdict, so its prompt reads as the verdict.
   */
  noteSent(request: { branch: string; by: 'verdict'; text: string }): Promise<void>;
  /**
   * One workspace as the list shows it (HV2: what Hive's runner reads of a turn); null when it has
   * no record, or was cleaned up.
   */
  summaryOf(branch: string): Promise<WorkspaceSummary | null>;
  /**
   * Opens its agent's newest session in a terminal (V21): `claude attach <id>` in its worktree,
   * where a stopped session continues, with no turn; for Codex on its app server, `codex resume
   * <thread> --remote <address> -C <worktree>` (V27b). The terminal's ID.
   */
  terminal(request: WorkspaceTerminalRequest): Promise<WorkspaceTerminalOpened>;
  /**
   * Opens a shell in its worktree (V45): the person's shell in a kept terminal, `Shell <n>` by the
   * lowest number free; at most `MAX_SHELLS`. Its ID and number.
   */
  shell(request: WorkspaceTerminalRequest): Promise<Omit<WorkspaceShell, 'running'>>;
  /** Its shells still open (V45), by number, each with what runs in it. */
  shells(branch: string): Promise<WorkspaceShells>;
  /**
   * Cleans it up (V18c): its agent's sessions, its worktree and, once merged, its branch; the
   * record stays, `finished`. Unmerged only when asked (`unmerged`); never with work not
   * committed.
   */
  clean(request: { branch: string; unmerged?: boolean }): Promise<{ finished: string }>;
}

/** How `workspaces()` runs: its agents, clock, terminals, Hive's switch and gate. */
export interface WorkspacesOptions {
  /** Finds Claude Code (once a start or a list needs it); null when it is not installed. */
  claude: () => Promise<ClaudeCode | null>;
  /** Finds Codex (V20a), the same way; none by default. */
  codex?: () => Promise<Codex | null>;
  now?: () => Date;
  env?: Readonly<Record<string, string | undefined>>;
  /** Where `symbiote/config.json` is read. */
  root?: string;
  openFolder?: OpenFolder;
  /**
   * Symbiote's hook and the Node that runs it. Without `hook`, this build's `agent-hook.js`,
   * copied into Symbiote's cache by its content (decision 721).
   */
  hook?: string;
  node?: string;
  /** Terminals on agents' sessions (V21); without them, none. */
  terminals?: Terminals;
  /** How the advisor's agent is run (V75): the programs' own, unless a test gives others. */
  advisor?: { run?: Run; runInput?: RunWithInput };
  /**
   * Whether Hive mode is on (HV2): a start then is Hive's (`hive: true`, the `{hive}` line, its
   * record). Without it, as before Hive.
   */
  hive?: () => Promise<boolean>;
  /** How long a reply waits for a stopped session's process to end before it resumes it. */
  stopWaitMs?: number;
  /**
   * Hive's gate (HV5, decision 796): a Hive writer's start waits while it says so, and Hive's
   * runner starts it later. Without it, every start goes at once.
   */
  hivePacing?: Pick<HivePacing, 'usage'>;
}

/** What `workspaces()`'s modules share: its options, where things are kept, its lookups. */
export interface WorkspacesContext extends WorkspacesOptions {
  repo: GitRepo;
  cacheDir: string;
  codex: () => Promise<Codex | null>;
  now: () => Date;
  env: Readonly<Record<string, string | undefined>>;
  root: string;
  node: string;
  stopWaitMs: number;
  /** Whether Hive mode is on; a record that cannot be read is off. */
  hiveOn: () => Promise<boolean>;
  /** Where reviews and workspaces are kept. */
  place: () => Promise<ReviewPlace>;
  /** `symbiote/config.json`'s `workspaces`. */
  config: () => WorkspaceConfig;
  /** The checkout that holds `symbiote/`, which `workspaces.worktrees` is relative to. */
  mainRoot: (where: ReviewPlace) => string;
  viaCodex: ReturnType<typeof workspaceCodex>;
  /** Files uploaded for a workspace about to start (V40), each by its ID. */
  uploads: string;
  /** This view's terminals on each Claude Code session (`claude attach`), by the session's ID. */
  attached: Map<string, Set<string>>;
  /** Each workspace's shells (V45), by branch: they live as long as `symbiote view`. */
  shellsByBranch: Map<string, { id: string; number: number }[]>;
}
