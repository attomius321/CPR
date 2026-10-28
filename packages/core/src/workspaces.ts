// Workspaces started from the commits page (V18): what `symbiote view`'s server answers and the
// viewer reads. Types only; the CLI keeps the records and starts the agents.
import type { VerdictEvent } from './git/branches.js';
import type { FileChangeStatus } from './git/changed-files.js';
import type { McpVia } from './mcp.js';

/** How a workspace's agent is doing, as the commits page shows it. */
export type AgentStateName =
  /** Working on it. */
  | 'working'
  /** Waiting for the person: a permission prompt, an answer (`waitingFor`). */
  | 'needs-you'
  /** Finished with "plan first" and no commits yet: the plan waits for the person's OK. */
  | 'plan-ready'
  /** Finished with commits on the branch: ready for review. */
  | 'ready'
  /** Finished without commits. */
  | 'done'
  | 'failed'
  | 'stopped'
  /** Started once; no session is listed now (removed, or ended long ago). */
  | 'not-running'
  /** The start failed (`error` says why); the agent can be started again. */
  | 'not-started'
  /** No agent found to start: the workspace's prompt is copied instead. */
  | 'no-agent'
  /** The agents could not be listed (`error`). */
  | 'unknown';

export interface WorkspaceAgentState {
  state: AgentStateName;
  kind?: AgentKind;
  /** What a session that needs the person waits for, in Claude Code's words. */
  waitingFor?: string;
  /** Its turn was interrupted (Esc): it waits at its prompt, and no hook said so. */
  interrupted?: true;
  /**
   * Claude Code's short session ID, for `claude attach`; Codex's thread ID, for `codex resume`;
   * Hermes's session ID, for `hermes --resume` (V58).
   */
  id?: string;
  /**
   * Codex on its app server (V27a): the server's address (`unix://…`), for `codex resume
   * --remote`. Turns typed there are in the thread, and a message while it works joins its turn.
   */
  remote?: string;
  /** Why the agent did not start, or why its state is unknown. */
  error?: string;
  /**
   * The effort level it was started at (V30b); absent for its own default. Its session may have
   * changed it since (Claude Code's `/effort`): Symbiote does not read it back.
   */
  effort?: string;
  /** The model it was started on (V47); absent for its default. Its session may change it since. */
  model?: string;
}

/** The agents Symbiote starts: Claude Code (V18), Codex (V20a) and Hermes (V58). */
export type AgentKind = 'claude' | 'codex' | 'hermes';
export const AGENT_KINDS: readonly AgentKind[] = ['claude', 'codex', 'hermes'];

/** Claude Code's permission modes Symbiote may start an agent in; `default` passes none. */
export type PermissionMode = 'default' | 'acceptEdits' | 'auto';
export const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto'];

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
  /** Started through Symbiote's tools (MC1): by Scout, or through `symbiote mcp`. */
  via?: McpVia;
  /** What its agent did last and since when (V48); absent when nothing was recorded. */
  activity?: WorkspaceActivity;
}

/** A tool an agent runs (V48f), and what it works on. */
export interface ToolActivity {
  /**
   * The tool: Claude Code's name (`Bash`, `Edit`, `mcp__…`), or Codex's kind of item (`command`,
   * `fileChange`, `mcp`, `webSearch`).
   */
  tool: string;
  /**
   * What it works on, at most 160 characters: a command's first line, a path inside the worktree,
   * a search's pattern, a URL, a subagent's description; absent for anything else.
   */
  subject?: string;
}

/**
 * One line of `symbiote/activity/<branch>.jsonl` (V48f): a tool call's start or end, as Claude
 * Code's hooks or Symbiote's Codex runner saw it, or as Codex's app server lists its items.
 */
export interface ActivityEntry extends ToolActivity {
  /** When it was seen; for Codex's app server, whose items carry no time, its turn's start. */
  at: string;
  session: string;
  /** The Symbiote run of Codex it belongs to (V20a). */
  run?: string;
  /** The call's ID: Claude Code's `tool_use_id`, Codex's item ID. A start and its end share it. */
  id: string;
  phase: 'start' | 'end';
  /** It ended in failure: Claude Code's `PostToolUseFailure`, a command's non-zero exit. */
  failed?: true;
  /** Codex's app server: no time of its own, only its place in its turn. */
  untimed?: true;
  /** A command's start (V73): its whole text, cut at 8 KB. */
  input?: string;
  /** A command's start (V73): the agent's own words for it (Bash's `description`), one line. */
  about?: string;
  /**
   * A task call (V73): `TaskCreate`'s subject on its start, the ID it was given on its end;
   * `TaskUpdate`'s ID and status on its start.
   */
  task?: { id?: string; subject?: string; status?: string };
  /** An end (V73): how long it ran, in milliseconds, as the agent measured it. */
  ms?: number;
  /** An end (V73): a command's exit code, when the agent gave it. */
  exit?: number;
  /** An end (V73): a command's output (stdout, then stderr) or a failure's error, its last 2 KB. */
  output?: string;
  /** `output` is the end of a longer one: from its first whole line in the last 2 KB. */
  clipped?: true;
  /** An end (V73): stopped by the person. */
  interrupted?: true;
  /** An end (V73): a command sent to the background; its end is not the command's. */
  background?: true;
  /** An edit's end (V73): the lines it added and removed. */
  added?: number;
  removed?: number;
}

/**
 * What a workspace's agent did last, and since when (V48), from its thread, its recorded tools
 * (V48f) or Codex's app server: only what was recorded, never a guess.
 */
export interface WorkspaceActivity {
  /**
   * When its current state began: its turn's prompt while it works, its ask while it waits, its
   * last report once it finished, its end once it stopped. Absent when not recorded.
   */
  since?: string;
  /** While it waits: what this turn asked (a question, or a permission and its tool's input). */
  asks?: Extract<ThreadEntry, { kind: 'asks' }>;
  /** Its newest report: when, and its first line, at most 200 characters. */
  report?: { at: string; text: string };
  /**
   * While it works and its tools are recorded (V48f): the newest tool started this turn and not
   * ended, or none running (`thinking`).
   */
  doing?: ToolActivity | { thinking: true };
}

export interface WorkspaceList {
  workspaces: WorkspaceSummary[];
  /** Where workspaces are kept: `symbiote/workspaces/`, else Symbiote's cache (`note` says why). */
  place: 'repository' | 'cache';
  note?: string;
  /** Whether an agent's session can be shown in a terminal (V21); only with workspaces. */
  terminal?: TerminalAvailability;
}

/** A commit on a workspace's branch, as its changes panel lists it (V29d). */
export interface WorkspaceCommit {
  sha: string;
  subject: string;
  author: string;
  /** Author date, ISO 8601 with the author's offset. */
  date: string;
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
  /**
   * Hermes (V58): the terminal Hermes itself runs in, kept by the server: leaving its tab must not
   * close it, which would end Hermes.
   */
  kept?: true;
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

/** An agent the start page offers (V20a). */
export interface AgentOption {
  kind: AgentKind;
  /** The program run, as found. */
  command: string;
  /**
   * Whose account it runs on (`claude auth status`, `codex login status`), e.g. "your Pro
   * subscription", "your ChatGPT account".
   */
  account?: string;
  /** Claude Code: an API key in `symbiote view`'s environment, which it may use instead. */
  apiKey?: boolean;
  /** Claude Code: the permission mode it starts in unless the person picks another. */
  permissionMode?: PermissionMode;
  /** The effort levels it takes (V30b) on its default model; absent when Symbiote cannot read
   * them: no choice is offered. */
  efforts?: AgentEfforts;
  /** The models it lists (V47), in its order; absent when Symbiote cannot read them: no choice. */
  models?: AgentModel[];
  /** The model it runs on when none is picked, when Symbiote knows it (V47). */
  defaultModel?: DefaultModel;
}

/**
 * A model as Symbiote passes it to an agent (V47): the agent's own ID (`opus`,
 * `claude-opus-4-6`, `gpt-6-luna`), never an option or a sentence.
 */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,99}$/;

/** A model an agent lists (V47): Claude Code's `initialize` answer, Codex's `model/list`. */
export interface AgentModel {
  /** What the agent takes: Claude Code's `--model`, Codex's `model`. */
  id: string;
  /** Its name in the agent's words: "Sonnet 5.5", "GPT-6-Luna". */
  name: string;
  description?: string;
  /** The levels it takes; absent: none (Claude Code's Haiku 4.5). */
  efforts?: AgentEfforts;
}

/** An agent's models (V47), and the one it runs on without a pick when it says (Codex). */
export interface AgentModels {
  models: AgentModel[];
  default?: string;
}

/**
 * The model an agent runs on when none is picked (V47), and whose choice it is: the agent's
 * configuration (Codex's), the project's (`agent.model`), or Symbiote's (the merger's `sonnet`).
 */
export interface DefaultModel {
  id: string;
  by: 'agent' | 'project' | 'symbiote';
}

/**
 * An effort level as Symbiote passes it to an agent (V30b): a lowercase word (`xhigh`), never an
 * option or a sentence. Both agents' levels are such words.
 */
export const EFFORT_LEVEL = /^[a-z][a-z-]{0,23}$/;

/** An agent's effort levels as it lists them (V30b): Claude Code's `--help`, Codex's models. */
export interface AgentEfforts {
  levels: string[];
  /** Its own level when none is given, when the agent says (Codex's configuration). */
  default?: string;
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
  /** Started through Symbiote's tools (MC1, decision 362): by Scout, or through `symbiote mcp`. */
  via?: McpVia;
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

/** A question an agent asked (`AskUserQuestion`), with its options' labels. */
export interface ThreadQuestion {
  question: string;
  options: string[];
}

/**
 * One entry of a workspace's thread (V18c), as Symbiote's hooks recorded it from its agent's
 * sessions: a session's start and end, what it was given (Symbiote's prompt, then the person's
 * messages), what it reported at the end of a turn, what it waited on, and Claude Code's notices.
 */
export type ThreadEntry = {
  at: string;
  session: string;
  /** The Symbiote run of Codex it belongs to (V20a): which entries are its last run's. */
  run?: string;
} & (
  | { kind: 'start'; source: string }
  | { kind: 'end'; reason?: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'report'; text: string }
  /** A permission (`tool` and its input, cut at 4 KB) or a question (`questions`). */
  | { kind: 'asks'; tool: string; input?: string; questions?: ThreadQuestion[] }
  | { kind: 'notice'; type: string; message?: string }
);

/** `GET /api/workspaces/thread?branch=`. */
export interface WorkspaceThread {
  /** The last entries, oldest first. */
  entries: ThreadEntry[];
  /** The agent was started with Symbiote's hooks: its messages are recorded (workspaces since
   * V18c). */
  recorded: boolean;
  /** The branch review's last verdict and its text for the agent (V16's "Copy for the agent"). */
  verdict?: { at: string; event: VerdictEvent; head: string; text: string };
}

/** `GET /api/workspaces/activity?branch=` (V73): what the Activity tab reads beside the thread. */
export interface WorkspaceTools {
  /**
   * Its tools' starts and ends (V48f), the newest, oldest first; absent when they are not
   * recorded.
   */
  tools?: ActivityEntry[];
  /** Older lines were left out: only the newest megabyte is read. */
  cut?: true;
}

/** `POST /api/workspaces/reply`. */
export interface WorkspaceReply {
  branch: string;
  text: string;
  /** Stop the agent's turn to send (it works, or waits on a prompt). */
  stop?: boolean;
}

/** A message sent to a workspace's agent. */
export interface WorkspaceReplied {
  workspace: WorkspaceSummary;
  /** Claude Code started a copy of the session instead of continuing it: the copy's short ID. */
  copy?: string;
}
