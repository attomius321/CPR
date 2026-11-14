// Workspaces started from the commits page (V18): what `symbiote view`'s server answers and the
// viewer reads. Types only; the CLI keeps the records and starts the agents.
import type { WorkspaceAgentState, AgentKind, PermissionMode, AgentOption } from './agents.js';
import type { WorkspaceHive } from './hive.js';
import type { WorkspaceActivity, SentBy } from './workspace-activity.js';
import type { FileChangeStatus } from './git/changed-files.js';
import type { McpVia } from './mcp.js';

/**
 * What a workspace is for (V24): it picks the brief's parts, the branch's prefix and the one line
 * Symbiote adds to the agent's prompt.
 */
export type WorkKind = 'feature' | 'fix' | 'refactor' | 'chore' | 'spike';
export const WORK_KINDS: readonly WorkKind[] = ['feature', 'fix', 'refactor', 'chore', 'spike'];

/** The parts of a brief the person writes (V24); each kind has some of them. */
export interface BriefParts {
  /** Workspace: what it should do, and why. */
  goal?: string;
  /** Fix: what goes wrong, and what should happen instead. */
  happens?: string;
  /** Refactor: what, and why its current shape is a problem. */
  restructure?: string;
  /** Chore: what, and why now. */
  change?: string;
  /** Spike: what to find out, and what the answer will decide. */
  question?: string;
  known?: string;
  reproduce?: string;
  where?: string;
  outOfScope?: string;
  notes?: string;
  doneWhen?: string;
}
export type BriefPart = keyof BriefParts;

/** A kind of work as the start page offers it (V24). */
export interface WorkKindSpec {
  kind: WorkKind;
  /** Its name, as the brief's first line says it: "Fix". */
  name: string;
  /** Its parts in the brief's order: the one it needs first, Done when last. */
  parts: { part: BriefPart; heading: string; required?: true }[];
  /** Done when's text until the person changes it; `{checks pass}` stands for the check. */
  doneWhen?: string;
}

/** A repository's check command, guessed from a commit's root files, and from which (V24b). */
export interface CheckGuess {
  command: string;
  /** The file and what in it: "package.json (scripts.check)". */
  source: string;
}

/**
 * The forge issue a Hive workspace was started from (HV10, decision 1013): the classifier took it
 * on the snapshot `hash` names. Set only by the start from an issue (decision 1061).
 */
export interface WorkspaceIssue {
  forge: 'github' | 'gitlab';
  host: string;
  project: string;
  number: number;
  url: string;
  title: string;
  /** The snapshot's hash the take was on (decision 1001). */
  hash: string;
}

/** A workspace and its agent, for the commits page. */
export interface WorkspaceSummary {
  branch: string;
  /** What it is for, and its name (V24); absent for workspaces started before. */
  kind?: WorkKind;
  title?: string;
  /** The commit the branch started at, and the branch it was taken from (absent: a picked row). */
  base: string;
  from?: string;
  /** The branch picked to review it against (V65); absent: where it started. */
  against?: string;
  created: string;
  planFirst: boolean;
  brief: string;
  /** Its worktree; `changed`: its files not committed yet (when it exists). */
  worktree: { path: string; exists: boolean; changed?: number };
  /** The branch's tip; null once the branch is gone. */
  tip: string | null;
  /**
   * The branch's commits since it left the default branch (its fork point, as Review computes
   * it); since its base once merged.
   */
  ahead: number;
  /** Its commits are all in the default branch. */
  merged: boolean;
  agent: WorkspaceAgentState;
  /** The files the person gave with the brief (V40): the folder holding them, and their names. */
  documents?: { folder: string; files: string[] };
  /**
   * When its agent last acted (V23): its thread's newest report or question, else when it last
   * started; absent when no agent was found.
   */
  lastAction?: string;
  /** Started through Symbiote's tools (MC1): by Nucleus, or through `symbiote mcp`. */
  via?: McpVia;
  /** What its agent did last and since when (V48); absent when nothing was recorded. */
  activity?: WorkspaceActivity;
  /** When it was cleaned up (V77): History shows it, read only. */
  finished?: string;
  /** Started while Hive was on (HV2): where Hive is with it. */
  hive?: WorkspaceHive;
  /** The issue it was started from (HV10, decision 1013). */
  issue?: WorkspaceIssue;
}

/**
 * What became of a finished workspace's branch (V77, decision 565): `merged`, the commit it ended
 * at is in the default branch; `kept`, its branch is still there, not merged; `gone`, neither.
 */
export type WorkspaceOutcome = 'merged' | 'kept' | 'gone';

/** A finished workspace, as History lists it (V77): its record and what became of its branch. */
export interface FinishedWorkspace {
  branch: string;
  kind?: WorkKind;
  title?: string;
  brief: string;
  created: string;
  /** When it was cleaned up. */
  finished: string;
  /** Who started it (`user.email`). */
  by?: string;
  via?: McpVia;
  planFirst: boolean;
  /** Its agent as it was started; absent when none was found. */
  agent?: { kind: AgentKind; model?: string; effort?: string };
  outcome: WorkspaceOutcome;
  /** `merged`: the default branch it is in. */
  into?: string;
  /**
   * The commit it ended at (decision 565): the tip Clean up recorded, else its branch's, else
   * the last Approve's; absent when none is known or git no longer has it.
   */
  end?: string;
}

/** `GET /api/workspaces/history` (V77): the finished workspaces, the newest finished first. */
export interface WorkspaceHistory {
  workspaces: FinishedWorkspace[];
  place: 'repository' | 'cache';
  note?: string;
}

export interface WorkspaceList {
  workspaces: WorkspaceSummary[];
  /** Where workspaces are kept: `symbiote/workspaces/`, else Symbiote's cache (`note` says why). */
  place: 'repository' | 'cache';
  note?: string;
  /** Whether an agent's session can be shown in a terminal (V21); only with workspaces. */
  terminal?: TerminalAvailability;
}

/**
 * `GET /api/workspaces/findings` (V93, decision 892): the graphs `symbiote view` analyzed and keeps,
 * each pair's findings counted; a workspace's change is the one whose `head` is its tip.
 */
export interface WorkspaceFindings {
  graphs: { base: string; head: string; errors: number; warnings: number }[];
}

/** A commit on a workspace's branch, as its changes panel lists it (V29d). */
export interface WorkspaceCommit {
  sha: string;
  subject: string;
  author: string;
  /** Author date, ISO 8601 with the author's offset. */
  date: string;
  /** Its lines added and removed, binary files left out (V92: a Hive round's writer). */
  added?: number;
  removed?: number;
}

/** A file changed on a workspace's branch, or not committed in its worktree (V29d). */
export interface WorkspaceFileChange {
  status: FileChangeStatus | 'untracked' | 'conflicted';
  /** Repo-relative POSIX path: where it is now, or where it was for a deleted file. */
  path: string;
  /** Before a rename or copy. */
  previousPath?: string;
  /** Lines added and removed; absent for a binary file and a file git does not track yet. */
  added?: number;
  removed?: number;
  binary?: true;
}

/**
 * `GET /api/workspaces/changes?branch=` (V29d): what a workspace's branch holds — what Review will
 * show — and what its worktree has not committed.
 */
export interface WorkspaceChanges {
  branch: string;
  /**
   * Where its commits start, as Review computes it (V65): the fork point with the branch it is
   * reviewed against, or with the branch it started from once it took that in; else the commit
   * the workspace started at, and that commit once merged.
   */
  base: string;
  /** The branch `base` is the fork point with; absent when it is where the workspace started. */
  since?: string;
  /** The branch's tip; null once the branch is gone. */
  tip: string | null;
  /** Its commits since `base`, newest first: at most 100, and how many in all. */
  commits: { count: number; listed: WorkspaceCommit[] };
  /** The files they change, at most 300; how many, and their lines, in all. */
  files: { count: number; added: number; removed: number; listed: WorkspaceFileChange[] };
  /** The files its worktree has not committed, at most 300; null once the worktree is gone. */
  uncommitted: { count: number; listed: WorkspaceFileChange[] } | null;
}

/**
 * `GET /api/workspaces/against?branch=` and `POST { branch, against }` (V65): the branch its review
 * is against, where it started, and the branches it can be reviewed against.
 */
export interface WorkspaceAgainst {
  /** The branch picked; absent: where it started. */
  against?: string;
  /** Where it started: the branch, absent for a commit picked in History, and its commit. */
  from?: string;
  base: string;
  /** Every branch name, local and remotes' by name, but its own. */
  branches: string[];
}

/** Whether `symbiote view` can run terminals (node-pty, optional), else why not (V21). */
export type TerminalAvailability = { available: true } | { available: false; reason: string };

/** `POST /api/workspaces/terminal`: a terminal on the workspace's agent's session, at that size. */
export interface WorkspaceTerminalRequest {
  branch: string;
  cols: number;
  rows: number;
}

/** The terminal opened. */
export interface WorkspaceTerminalOpened {
  id: string;
  /**
   * Codex (V27b): its configuration has no trust entry for the worktree or a folder above it, so
   * Codex asks first whether to trust it, and saves the answer in the person's configuration.
   */
  trusted?: false;
}

/**
 * A shell in a workspace's worktree (V45): a terminal of its own beside its agent's, kept until it
 * is closed, exits, the workspace is cleaned up or `symbiote view` exits.
 */
export interface WorkspaceShell {
  /** Its terminal: `/api/terminals/<id>…`. */
  id: string;
  /** `Shell <number>`: the lowest number free in the workspace when it opened. */
  number: number;
  /** The program in its foreground when it is not the shell (`node`): closing it ends that. */
  running?: string;
}

/** `GET /api/workspaces/shells?branch=` (V45): a workspace's shells, by number. */
export interface WorkspaceShells {
  shells: WorkspaceShell[];
}

/** What the start page needs. */
export interface WorkspaceOptions {
  /** The default branch's tip, where a workspace starts unless a row is picked. */
  base: { from: string; sha: string } | null;
  /**
   * The branches a workspace can start from (V33): the default branch first, then the local ones,
   * then those only on a remote, each by name, at its newest tip.
   */
  branches: StartBranch[];
  /** Proposed names start with their kind's (`fix/`, V24). */
  branchPrefixes: Record<WorkKind, string>;
  /** The kinds of work and their parts (V24). */
  kinds: WorkKindSpec[];
  /** Where a worktree goes, `<branch>` standing for the branch's folder name. */
  worktrees: string;
  /** The agents installed, the default first (V20a); empty when there is none. */
  agents: AgentOption[];
  /** Longest brief accepted. */
  maxBrief: number;
  /**
   * Where the files given with the brief go (V40), `<branch>` standing for the branch's folders;
   * how many, how large each, and all together, in bytes.
   */
  documents: { folder: string; maxFiles: number; maxBytes: number; maxTotal: number };
}

/** A branch a workspace can start from (V33). */
export interface StartBranch {
  name: string;
  /** Its newest tip: the local branch's or a remote's, the one that holds the others. */
  sha: string;
  /** Only on a remote. */
  remote?: true;
}

/**
 * `POST /api/workspaces`: a kind of work with its title and parts, which Symbiote makes the brief
 * of (V24); or, as before V24, the brief as one text.
 */
export interface WorkspaceRequest {
  kind?: WorkKind;
  title?: string;
  parts?: BriefParts;
  brief?: string;
  branch: string;
  /** A full SHA; the default branch's tip when absent. */
  base?: string;
  /** A branch to start from at its newest tip (V33), one of the options' `branches`; not with
   * `base`. */
  from?: string;
  planFirst: boolean;
  /** The agent to start (V20a); the default one when absent. */
  agent?: AgentKind;
  /** Claude Code's permission mode. */
  permissionMode?: PermissionMode;
  /** The agent's effort level for its session (V30b), one of its `efforts`; its own when absent. */
  effort?: string;
  /** The model for its session (V47), one of its `models`; its default when absent. */
  model?: string;
  /** Files to give the agent with the brief (V40), each kept by `POST /api/workspaces/documents`. */
  documents?: { id: string; name: string }[];
  /** Started through Symbiote's tools (MC1, decision 362): by Nucleus, or through `symbiote mcp`. */
  via?: McpVia;
  /**
   * The issue it starts from (HV10): set by the start from an issue only; `POST /api/workspaces`
   * drops one sent (decision 1061).
   */
  issue?: WorkspaceIssue;
}

/**
 * `POST /api/workspaces/suggest` (V75): the brief as the Start page holds it, for the advisor to
 * size. Nothing is started.
 */
export interface SuggestRequest {
  kind: WorkKind;
  title: string;
  parts: BriefParts;
  /** The agent picked on the page; the default one when absent. */
  agent?: AgentKind;
  /** The attached documents' names: the advisor is told of them, not given them. */
  documents?: string[];
}

/** What the advisor suggests for a start (V75): a proposal the person accepts or dismisses. */
export interface WorkspaceSuggestion {
  /** The agent it is for: the one picked, never another (decision 545). */
  agent: AgentKind;
  /** A model the agent lists; absent: the agent's default. */
  model?: string;
  /** A level that model takes; absent: its default level. */
  effort?: string;
  planFirst: boolean;
  /** One sentence for the person: the signal in the brief that decided the size. */
  why: string;
  /** The model the advisor ran on, by its ID and name, and its level. */
  by: { model: string; name: string; effort?: string };
}

/** A file kept for a workspace about to start (V40): its ID, the name it will have, its size. */
export interface WorkspaceDocument {
  id: string;
  name: string;
  size: number;
}

/** A workspace just made or restarted, with the prompt its agent was given (to copy). */
export interface WorkspaceStart {
  workspace: WorkspaceSummary;
  prompt: string;
}

/** `POST /api/workspaces/reply`. */
export interface WorkspaceReply {
  branch: string;
  text: string;
  /** Stop the agent's turn to send (it works, or waits on a prompt). */
  stop?: boolean;
  /**
   * Which of Symbiote's senders this is (AR2): noted in the thread before it is sent, so the
   * prompt reads as theirs; absent for the person's own message.
   */
  by?: SentBy;
  /** Its prompt key, when Symbiote wrote it from one (`hive.check`, `merge.failed`). */
  key?: string;
}

/** A message sent to a workspace's agent. */
export interface WorkspaceReplied {
  workspace: WorkspaceSummary;
  /** Claude Code started a copy of the session instead of continuing it: the copy's short ID. */
  copy?: string;
}
