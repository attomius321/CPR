// What the Activity tab's groups are made of (V73): a group's kinds, status and fields, the events
// in a phase, a run of calls and the context they are read in, and the small reads of a call.
import type { TurnTokens, WorkspaceAgentState } from '@symbiote/core';
import { callKind, testCommand, shownCommand, type WorkKind } from './classify.js';
import type { ActivityEvent, ToolCall } from './events.js';
import { testCounts, type TestCounts } from './test-summary.js';

export type GroupKind =
  | WorkKind
  | 'debug'
  | 'commit'
  | 'other'
  | 'made'
  | 'session'
  | 'prompt'
  | 'message'
  | 'asks'
  | 'report'
  | 'end'
  | 'verdict'
  /** Claude Code's word that a background task ended, given as a prompt. */
  | 'notice'
  | 'unknown'
  /** Nucleus's (NU2): a Confirm, a compaction, an error, a turn interrupted. */
  | 'confirm'
  | 'compact'
  | 'error'
  | 'interrupted';

/**
 * `running`: a call runs now; `recovered`: failed, then passed; `cancelled`: stopped by the person;
 * `waiting`: the agent waits on it; `open`: its last call's end was never recorded.
 */
export type GroupStatus =
  'running' | 'done' | 'failed' | 'recovered' | 'cancelled' | 'waiting' | 'open';

export interface ActivityGroup {
  /** Its first event's: kept while events arrive, so an opened group stays open. */
  key: string;
  kind: GroupKind;
  /** Drawn stronger than the phases of calls: the person's and the agent's words, commits. */
  milestone: boolean;
  title: string;
  /** One line of facts: files and lines, a test's counts, what was read. */
  summary?: string;
  /** What a milestone opens to: a prompt or message, a report (Markdown), a verdict's text. */
  detail?: string;
  /** Its first event's time and its last's end; absent when untimed. */
  start?: string;
  end?: string;
  status: GroupStatus;
  /** Its calls that failed (not stopped by the person). */
  failures: number;
  events: ActivityEvent[];
  /** The agent's task in progress (`TaskUpdate`), by its subject. */
  task?: string;
  /** A commit's SHA. */
  sha?: string;
  /** What its decisive test run printed. */
  tests?: TestCounts;
  /** Its status in its own words, over the status's (NU2: a Confirm's end). */
  said?: { text: string; tone: 'run' | 'error' | 'ok' | 'you' | 'warning' | 'muted' };
  /** An answer's turn (NU2): its tokens and time, as its agent reported them. */
  tokens?: TurnTokens;
  took?: number;
}

export type CallEvent = Extract<ActivityEvent, { kind: 'call' }>;

export type CommitEvent = Extract<ActivityEvent, { kind: 'commit' }>;

/** What a phase holds: its calls, and the commits they made. */
export type WorkEvent = CallEvent | CommitEvent;

export interface Run {
  kind: WorkKind | 'debug' | null;
  events: WorkEvent[];
  task?: string;
  /** Debugging's: the test whose failure it follows. */
  after?: string;
}

export interface Context {
  agent: WorkspaceAgentState;
  worktree: string;
  /** When the agent's current turn began: its last prompt. */
  turn: number;
  /** The newest question, when the agent asked it this turn. */
  lastAsks?: string;
  /** Nucleus's activity (NU2): its own words and milestones. */
  nucleus?: true;
  /** Nucleus's name, "Alpha Ceph" in Hive mode: its messages' titles (AR2). */
  nucleusName?: string;
}

export const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export const firstLine = (text: string) =>
  (text.split('\n').find((line) => line.trim() !== '') ?? '').trim();

const lineTime = (call: ToolCall) => Date.parse((call.start ?? call.end)?.at ?? '') || 0;

export const isCall = (event: ActivityEvent): event is CallEvent => event.kind === 'call';

export const callsIn = (events: readonly ActivityEvent[]) =>
  events.filter(isCall).map((e) => e.call);

/** Whether a call runs now: no end, in the agent's current turn, while it works. */
export const running = (call: ToolCall, context: Context) =>
  !call.end && context.agent.state === 'working' && lineTime(call) >= context.turn;

/** A call's kind (Nucleus's own when it has one, NU2), `reasoning` and questions none. */
export const kindOf = (call: ToolCall): WorkKind | null =>
  call.kind !== undefined ? call.kind : callKind(call);

/** Where a call's command is shown: its whole text when kept, else its subject. */
export const commandOf = (call: ToolCall) => call.input ?? call.subject ?? '';

/** The tools named after an edit are edits; commands that write in the worktree are too. */
export const isEdit = (call: ToolCall) => {
  const kind = kindOf(call);
  return kind === 'implement' || kind === 'docs';
};

export const isTest = (call: ToolCall) => kindOf(call) === 'test';

/**
 * A test call's outcome: passed, failed, stopped, running or never ended. Failed also when its
 * runner printed failures though it exited 0: piped to `tail`, a command's exit is the pipe's.
 */
export function outcome(call: ToolCall, context: Context): GroupStatus {
  if (running(call, context)) return 'running';
  if (call.interrupted) return 'cancelled';
  if (call.failed) return 'failed';
  if (!call.end) return 'open';
  const counts = call.output ? testCounts(call.output) : null;
  return counts && ((counts.failed ?? 0) > 0 || (counts.errors ?? 0) > 0) ? 'failed' : 'done';
}

/** Times of a group: its first event's and its last's end. */
export function times(events: readonly ActivityEvent[]): Pick<ActivityGroup, 'start' | 'end'> {
  let start: string | undefined;
  let end: string | undefined;
  for (const event of events) {
    const from = event.kind === 'call' ? (event.call.startedAt ?? event.call.endedAt) : event.at;
    const to = event.kind === 'call' ? (event.call.endedAt ?? event.call.startedAt) : event.at;
    if (from && (!start || Date.parse(from) < Date.parse(start))) start = from;
    if (to && (!end || Date.parse(to) > Date.parse(end))) end = to;
  }
  return { ...(start ? { start } : {}), ...(end ? { end } : {}) };
}

/** A test call's command as a summary says it: `pnpm check`. */
export const testName = (call: ToolCall, context: Context) =>
  firstLine(shownCommand(testCommand(commandOf(call)) ?? commandOf(call), context.worktree));
