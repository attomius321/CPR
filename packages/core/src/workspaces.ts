// Workspaces started from the commits page (V18): what `cpr view`'s server answers and the viewer
// reads. Types only; the CLI keeps the records and starts the agents.
import type { VerdictEvent } from './git/branches.js';

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
  /** Claude Code's short session ID, for `claude attach`; Codex's thread ID, for `codex resume`. */
  id?: string;
  /** Why the agent did not start, or why its state is unknown. */
  error?: string;
}

/** The agents CPR starts: Claude Code (V18) and Codex (V20a). */
export type AgentKind = 'claude' | 'codex';
export const AGENT_KINDS: readonly AgentKind[] = ['claude', 'codex'];

/** Claude Code's permission modes CPR may start an agent in; `default` passes none. */
export type PermissionMode = 'default' | 'acceptEdits' | 'auto';
export const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto'];

/**
 * What a workspace is for (V24): it picks the brief's parts, the branch's prefix and the one line
 * CPR adds to the agent's prompt.
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

/** A kind of work as the start dialog offers it (V24). */
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
  created: string;
  planFirst: boolean;
  brief: string;
  /** Its worktree; `changed`: its files not committed yet (when it exists). */
  worktree: { path: string; exists: boolean; changed?: number };
  /** The branch's tip; null once the branch is gone. */
  tip: string | null;
  /** The branch's commits since its base. */
  ahead: number;
  /** Its commits are all in the default branch. */
  merged: boolean;
  agent: WorkspaceAgentState;
  /**
   * When its agent last acted (V23): its thread's newest report or question, else when it last
   * started; absent when no agent was found.
   */
  lastAction?: string;
}

export interface WorkspaceList {
  workspaces: WorkspaceSummary[];
  /** Where workspaces are kept: `cpr/features/`, else CPR's cache (`note` says why). */
  place: 'repository' | 'cache';
  note?: string;
  /** Whether an agent's session can be shown in a terminal (V21); only with workspaces. */
  terminal?: TerminalAvailability;
}

/** Whether `cpr view` can run terminals (node-pty, optional), else why not (V21). */
export type TerminalAvailability = { available: true } | { available: false; reason: string };

/** `POST /api/workspaces/terminal`: a terminal on the workspace's agent's session, at that size. */
export interface WorkspaceTerminalRequest {
  branch: string;
  cols: number;
  rows: number;
}

/** What the start dialog needs. */
export interface WorkspaceOptions {
  /** The default branch's tip, where a workspace starts unless a row is picked. */
  base: { from: string; sha: string } | null;
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
}

/** An agent the start dialog offers (V20a). */
export interface AgentOption {
  kind: AgentKind;
  /** The program run, as found. */
  command: string;
  /**
   * Whose account it runs on (`claude auth status`, `codex login status`), e.g. "your Pro
   * subscription", "your ChatGPT account".
   */
  account?: string;
  /** Claude Code: an API key in `cpr view`'s environment, which it may use instead. */
  apiKey?: boolean;
  /** Claude Code: the permission mode it starts in unless the person picks another. */
  permissionMode?: PermissionMode;
}

/**
 * `POST /api/workspaces`: a kind of work with its title and parts, which CPR makes the brief of
 * (V24); or, as before V24, the brief as one text.
 */
export interface WorkspaceRequest {
  kind?: WorkKind;
  title?: string;
  parts?: BriefParts;
  brief?: string;
  branch: string;
  /** A full SHA; the default branch's tip when absent. */
  base?: string;
  planFirst: boolean;
  /** The agent to start (V20a); the default one when absent. */
  agent?: AgentKind;
  /** Claude Code's permission mode. */
  permissionMode?: PermissionMode;
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
 * One entry of a workspace's thread (V18c), as CPR's hooks recorded it from its agent's sessions:
 * a session's start and end, what it was given (CPR's prompt, then the person's messages), what
 * it reported at the end of a turn, what it waited on, and Claude Code's notices.
 */
export type ThreadEntry = {
  at: string;
  session: string;
  /** The CPR run of Codex it belongs to (V20a): which entries are its last run's. */
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
  /** The agent was started with CPR's hooks: its messages are recorded (workspaces since V18c). */
  recorded: boolean;
  /** The branch review's last verdict and its text for the agent (V16's "Copy for the agent"). */
  verdict?: { at: string; event: VerdictEvent; head: string; text: string };
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
