// The Activity tab's events (V73, decision 513): what Symbiote recorded — the workspace made, its
// thread (V18c), its agent's calls (V48f, V73), its branch's commits, its review's verdict — in
// time order, each call's start and end paired. Nothing is changed, dropped or made up: the raw
// stream (`rawLines`) is every line as recorded.
import type {
  ActivityEntry,
  ThreadEntry,
  WorkspaceCommit,
  WorkspaceSummary,
  WorkspaceThread,
} from '@symbiote/core';

/** One call of a tool: its start and end lines paired by ID, and what they say together. */
export interface ToolCall {
  id: string;
  tool: string;
  session: string;
  start?: ActivityEntry;
  end?: ActivityEntry;
  subject?: string;
  /** A command's whole text (V73). */
  input?: string;
  /** The agent's words for it. */
  about?: string;
  /** Absent for Codex's untimed items. */
  startedAt?: string;
  endedAt?: string;
  /** How long it ran: as the agent measured it, else from its two lines' times. */
  ms?: number;
  failed: boolean;
  exit?: number;
  output?: string;
  clipped?: true;
  interrupted?: true;
  background?: true;
  added?: number;
  removed?: number;
  task?: { id?: string; subject?: string; status?: string };
}

type Asks = Extract<ThreadEntry, { kind: 'asks' }>;
type Verdict = NonNullable<WorkspaceThread['verdict']>;

/** An event, keyed so a key stays while the sources only grow; `at` absent when untimed. */
export type ActivityEvent = { key: string; at?: string } & (
  | { kind: 'made'; workspace: WorkspaceSummary }
  | { kind: 'start'; entry: Extract<ThreadEntry, { kind: 'start' }>; first: boolean }
  | { kind: 'prompt'; entry: Extract<ThreadEntry, { kind: 'prompt' }>; first: boolean }
  | { kind: 'asks'; entry: Asks }
  | { kind: 'report'; entry: Extract<ThreadEntry, { kind: 'report' }> }
  | { kind: 'end'; entry: Extract<ThreadEntry, { kind: 'end' }> }
  | { kind: 'notice'; entry: Extract<ThreadEntry, { kind: 'notice' }> }
  | { kind: 'call'; call: ToolCall }
  | { kind: 'commit'; commit: WorkspaceCommit }
  | { kind: 'verdict'; verdict: Verdict }
  /** A thread entry of a kind this viewer does not know (a newer Symbiote's). */
  | { kind: 'unknown'; entry: { at: string; kind: string } }
);

/** Items by their times, those at one time in the order they were added. */
const inOrder = <T>(items: readonly T[], times: readonly number[]): T[] =>
  items
    .map((item, index) => ({ item, index, time: times[index] ?? 0 }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(({ item }) => item);

const time = (at: string | undefined) => {
  const t = at === undefined ? NaN : Date.parse(at);
  return Number.isNaN(t) ? 0 : t;
};

/** The calls in the tools' lines, in the order their first line came: starts and ends paired. */
function callsOf(tools: readonly ActivityEntry[]): ToolCall[] {
  const calls = new Map<string, { start?: ActivityEntry; end?: ActivityEntry }>();
  for (const line of tools) {
    const call = calls.get(line.id) ?? {};
    // A line written twice counts once: the first.
    if (line.phase === 'start' && !call.start) call.start = line;
    if (line.phase === 'end' && !call.end) call.end = line;
    calls.set(line.id, call);
  }
  return [...calls.entries()].map(([id, { start, end }]) => {
    const first = (start ?? end) as ActivityEntry;
    const timed = !first.untimed;
    const startedAt = timed && start ? start.at : undefined;
    const endedAt = timed && end ? end.at : undefined;
    const ms =
      end?.ms ??
      (startedAt && endedAt ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) : undefined);
    const subject = start?.subject ?? end?.subject;
    const input = start?.input ?? end?.input;
    const about = start?.about ?? end?.about;
    const task =
      start?.task || end?.task ? { ...(start?.task ?? {}), ...(end?.task ?? {}) } : undefined;
    return {
      id,
      tool: first.tool,
      session: first.session,
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(subject ? { subject } : {}),
      ...(input ? { input } : {}),
      ...(about ? { about } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(endedAt ? { endedAt } : {}),
      ...(ms !== undefined ? { ms } : {}),
      failed: end?.failed === true,
      ...(end?.exit !== undefined ? { exit: end.exit } : {}),
      ...(end?.output !== undefined ? { output: end.output } : {}),
      ...(end?.clipped ? { clipped: true as const } : {}),
      ...(end?.interrupted ? { interrupted: true as const } : {}),
      ...(end?.background ? { background: true as const } : {}),
      ...(end?.added !== undefined ? { added: end.added } : {}),
      ...(end?.removed !== undefined ? { removed: end.removed } : {}),
      ...(task ? { task } : {}),
    };
  });
}

/**
 * The Activity tab's events (V73), oldest first; events at one time keep their sources' order
 * (the workspace, the thread, the verdict, the calls, the commits). Each call once, by its ID:
 * an end whose start is past the read window, or written before it, is a call too.
 */
export function activityEvents(
  workspace: WorkspaceSummary,
  thread: WorkspaceThread | null,
  tools: readonly ActivityEntry[] | undefined,
  commits: readonly WorkspaceCommit[] | null,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const seen = new Map<string, number>();
  const keyOf = (kind: string, at: string) => {
    const id = `${kind}:${at}`;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return `${id}:${n}`;
  };
  const sortTimes: number[] = [];
  const add = (event: ActivityEvent, sortAt: string | undefined) => {
    events.push(event);
    sortTimes.push(time(sortAt));
  };

  add({ key: 'made', at: workspace.created, kind: 'made', workspace }, workspace.created);
  let started = false;
  let prompted = false;
  for (const entry of thread?.entries ?? []) {
    const head = { key: keyOf(entry.kind, entry.at), at: entry.at };
    switch (entry.kind) {
      case 'start':
        add({ ...head, kind: 'start', entry, first: !started }, entry.at);
        started = true;
        break;
      case 'prompt':
        add({ ...head, kind: 'prompt', entry, first: !prompted }, entry.at);
        prompted = true;
        break;
      case 'asks':
        add({ ...head, kind: 'asks', entry }, entry.at);
        break;
      case 'report':
        add({ ...head, kind: 'report', entry }, entry.at);
        break;
      case 'end':
        add({ ...head, kind: 'end', entry }, entry.at);
        break;
      case 'notice':
        add({ ...head, kind: 'notice', entry }, entry.at);
        break;
      default: {
        const unknown = entry as { at: string; kind: string };
        add({ ...head, kind: 'unknown', entry: unknown }, unknown.at);
      }
    }
  }
  const verdict = thread?.verdict;
  if (verdict)
    add({ key: `verdict:${verdict.at}`, at: verdict.at, kind: 'verdict', verdict }, verdict.at);
  for (const call of callsOf(tools ?? [])) {
    const line = (call.start ?? call.end) as ActivityEntry;
    const at = call.startedAt ?? call.endedAt;
    add({ key: `call:${call.id}`, ...(at ? { at } : {}), kind: 'call', call }, line.at);
  }
  for (const commit of commits ?? []) {
    add({ key: `commit:${commit.sha}`, at: commit.date, kind: 'commit', commit }, commit.date);
  }
  return inOrder(events, sortTimes);
}

/** One line of the raw stream: where it was recorded, what it is, and its value as recorded. */
export interface RawLine {
  key: string;
  at?: string;
  source: 'workspace' | 'thread' | 'tool' | 'commit' | 'review';
  /** Its kind in a word: "prompt", "Bash start", a commit's short SHA. */
  what: string;
  value: unknown;
}

/**
 * The raw stream (V73): every line Symbiote recorded for the tab, as recorded — the thread's
 * entries, each tool line (a line written twice, twice), the commits, the verdict — in time order.
 */
export function rawLines(
  workspace: WorkspaceSummary,
  thread: WorkspaceThread | null,
  tools: readonly ActivityEntry[] | undefined,
  commits: readonly WorkspaceCommit[] | null,
): RawLine[] {
  const lines: RawLine[] = [];
  const sortTimes: number[] = [];
  const add = (line: RawLine, sortAt: string | undefined) => {
    lines.push(line);
    sortTimes.push(time(sortAt));
  };
  add(
    {
      key: 'workspace',
      at: workspace.created,
      source: 'workspace',
      what: 'made',
      value: {
        branch: workspace.branch,
        base: workspace.base,
        from: workspace.from,
        created: workspace.created,
      },
    },
    workspace.created,
  );
  (thread?.entries ?? []).forEach((entry, i) =>
    add(
      { key: `thread:${i}`, at: entry.at, source: 'thread', what: entry.kind, value: entry },
      entry.at,
    ),
  );
  (tools ?? []).forEach((line, i) =>
    add(
      {
        key: `tool:${i}`,
        ...(line.untimed ? {} : { at: line.at }),
        source: 'tool',
        what: `${line.tool} ${line.phase}`,
        value: line,
      },
      line.at,
    ),
  );
  for (const commit of commits ?? []) {
    add(
      {
        key: `commit:${commit.sha}`,
        at: commit.date,
        source: 'commit',
        what: commit.sha.slice(0, 7),
        value: commit,
      },
      commit.date,
    );
  }
  const verdict = thread?.verdict;
  if (verdict) {
    add(
      { key: 'verdict', at: verdict.at, source: 'review', what: verdict.event, value: verdict },
      verdict.at,
    );
  }
  return inOrder(lines, sortTimes);
}
