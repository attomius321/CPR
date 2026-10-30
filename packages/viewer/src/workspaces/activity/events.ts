// The Activity tab's events (V73, decision 513): what Symbiote recorded — the workspace made, its
// thread (V18c), its agent's calls (V48f, V73), its branch's commits, its review's verdict — in
// time order, each call's start and end paired. Nothing is changed, dropped or made up: the raw
// stream (`rawLines`) is every line as recorded. Nucleus's activity (NU2, `nucleusEvents`) is read
// into the same events: its messages, answers, calls with the gate's decisions, Symbiote's record
// of its tools paired with its agent's calls, the Confirms, its session's own events.
import type {
  ActivityEntry,
  GateRecord,
  NucleusActivityLine,
  NucleusCall,
  NucleusEntry,
  ThreadEntry,
  TurnTokens,
  WebPage,
  WorkspaceCommit,
  WorkspaceSummary,
  WorkspaceThread,
} from '@symbiote/core';
import type { WorkKind } from './classify.js';

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
  /** Nucleus (NU2): what its gate said of the call. */
  gate?: GateRecord;
  /** Nucleus: the pages it read; a search's results. */
  pages?: WebPage[];
  links?: WebPage[];
  /** Nucleus: why it was refused, by its gate (its end is its start) or by its agent. */
  refused?: string;
  /** Nucleus: Symbiote's own record of one of its tools' calls (`source: symbiote`). */
  source?: 'symbiote';
  /** Nucleus: its kind of work where the workspace's classification has none (web, Symbiote). */
  kind?: WorkKind | null;
  /** Nucleus: Symbiote's record of this call of its tools, paired with the agent's. */
  symbiote?: ToolCall;
  /** Nucleus: it asked the person, who declined or did not answer: its Confirm says so. */
  declined?: true;
}

type Asks = Extract<ThreadEntry, { kind: 'asks' }>;
type Verdict = NonNullable<WorkspaceThread['verdict']>;

/** An event, keyed so a key stays while the sources only grow; `at` absent when untimed. */
export type ActivityEvent = { key: string; at?: string } & (
  | { kind: 'made'; workspace: WorkspaceSummary }
  | { kind: 'start'; entry: Extract<ThreadEntry, { kind: 'start' }>; first: boolean }
  | { kind: 'prompt'; entry: Extract<ThreadEntry, { kind: 'prompt' }>; first: boolean }
  | { kind: 'asks'; entry: Asks }
  | {
      kind: 'report';
      entry: Extract<ThreadEntry, { kind: 'report' }>;
      /** Nucleus's turn (NU2): its tokens and time, as its agent reported them. */
      tokens?: TurnTokens;
      ms?: number;
    }
  | { kind: 'end'; entry: Extract<ThreadEntry, { kind: 'end' }> }
  | { kind: 'notice'; entry: Extract<ThreadEntry, { kind: 'notice' }> }
  | { kind: 'call'; call: ToolCall }
  | { kind: 'commit'; commit: WorkspaceCommit }
  | { kind: 'verdict'; verdict: Verdict }
  /** A thread entry of a kind this viewer does not know (a newer Symbiote's). */
  | { kind: 'unknown'; entry: { at: string; kind: string } }
  /** Nucleus (NU2): a Confirm, asked, and how it ended; `did`, Symbiote's call that asked. */
  | { kind: 'confirm'; asked?: Confirm; ended?: Confirm; did?: ToolCall }
  /** Nucleus: its context compacted, before and after. */
  | { kind: 'compact'; before?: Compact; after?: Compact }
  /** Nucleus: an error, a turn interrupted, a conversation opened or ended by New conversation. */
  | { kind: 'nucleus'; entry: NucleusOwn }
);

type Confirm = Extract<NucleusEntry, { kind: 'confirm' }>;
type Compact = Extract<NucleusEntry, { kind: 'compact' }>;
export type NucleusOwn = Extract<
  NucleusEntry,
  { kind: 'error' | 'interrupted' | 'opened' | 'renewed' }
>;

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
function callsOf(tools: readonly (ActivityEntry | NucleusCall)[]): ToolCall[] {
  const calls = new Map<string, { start?: ActivityEntry; end?: ActivityEntry }>();
  for (const line of tools) {
    const call = calls.get(line.id) ?? {};
    // A line written twice counts once: the first.
    if (line.phase === 'start' && !call.start) call.start = line;
    if (line.phase === 'end' && !call.end) call.end = line;
    calls.set(line.id, call);
  }
  return [...calls.entries()].map(([id, { start, end: ended }]) => {
    const own = (start ?? ended) as NucleusCall;
    // Refused by Nucleus's gate (NU2): it never ran, its end is its start.
    const denied = !ended && start && own.gate?.decision === 'deny';
    const end = denied ? { ...start, phase: 'end' as const, failed: true as const } : ended;
    const first = (start ?? end) as ActivityEntry;
    const timed = !first.untimed;
    const startedAt = timed && start ? start.at : undefined;
    const endedAt = timed && end ? end.at : undefined;
    const ms = denied
      ? undefined
      : (end?.ms ??
        (startedAt && endedAt
          ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt))
          : undefined));
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
      ...nucleusFields(start, ended),
    };
  });
}

/** What Nucleus's lines (NU2) keep of a call besides a workspace's. */
function nucleusFields(start?: NucleusCall, end?: NucleusCall): Partial<ToolCall> {
  const gate = start?.gate;
  const refused =
    end?.refused ?? (gate?.decision === 'deny' && !end ? (gate.reason ?? 'refused') : undefined);
  const source = start?.source ?? end?.source;
  return {
    ...(gate ? { gate } : {}),
    ...(end?.pages ? { pages: end.pages } : {}),
    ...(end?.links ? { links: end.links } : {}),
    ...(refused ? { refused } : {}),
    ...(source ? { source } : {}),
  };
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
  source: 'workspace' | 'thread' | 'tool' | 'commit' | 'review' | 'nucleus' | 'symbiote';
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

/** The name of one of Symbiote's tools an agent's call used (Claude Code's or Codex's), or null. */
export function symbioteTool(call: Pick<ToolCall, 'tool' | 'subject'>): string | null {
  const claude = /^mcp__symbiote__(.+)$/.exec(call.tool)?.[1];
  if (claude) return claude;
  if (call.tool === 'mcp' && call.subject?.startsWith('symbiote.')) {
    return call.subject.slice('symbiote.'.length);
  }
  return null;
}

/** A call's arguments compared whatever their keys' order; none is `{}`. */
function argsKey(input: string | undefined): string {
  if (!input) return '{}';
  try {
    const value = JSON.parse(input) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return input;
    const sorted = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    );
    return JSON.stringify(sorted);
  } catch {
    return input;
  }
}

/** Nucleus's tools on the web: Claude Code's search and page, Codex's search (which opens pages). */
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch', 'webSearch']);

/** A Nucleus call's kind of work where it has its own (NU2): the web, Symbiote's tools. */
function nucleusKind(call: ToolCall): WorkKind | undefined {
  if (call.source === 'symbiote' || symbioteTool(call) !== null) return 'symbiote';
  return WEB_TOOLS.has(call.tool) ? 'web' : undefined;
}

/** How far Symbiote's record of a call may be from its agent's, each side: Codex's is read every 2 s. */
const PAIR_MS = 5000;

/**
 * Symbiote's records of its tools' calls paired with the agents' calls they answered (NU2,
 * decision 607): the same tool and arguments, Symbiote's start within the agent's call. Only where
 * each has one candidate: two alike at once stay apart, never guessed.
 */
function pairSymbiote(calls: readonly ToolCall[]): Set<ToolCall> {
  const ours = calls.filter((c) => c.source === 'symbiote');
  const theirs = calls.filter((c) => c.source !== 'symbiote' && symbioteTool(c) !== null);
  const fits = (o: ToolCall, t: ToolCall) => {
    if (symbioteTool(t) !== o.tool || argsKey(t.input) !== argsKey(o.input)) return false;
    if (!o.startedAt || !t.startedAt) return !t.startedAt;
    const at = Date.parse(o.startedAt);
    const from = Date.parse(t.startedAt) - PAIR_MS;
    const to = t.endedAt ? Date.parse(t.endedAt) + PAIR_MS : Infinity;
    return at >= from && at <= to;
  };
  const paired = new Set<ToolCall>();
  for (const o of ours) {
    const candidates = theirs.filter((t) => !t.symbiote && fits(o, t));
    const only = candidates[0];
    if (candidates.length !== 1 || !only) continue;
    if (ours.filter((other) => !paired.has(other) && fits(other, only)).length !== 1) continue;
    only.symbiote = o;
    paired.add(o);
    // Symbiote saw the call first (Codex's items are read every 2 s): it started then.
    if (o.startedAt && only.startedAt && Date.parse(o.startedAt) < Date.parse(only.startedAt)) {
      only.startedAt = o.startedAt;
    }
  }
  return paired;
}

/**
 * Nucleus's activity as the tab's events (NU2), oldest first, keys stable as the file grows: its
 * messages and answers, its sessions' starts and ends, each call once (the gate's refusals ended
 * at their start; Symbiote's record of a call of its tools paired with its agent's call, else a
 * call of its own), each Confirm once with its end, a compaction once, its errors, interruptions,
 * conversations opened and ended.
 */
export function nucleusEvents(lines: readonly NucleusActivityLine[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const sortTimes: number[] = [];
  const seen = new Map<string, number>();
  const keyOf = (kind: string, at: string) => {
    const id = `${kind}:${at}`;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return `${id}:${n}`;
  };
  const add = (event: ActivityEvent, sortAt: string | undefined) => {
    events.push(event);
    sortTimes.push(time(sortAt));
  };
  const calls = callsOf(lines.filter((l): l is NucleusCall => 'phase' in l));
  const paired = pairSymbiote(calls);
  const byId = new Map(calls.map((c) => [c.id, c]));
  const started = new Set<string>();
  const confirms = new Map<string, Extract<ActivityEvent, { kind: 'confirm' }>>();
  let compacting: Extract<ActivityEvent, { kind: 'compact' }> | null = null;
  for (const line of lines) {
    if ('phase' in line) continue;
    const session = line.conversation ?? '';
    const head = { key: keyOf(line.kind, line.at), at: line.at };
    switch (line.kind) {
      case 'prompt':
        add(
          {
            ...head,
            kind: 'prompt',
            entry: { at: line.at, session, kind: 'prompt', text: line.text },
            first: false,
          },
          line.at,
        );
        break;
      case 'report':
        add(
          {
            ...head,
            kind: 'report',
            entry: { at: line.at, session, kind: 'report', text: line.text },
            ...(line.tokens ? { tokens: line.tokens } : {}),
            ...(line.ms !== undefined ? { ms: line.ms } : {}),
          },
          line.at,
        );
        break;
      case 'start':
        add(
          {
            ...head,
            kind: 'start',
            entry: { at: line.at, session, kind: 'start', source: line.source },
            first: !started.has(session),
          },
          line.at,
        );
        started.add(session);
        break;
      case 'end':
        add(
          {
            ...head,
            kind: 'end',
            entry: {
              at: line.at,
              session,
              kind: 'end',
              ...(line.reason ? { reason: line.reason } : {}),
            },
          },
          line.at,
        );
        break;
      case 'notice':
        add(
          {
            ...head,
            kind: 'notice',
            entry: {
              at: line.at,
              session,
              kind: 'notice',
              type: line.type,
              ...(line.message ? { message: line.message } : {}),
            },
          },
          line.at,
        );
        break;
      case 'confirm': {
        const known = confirms.get(line.ask);
        const did = line.call ? byId.get(line.call) : undefined;
        if (known) {
          if (line.stage === 'ended') known.ended = line;
          else known.asked = line;
          continue;
        }
        const event: Extract<ActivityEvent, { kind: 'confirm' }> = {
          key: `confirm:${line.ask}`,
          at: line.at,
          kind: 'confirm',
          ...(line.stage === 'asked' ? { asked: line } : { ended: line }),
          ...(did ? { did } : {}),
        };
        confirms.set(line.ask, event);
        add(event, line.at);
        break;
      }
      case 'compact': {
        // A compaction's two lines, before and after, are one event.
        if (line.stage === 'after' && compacting && !compacting.after) {
          compacting.after = line;
          compacting = null;
          continue;
        }
        const event: Extract<ActivityEvent, { kind: 'compact' }> = {
          ...head,
          kind: 'compact',
          ...(line.stage === 'before' ? { before: line } : { after: line }),
        };
        compacting = line.stage === 'before' ? event : null;
        add(event, line.at);
        break;
      }
      case 'error':
      case 'interrupted':
      case 'opened':
      case 'renewed':
        add({ ...head, kind: 'nucleus', entry: line }, line.at);
        break;
      default: {
        const unknown = line as { at: string; kind: string };
        add({ ...head, kind: 'unknown', entry: unknown }, unknown.at);
      }
    }
  }
  // A call whose Confirm was not given failed by the person's choice: said by the Confirm.
  for (const confirm of confirms.values()) {
    const answer = confirm.ended?.stage === 'ended' ? confirm.ended.answer : undefined;
    if (!confirm.did || !answer || answer === 'confirmed') continue;
    confirm.did.declined = true;
    const asked = calls.find((c) => c.symbiote === confirm.did);
    if (asked) asked.declined = true;
  }
  for (const call of calls) {
    if (paired.has(call)) continue;
    const kind = nucleusKind(call);
    if (kind) call.kind = kind;
    const line = (call.start ?? call.end) as ActivityEntry;
    const at = call.startedAt ?? call.endedAt;
    add({ key: `call:${call.id}`, ...(at ? { at } : {}), kind: 'call', call }, at ?? line.at);
  }
  return inOrder(events, sortTimes);
}

/**
 * Nucleus's raw stream (NU2): every line of its activity as recorded, in time order — its agent's
 * calls (`tool`), Symbiote's record of its tools (`symbiote`), the rest (`nucleus`).
 */
export function nucleusRawLines(lines: readonly NucleusActivityLine[]): RawLine[] {
  const out: RawLine[] = [];
  const sortTimes: number[] = [];
  lines.forEach((line, i) => {
    if ('phase' in line) {
      out.push({
        key: `line:${i}`,
        ...(line.untimed ? {} : { at: line.at }),
        source: line.source === 'symbiote' ? 'symbiote' : 'tool',
        what: `${line.tool} ${line.phase}`,
        value: line,
      });
    } else {
      const stage = 'stage' in line ? ` ${line.stage}` : '';
      out.push({
        key: `line:${i}`,
        at: line.at,
        source: 'nucleus',
        what: `${line.kind}${stage}`,
        value: line,
      });
    }
    sortTimes.push(time(line.at));
  });
  return inOrder(out, sortTimes);
}
