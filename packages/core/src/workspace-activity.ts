// A workspace's thread and tools (V18c, V73): what its agent was sent and said, the tools it
// ran, as its tabs read them. Types only.
import type { VerdictEvent } from './git/branches.js';

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
  /**
   * While it works or asks and its tools are recorded (V93, decision 893): how many tools it
   * started this turn; absent when none.
   */
  tools?: number;
}

/** A question an agent asked (`AskUserQuestion`), with its options' labels. */
export interface ThreadQuestion {
  question: string;
  options: string[];
}

/**
 * Who sent a prompt (AR2, decision 741), as the thread's reader labels it: Symbiote's start
 * prompt, the person, one of Symbiote's senders (from the note it wrote before sending), a
 * background job's end (`<task-notification>`), or a subagent's hand-back (`<agent-message`).
 */
export type PromptFrom =
  'start' | 'person' | 'hive' | 'nucleus' | 'merger' | 'verdict' | 'task' | 'subagent';

/** Which of Symbiote's senders typed a message into a workspace's agent (AR2, decision 741). */
export type SentBy = 'hive' | 'nucleus' | 'merger' | 'verdict';

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
  | { kind: 'start'; source: string; transcript?: string }
  | { kind: 'end'; reason?: string }
  /**
   * `transcript` here and on a start (V83): Claude Code's transcript of the session, as its hooks
   * name it (`transcript_path`), where the list reads what the agent runs on.
   */
  /**
   * `from` and `key` (AR2): who sent it and, for Symbiote's own, its prompt key, given by the
   * thread's reader, never written by the hook.
   */
  | { kind: 'prompt'; text: string; transcript?: string; from?: PromptFrom; key?: string }
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
