// The Activity tab's phases (V73, decisions 513, 515, 518): the events grouped as the work went —
// milestones (a prompt, the person's message, a question, a report, a commit, the verdict, a
// session's start and end) between phases of calls (exploring, implementing, documenting, testing,
// looking at screenshots, debugging, git). A presentation of the events: each event is in one
// group, as it is; a group says only what its events say.
import type { ThreadEntry, TurnTokens, WorkspaceAgentState } from '@symbiote/core';
import { AGENT_NAMES, askedFor } from '../workspaces.js';
import {
  callKind,
  COMMAND_TOOLS,
  EDIT_TOOLS,
  editPaths,
  gitVerbs,
  IMAGE,
  isCommitCommand,
  outside,
  testCommand,
  shownCommand,
  type WorkKind,
} from './classify.js';
import { symbioteTool, type ActivityEvent, type NucleusOwn, type ToolCall } from './events.js';
import { countsText, testCounts, type TestCounts } from './test-summary.js';

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
  said?: { text: string; tone: 'info' | 'error' | 'added' | 'warning' | 'muted' };
  /** An answer's turn (NU2): its tokens and time, as its agent reported them. */
  tokens?: TurnTokens;
  took?: number;
}

type CallEvent = Extract<ActivityEvent, { kind: 'call' }>;
type CommitEvent = Extract<ActivityEvent, { kind: 'commit' }>;
/** What a phase holds: its calls, and the commits they made. */
type WorkEvent = CallEvent | CommitEvent;

interface Run {
  kind: WorkKind | 'debug' | null;
  events: WorkEvent[];
  task?: string;
  /** Debugging's: the test whose failure it follows. */
  after?: string;
}

interface Context {
  agent: WorkspaceAgentState;
  worktree: string;
  /** When the agent's current turn began: its last prompt. */
  turn: number;
  /** The newest question, when the agent asked it this turn. */
  lastAsks?: string;
  /** Nucleus's activity (NU2): its own words and milestones. */
  nucleus?: true;
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const firstLine = (text: string) =>
  (text.split('\n').find((line) => line.trim() !== '') ?? '').trim();
const lineTime = (call: ToolCall) => Date.parse((call.start ?? call.end)?.at ?? '') || 0;
const isCall = (event: ActivityEvent): event is CallEvent => event.kind === 'call';
const callsIn = (events: readonly ActivityEvent[]) => events.filter(isCall).map((e) => e.call);

/** Whether a call runs now: no end, in the agent's current turn, while it works. */
const running = (call: ToolCall, context: Context) =>
  !call.end && context.agent.state === 'working' && lineTime(call) >= context.turn;

/** A call's kind (Nucleus's own when it has one, NU2), `reasoning` and questions none. */
const kindOf = (call: ToolCall): WorkKind | null =>
  call.kind !== undefined ? call.kind : callKind(call);

/** Where a call's command is shown: its whole text when kept, else its subject. */
const commandOf = (call: ToolCall) => call.input ?? call.subject ?? '';

/** The tools named after an edit are edits; commands that write in the worktree are too. */
const isEdit = (call: ToolCall) => {
  const kind = kindOf(call);
  return kind === 'implement' || kind === 'docs';
};

const isTest = (call: ToolCall) => kindOf(call) === 'test';

/**
 * A test call's outcome: passed, failed, stopped, running or never ended. Failed also when its
 * runner printed failures though it exited 0: piped to `tail`, a command's exit is the pipe's.
 */
function outcome(call: ToolCall, context: Context): GroupStatus {
  if (running(call, context)) return 'running';
  if (call.interrupted) return 'cancelled';
  if (call.failed) return 'failed';
  if (!call.end) return 'open';
  const counts = call.output ? testCounts(call.output) : null;
  return counts && ((counts.failed ?? 0) > 0 || (counts.errors ?? 0) > 0) ? 'failed' : 'done';
}

/**
 * Commits paired with the calls that made them (V73): a `git commit` (or merge) whose run holds
 * the commit's time — git keeps it in whole seconds, so a second's leeway each side. A commit no
 * call made (in a terminal, by another agent) stays alone.
 */
function commitsMade(events: readonly ActivityEvent[]): Map<string, CommitEvent> {
  const made = new Map<string, CommitEvent>();
  const candidates = events.filter(
    (e): e is CallEvent =>
      isCall(e) &&
      COMMAND_TOOLS.has(e.call.tool) &&
      !!e.call.startedAt &&
      isCommitCommand(commandOf(e.call)),
  );
  for (const event of events) {
    if (event.kind !== 'commit') continue;
    const at = Date.parse(event.commit.date);
    let best: { call: CallEvent; distance: number } | null = null;
    for (const call of candidates) {
      if (made.has(call.key)) continue;
      const from = Date.parse(call.call.startedAt ?? '') - 1500;
      const to = Date.parse(call.call.endedAt ?? call.call.startedAt ?? '') + 1500;
      if (at < from || at > to) continue;
      const distance = Math.abs(at - from);
      if (!best || distance < best.distance) best = { call, distance };
    }
    if (best) made.set(best.call.key, event);
  }
  return made;
}

/** The runs of a stretch of calls: one kind each, a call of none joining its neighbours. */
function runsOf(events: readonly WorkEvent[], tasks: TaskState): Run[] {
  const runs: Run[] = [];
  let run: Run | null = null;
  for (const event of events) {
    if (event.kind === 'commit') {
      run?.events.push(event);
      continue;
    }
    const { call } = event;
    const started = tasks.see(call);
    // Another task begins: a phase of its own, once this one did something.
    if (started && run && run.kind !== null) run = null;
    const kind = kindOf(call);
    if (!run || (kind !== null && run.kind !== null && run.kind !== kind)) {
      run = { kind, events: [], ...(tasks.subject() ? { task: tasks.subject() as string } : {}) };
      runs.push(run);
    }
    if (run.kind === null && kind !== null) run.kind = kind;
    if (!run.task && tasks.subject()) run.task = tasks.subject();
    run.events.push(event);
  }
  return runs;
}

/** The agent's tasks (`TaskCreate`, `TaskUpdate`): their subjects, and the one in progress. */
class TaskState {
  private readonly subjects = new Map<string, string>();
  private current: string | null = null;

  /** Takes in a call; whether a task other than the current one started with it. */
  see(call: ToolCall): boolean {
    const task = call.task;
    if (!task) return false;
    if (call.tool === 'TaskCreate' && task.id && task.subject)
      this.subjects.set(task.id, task.subject);
    if (call.tool !== 'TaskUpdate' || !task.id) return false;
    if (task.status === 'in_progress' && task.id !== this.current) {
      this.current = task.id;
      return true;
    }
    if ((task.status === 'completed' || task.status === 'deleted') && task.id === this.current) {
      this.current = null;
    }
    return false;
  }

  subject(): string | undefined {
    if (this.current === null) return undefined;
    return this.subjects.get(this.current) ?? `Task ${this.current}`;
  }
}

const EDITS: (WorkKind | 'debug' | null)[] = ['implement', 'docs'];

/** How many calls, besides reads, a phase may hold of another kind between two of its own. */
const BETWEEN = 4;

/** A run's calls. */
const callsOf = (run: Run) => callsIn(run.events);

/** Whether a run is a test run whose last test failed (not stopped): never absorbed. */
function failedTests(run: Run, context: Context): boolean {
  if (run.kind !== 'test') return false;
  const last = callsOf(run).filter(isTest).at(-1);
  return last !== undefined && outcome(last, context) === 'failed';
}

/** Runs of one kind and task next to each other as one. */
function adjacent(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const before = out.at(-1);
    if (before && before.kind === run.kind && before.task === run.task) {
      before.events.push(...run.events);
    } else out.push({ ...run, events: [...run.events] });
  }
  return out;
}

/**
 * What a phase may hold between two runs of its own kind: an implementation the tests it runs
 * and a few looks (an agent tests as it implements); a visual inspection a few tweaks; an
 * exploration or testing only reads. Never a failed test, git, or another task's work.
 */
function absorbs(kind: Run['kind'], between: Run, context: Context): boolean {
  if (between.kind === 'git' || failedTests(between, context)) return false;
  if (between.kind === 'explore' || between.kind === null) return true;
  if (kind === 'implement' || kind === 'docs')
    return between.kind === 'test' || between.kind === 'visual';
  if (kind === 'visual') return between.kind !== 'debug';
  return false;
}

/**
 * Phases from runs (V73): runs of one kind with little of another between them are one — a
 * test run or a look between edits is the implementation's, tweaks between screenshots the
 * inspection's, reads between anything its. Taken from the left, so a phase keeps its first
 * run's key as more arrive.
 */
function sandwiched(runs: readonly Run[], context: Context): Run[] {
  const out: Run[] = [];
  let i = 0;
  while (i < runs.length) {
    const first = runs[i] as Run;
    const merged: Run = { ...first, events: [...first.events] };
    let next = i + 1;
    for (;;) {
      let weight = 0;
      let j = next;
      for (; j < runs.length; j++) {
        const run = runs[j] as Run;
        if (run.kind === merged.kind && run.task === merged.task) break;
        if (run.task !== merged.task || !absorbs(merged.kind, run, context)) {
          j = runs.length;
          break;
        }
        // Reads between edits are free (an agent reads as it implements); elsewhere they count.
        const free = run.kind === null || (run.kind === 'explore' && EDITS.includes(merged.kind));
        if (!free) weight += callsOf(run).length;
        if (weight > BETWEEN) {
          j = runs.length;
          break;
        }
      }
      if (j >= runs.length) break;
      for (let k = next; k <= j; k++) merged.events.push(...(runs[k] as Run).events);
      next = j + 1;
    }
    out.push(merged);
    i = next;
  }
  return out;
}

/**
 * A read or two on their own (or a single look) join the edits right after them (reading before
 * changing), else the phase before them (checking what was just done).
 */
function stragglers(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  const pending: Run[] = [];
  runs.forEach((run, i) => {
    const short = (run.kind === 'explore' || run.kind === 'visual') && callsOf(run).length <= 2;
    const next = runs[i + 1];
    const before = out.at(-1);
    if (short && next && EDITS.includes(next.kind) && next.task === run.task) {
      pending.push(run);
      return;
    }
    if (short && before && before.kind !== null && before.task === run.task) {
      before.events.push(...run.events);
      return;
    }
    // First in its stretch, before git: git's (a fetch and a log before a merge).
    if (short && !before && next?.kind === 'git' && next.task === run.task) {
      pending.push(run);
      return;
    }
    const events = [...pending.flatMap((p) => p.events), ...run.events];
    pending.length = 0;
    out.push({ ...run, events });
  });
  return adjacent(out);
}

/**
 * Debugging (decision 518): after a test run whose last test failed, the runs to the next passing
 * test (or the stretch's end), when they edit something.
 */
function debugging(runs: readonly Run[], context: Context): Run[] {
  const out: Run[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i] as Run;
    out.push(run);
    const lastTest = callsIn(run.events).filter(isTest).at(-1);
    if (run.kind !== 'test' || !lastTest || outcome(lastTest, context) !== 'failed') continue;
    let j = i + 1;
    let edits = false;
    for (; j < runs.length; j++) {
      const next = runs[j] as Run;
      if (next.task !== run.task) break;
      if (next.kind === 'test') {
        if (!edits) break;
        const last = callsIn(next.events).filter(isTest).at(-1);
        if (last && outcome(last, context) !== 'failed') {
          j += 1;
          break;
        }
      }
      if (EDITS.includes(next.kind)) edits = true;
    }
    const taken = runs.slice(i + 1, j);
    if (!edits || taken.length === 0) continue;
    out.push({
      kind: 'debug',
      events: taken.flatMap((r) => r.events),
      ...(run.task ? { task: run.task } : {}),
      after: testName(lastTest, context),
    });
    i = j - 1;
  }
  return out;
}

/** A git run cut at its commits: each commit with the git calls before it, the rest the last's. */
function commitsCut(run: Run): Run[] {
  if (run.kind !== 'git' || !run.events.some((e) => e.kind === 'commit')) return [run];
  const parts: Run[] = [];
  let part: WorkEvent[] = [];
  for (const event of run.events) {
    part.push(event);
    if (event.kind === 'commit') {
      parts.push({ ...run, events: part });
      part = [];
    }
  }
  if (part.length > 0) parts.at(-1)?.events.push(...part);
  return parts;
}

/** Times of a group: its first event's and its last's end. */
function times(events: readonly ActivityEvent[]): Pick<ActivityGroup, 'start' | 'end'> {
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

/** What the files an edit phase touched came to: "2 files · +14 −1". */
function editsText(calls: readonly ToolCall[]): string {
  const files = new Set<string>();
  let added = 0;
  let removed = 0;
  let counted = false;
  let commands = 0;
  for (const call of calls) {
    if (EDIT_TOOLS.has(call.tool)) {
      for (const path of editPaths(call.tool, call.subject)) if (!outside(path)) files.add(path);
    } else if (COMMAND_TOOLS.has(call.tool) && isEdit(call)) commands += 1;
    if (call.added !== undefined || call.removed !== undefined) {
      counted = true;
      added += call.added ?? 0;
      removed += call.removed ?? 0;
    }
  }
  const parts = [
    files.size > 0 ? plural(files.size, 'file', 'files') : '',
    files.size === 0 && commands > 0 ? plural(commands, 'command', 'commands') : '',
    counted ? `+${added.toLocaleString('en-US')} −${removed.toLocaleString('en-US')}` : '',
  ];
  return parts.filter((p) => p !== '').join(' · ');
}

/** What an exploration came to: "12 files read · 8 searches · 15 commands". */
function readsText(calls: readonly ToolCall[]): string {
  const read = new Set<string>();
  let searches = 0;
  let pages = 0;
  let subagents = 0;
  let commands = 0;
  for (const call of calls) {
    if (call.tool === 'Read') read.add(call.subject ?? call.id);
    else if (['Grep', 'Glob', 'WebSearch', 'webSearch', 'LS'].includes(call.tool)) searches += 1;
    else if (call.tool === 'WebFetch') pages += 1;
    else if (call.tool === 'Task' || call.tool === 'Agent') subagents += 1;
    else if (COMMAND_TOOLS.has(call.tool)) commands += 1;
  }
  return [
    read.size > 0 ? `${plural(read.size, 'file', 'files')} read` : '',
    searches > 0 ? plural(searches, 'search', 'searches') : '',
    pages > 0 ? `${plural(pages, 'page', 'pages')} fetched` : '',
    subagents > 0 ? plural(subagents, 'subagent', 'subagents') : '',
    commands > 0 ? plural(commands, 'command', 'commands') : '',
  ]
    .filter((p) => p !== '')
    .join(' · ');
}

/** A test call's command as a summary says it: `pnpm check`. */
const testName = (call: ToolCall, context: Context) =>
  firstLine(shownCommand(testCommand(commandOf(call)) ?? commandOf(call), context.worktree));

/** A test call in a line: "pnpm check · 42 passed", "npx vitest run · 1 failed (exit 1)". */
function testText(call: ToolCall, context: Context): { text: string; counts?: TestCounts } {
  const name = testName(call, context);
  const counts = call.output ? testCounts(call.output) : null;
  const state = outcome(call, context);
  const exit = call.exit !== undefined && call.exit !== 0 ? ` (exit ${call.exit})` : '';
  const result = counts
    ? `${countsText(counts)}${state === 'failed' ? exit : ''}`
    : state === 'failed'
      ? `failed${exit}`
      : state === 'done'
        ? 'passed'
        : state === 'cancelled'
          ? 'stopped'
          : state === 'running'
            ? 'running'
            : 'no end recorded';
  return { text: `${name} · ${result}`, ...(counts ? { counts } : {}) };
}

const TITLES: Record<WorkKind | 'debug' | 'other', string> = {
  explore: 'Exploration',
  implement: 'Implementation',
  docs: 'Documentation',
  test: 'Testing',
  visual: 'Visual inspection',
  debug: 'Debugging',
  git: 'Git',
  web: 'Web research',
  symbiote: 'Symbiote',
  other: 'Other tools',
};

/** What Nucleus did on the web (NU2): "2 searches · 5 pages". */
function webText(calls: readonly ToolCall[]): string {
  let searches = 0;
  let pages = 0;
  for (const call of calls) {
    if (call.refused) continue;
    if (call.tool === 'WebFetch') pages += 1;
    else if (call.tool === 'WebSearch') searches += 1;
    else if (call.tool === 'webSearch') {
      // Codex's item is a search, or a page it opened or searched in.
      if (call.pages && call.pages.length > 0) pages += call.pages.length;
      else searches += 1;
    }
  }
  return [
    searches > 0 ? plural(searches, 'search', 'searches') : '',
    pages > 0 ? plural(pages, 'page', 'pages') : '',
  ]
    .filter((p) => p !== '')
    .join(' · ');
}

/** Which of Symbiote's tools Nucleus used, once each in order (NU2): "workspaces · review". */
function symbioteText(calls: readonly ToolCall[]): string {
  return [...new Set(calls.flatMap((c) => symbioteTool(c) ?? (c.source ? [c.tool] : [])))].join(
    ' · ',
  );
}

/** A phase of calls as a group: its title, its facts, its status. */
function workGroup(run: Run, context: Context): ActivityGroup {
  const calls = callsIn(run.events);
  const commit = run.events.find((e): e is CommitEvent => e.kind === 'commit');
  const kind: GroupKind = commit ? 'commit' : (run.kind ?? 'other');
  // A call Nucleus's gate or agent refused is said as refused (NU2), one the person declined by
  // its Confirm: neither is a failure.
  const failures = calls.filter(
    (c) => c.failed && !c.interrupted && !c.refused && !c.declined,
  ).length;
  const last = calls.at(-1);
  let status: GroupStatus = 'done';
  if (calls.some((c) => running(c, context))) status = 'running';
  else if (last?.interrupted) status = 'cancelled';
  else if (last && !last.end) status = 'open';
  let summary = '';
  let tests: TestCounts | undefined;
  switch (kind) {
    case 'explore':
      summary = readsText(calls);
      break;
    case 'implement':
    case 'docs':
      summary = editsText(calls);
      break;
    case 'visual': {
      const images = calls.filter((c) => c.tool === 'Read' && IMAGE.test(c.subject ?? '')).length;
      const edits = calls.filter(isEdit).length;
      const commands = calls.filter((c) => COMMAND_TOOLS.has(c.tool) && !isEdit(c)).length;
      summary = [
        images > 0 ? plural(images, 'image', 'images') : '',
        edits > 0 ? plural(edits, 'edit', 'edits') : '',
        commands > 0 ? plural(commands, 'command', 'commands') : '',
      ]
        .filter((p) => p !== '')
        .join(' · ');
      break;
    }
    case 'test': {
      const runs = calls.filter(isTest);
      const decisive = runs.at(-1);
      if (decisive) {
        const said = testText(decisive, context);
        summary = runs.length > 1 ? `${said.text} · ${runs.length} runs` : said.text;
        tests = said.counts;
        const state = outcome(decisive, context);
        if (state !== 'done') status = state;
        else if (runs.some((c) => c.failed && !c.interrupted)) status = 'recovered';
      }
      break;
    }
    case 'debug': {
      const runs = calls.filter(isTest);
      const edits = calls.filter(isEdit).length;
      const decisive = runs.at(-1);
      const name = run.after ?? (decisive ? testName(decisive, context) : 'the test');
      const editWords = plural(edits, 'edit', 'edits');
      if (!decisive) summary = `${name} not run again · ${editWords}`;
      else {
        const state = outcome(decisive, context);
        const runWords = plural(runs.length, 'run', 'runs');
        const again = testName(decisive, context);
        if (state === 'running') {
          status = 'running';
          summary = `${name} · ${again === name ? 'running again' : `running ${again}`} · ${editWords}`;
        } else if (state === 'done') {
          status = status === 'running' ? status : 'recovered';
          summary = `${name} passed after ${runWords} · ${editWords}`;
        } else {
          if (status !== 'running') status = state;
          summary = `${name} still failing after ${runWords} · ${editWords}`;
        }
        tests = testText(decisive, context).counts;
      }
      break;
    }
    case 'git':
    case 'commit': {
      summary = [...new Set(calls.flatMap((c) => gitVerbs(commandOf(c))))].join(' · ');
      const lastGit = calls.filter((c) => kindOf(c) === 'git').at(-1);
      if (status === 'done' && lastGit?.failed && !lastGit.interrupted) status = 'failed';
      break;
    }
    case 'web':
      summary = webText(calls);
      break;
    case 'symbiote':
      summary = symbioteText(calls);
      break;
    default: {
      const tools = [...new Set(calls.map((c) => c.tool))];
      summary = `${plural(calls.length, 'call', 'calls')}: ${tools.slice(0, 3).join(', ')}${tools.length > 3 ? '…' : ''}`;
    }
  }
  // Nucleus's calls its gate or its agent refused (NU2): said, never folded away.
  const refused = calls.filter((c) => c.refused !== undefined).length;
  if (refused > 0)
    summary = [summary, `${refused.toLocaleString('en-US')} refused`]
      .filter((p) => p !== '')
      .join(' · ');
  const first = run.events[0] as WorkEvent;
  return {
    key: first.key,
    kind,
    milestone: kind === 'commit',
    title: commit ? commit.commit.subject : TITLES[kind as keyof typeof TITLES],
    ...(summary ? { summary } : {}),
    ...times(run.events),
    status,
    failures,
    events: run.events,
    ...(run.task ? { task: run.task } : {}),
    ...(commit ? { sha: commit.commit.sha } : {}),
    ...(tests ? { tests } : {}),
  };
}

/** Calls the timeline leaves to the raw stream: a question (its ask says it), reasoning. */
const SAID_ELSEWHERE = new Set(['AskUserQuestion', 'reasoning']);

const VERDICTS = {
  approve: 'Approved',
  'request-changes': 'Changes requested',
  comment: 'Commented',
} as const;

/** How a session ended, in words; a Codex run's other reasons are its failure (V20a). */
function endGroup(entry: Extract<ThreadEntry, { kind: 'end' }>, codex: boolean) {
  const reason = entry.reason;
  if (reason === 'completed') return { title: 'Its run completed', status: 'done' as const };
  if (reason === 'stopped') return { title: 'Stopped', status: 'cancelled' as const };
  if (!reason || ['other', 'clear', 'logout', 'prompt_input_exit'].includes(reason)) {
    return { title: 'Its session ended', status: 'done' as const };
  }
  return codex
    ? { title: `Failed: ${firstLine(reason)}`, status: 'failed' as const }
    : { title: `Its session ended: ${firstLine(reason)}`, status: 'done' as const };
}

/** A Confirm's end in words and tone (NU2). */
const CONFIRM_ENDS = {
  confirmed: { text: 'Confirmed', tone: 'added' },
  declined: { text: 'Declined', tone: 'muted' },
  expired: { text: 'No answer in time', tone: 'warning' },
  gone: { text: 'Its call ended first', tone: 'muted' },
} as const;

type Base = Pick<ActivityGroup, 'key' | 'start' | 'end' | 'failures' | 'events'>;

/** A Confirm (NU2): asked, waiting for the person until it ends; what the yes did, its detail. */
function confirmGroup(
  event: Extract<ActivityEvent, { kind: 'confirm' }>,
  base: Base,
  context: Context,
): ActivityGroup {
  const words = (event.asked ?? event.ended)?.words ?? '';
  const answer = event.ended?.stage === 'ended' ? event.ended.answer : undefined;
  const did = event.did?.output;
  // Unanswered while Nucleus works on: it waits for the person; else its end was never recorded.
  const live = context.agent.state === 'working' || context.agent.state === 'needs-you';
  return {
    ...base,
    ...times([event, ...(event.ended ? [{ ...event, at: event.ended.at }] : [])]),
    kind: 'confirm',
    milestone: true,
    title: `Confirm: ${words}`,
    ...((event.asked ?? event.ended) ? { summary: (event.asked ?? event.ended)?.tool ?? '' } : {}),
    ...(answer === 'confirmed' && did ? { detail: did } : {}),
    status: !answer
      ? live
        ? 'waiting'
        : 'open'
      : answer === 'declined' || answer === 'gone'
        ? 'cancelled'
        : 'done',
    ...(answer ? { said: CONFIRM_ENDS[answer] } : {}),
  };
}

/** Nucleus's own events (NU2): an error, a turn interrupted, a conversation opened or ended. */
function nucleusGroup(entry: NucleusOwn, base: Base, context: Context): ActivityGroup {
  const agent = AGENT_NAMES[entry.agent ?? context.agent.kind ?? 'claude'];
  switch (entry.kind) {
    case 'error':
      return {
        ...base,
        kind: 'error',
        milestone: true,
        title: `Error: ${firstLine(entry.error)}`,
        ...(entry.details ? { detail: entry.details } : {}),
        status: 'failed',
      };
    case 'interrupted':
      return {
        ...base,
        kind: 'interrupted',
        milestone: false,
        title: 'Interrupted',
        status: 'cancelled',
      };
    case 'opened': {
      const on = [entry.model, entry.effort ? `${entry.effort} effort` : ''].filter(Boolean);
      return {
        ...base,
        kind: 'session',
        milestone: true,
        title: `A conversation opened on ${agent}`,
        ...(on.length > 0 ? { summary: on.join(' · ') } : {}),
        status: 'done',
      };
    }
    default:
      return {
        ...base,
        kind: 'end',
        milestone: true,
        title: 'New conversation: this one ended',
        status: 'done',
      };
  }
}

/** What a question asks, its questions alone: "Which store?; Which plan?". */
export const questionsOf = (entry: Extract<ThreadEntry, { kind: 'asks' }>) =>
  (entry.questions ?? []).map((q) => q.question).join('; ');

/** A milestone event as its group; null for one the timeline leaves to the raw stream. */
function milestone(
  event: Exclude<ActivityEvent, WorkEvent>,
  context: Context,
): ActivityGroup | null {
  const base = { key: event.key, ...times([event]), failures: 0, events: [event] };
  switch (event.kind) {
    case 'made': {
      const { from, base: sha } = event.workspace;
      const short = sha.slice(0, 7);
      const title = from ? `Workspace made from ${from} at ${short}` : `Workspace made at ${short}`;
      return { ...base, kind: 'made', milestone: false, title, status: 'done' };
    }
    case 'start': {
      const { entry, first } = event;
      const title = first
        ? `${AGENT_NAMES[context.agent.kind ?? 'claude']} started`
        : entry.source === 'resume'
          ? 'Continued'
          : entry.source === 'compact'
            ? 'Continued after compacting'
            : entry.source === 'clear'
              ? 'Started again: context cleared'
              : entry.source === 'fork'
                ? 'A copy of the session started'
                : 'Started again';
      return { ...base, kind: 'session', milestone: false, title, status: 'done' };
    }
    case 'prompt': {
      const { entry, first } = event;
      if (first) {
        return {
          ...base,
          kind: 'prompt',
          milestone: true,
          title: "Symbiote's prompt",
          summary: firstLine(entry.text),
          detail: entry.text,
          status: 'done',
        };
      }
      if (entry.text.trimStart().startsWith('<task-notification>')) {
        const said = /<summary>([^<]+)<\/summary>/.exec(entry.text)?.[1]?.trim();
        return {
          ...base,
          kind: 'notice',
          milestone: false,
          title: said ?? 'A background task ended',
          detail: entry.text,
          status: 'done',
        };
      }
      // Pasted text is said by its own first line, not its tag.
      const line = firstLine(entry.text.replace(/<\/?pasted_content[^>]*>/g, ''));
      return {
        ...base,
        kind: 'message',
        milestone: true,
        title: `You: ${line}`,
        ...(entry.text.trim() !== line ? { detail: entry.text } : {}),
        status: 'done',
      };
    }
    case 'asks': {
      const { entry } = event;
      const waiting =
        context.lastAsks === event.key &&
        context.agent.state === 'needs-you' &&
        !context.agent.interrupted;
      const asked = askedFor(entry, context.worktree);
      const options = entry.questions?.[0]?.options ?? [];
      return {
        ...base,
        kind: 'asks',
        milestone: true,
        title: entry.questions ? `Asked: ${questionsOf(entry)}` : `Asked for p${asked.slice(1)}`,
        ...(options.length > 0 ? { summary: options.join(' · ') } : {}),
        status: waiting ? 'waiting' : 'done',
      };
    }
    case 'report':
      return {
        ...base,
        kind: 'report',
        milestone: true,
        title: context.nucleus ? 'Answered' : 'Reported',
        summary: firstLine(event.entry.text).replace(/^#+\s*/, ''),
        detail: event.entry.text,
        status: 'done',
        ...(event.tokens ? { tokens: event.tokens } : {}),
        ...(event.ms !== undefined ? { took: event.ms } : {}),
      };
    case 'confirm':
      return confirmGroup(event, base, context);
    case 'compact': {
      const done = event.after !== undefined;
      const trigger = (event.before ?? event.after)?.trigger;
      return {
        ...base,
        ...times([event, ...(event.after ? [{ ...event, at: event.after.at }] : [])]),
        kind: 'compact',
        milestone: false,
        title: done ? 'Its context compacted' : 'Compacting its context',
        ...(trigger ? { summary: trigger === 'auto' ? 'automatically' : 'asked' } : {}),
        ...(event.after?.summary ? { detail: event.after.summary } : {}),
        status: 'done',
      };
    }
    case 'nucleus':
      return nucleusGroup(event.entry, base, context);
    case 'end': {
      const said = endGroup(
        event.entry,
        context.agent.kind === 'codex' || event.entry.run !== undefined,
      );
      return { ...base, kind: 'end', milestone: said.status !== 'done', ...said };
    }
    case 'verdict':
      return {
        ...base,
        kind: 'verdict',
        milestone: true,
        title: `Review: ${VERDICTS[event.verdict.event]}`,
        detail: event.verdict.text,
        status: 'done',
      };
    case 'unknown':
      return {
        ...base,
        kind: 'unknown',
        milestone: false,
        title: `Recorded: ${event.entry.kind}`,
        status: 'done',
      };
    default:
      // Claude Code's notices: the raw stream's; the question or the wait they announce has its own.
      return null;
  }
}

/**
 * The ask an agent may wait on: its newest, when no prompt or report came after it (a report ends
 * the turn the ask was in).
 */
export function waitingAsk(
  events: readonly ActivityEvent[],
): Extract<ActivityEvent, { kind: 'asks' }> | undefined {
  const last = events.findLast(
    (e) => e.kind === 'asks' || e.kind === 'prompt' || e.kind === 'report',
  );
  return last?.kind === 'asks' ? last : undefined;
}

/** The text a milestone is compared by, to find one recorded twice. */
function sameness(event: ActivityEvent): string | null {
  switch (event.kind) {
    case 'prompt':
    case 'report':
      return `${event.kind}:${event.entry.session}:${event.entry.text}`;
    case 'asks':
      return `asks:${event.entry.session}:${event.entry.tool}:${JSON.stringify(event.entry.questions ?? event.entry.input ?? '')}`;
    case 'end':
      return `end:${event.entry.session}:${event.entry.reason ?? ''}`;
    default:
      return null;
  }
}

/**
 * The Activity tab's groups (V73), oldest first: milestones, and the phases of the calls between
 * them. `agent`: its state, for what runs and what waits; `worktree`: to write paths short;
 * `nucleus`: Nucleus's activity (NU2), its answers and its own milestones in its words.
 */
export function activityGroups(
  events: readonly ActivityEvent[],
  { agent, worktree, nucleus }: { agent: WorkspaceAgentState; worktree: string; nucleus?: true },
): ActivityGroup[] {
  const lastPrompt = events.findLast((e) => e.kind === 'prompt');
  const asking = waitingAsk(events);
  const context: Context = {
    agent,
    worktree,
    ...(nucleus ? { nucleus } : {}),
    turn: lastPrompt?.at ? Date.parse(lastPrompt.at) : -Infinity,
    ...(asking ? { lastAsks: asking.key } : {}),
  };

  // Each commit right after the call that made it.
  const made = commitsMade(events);
  const paired = new Set([...made.values()].map((e) => e.key));
  const ordered: ActivityEvent[] = [];
  for (const event of events) {
    if (paired.has(event.key)) continue;
    ordered.push(event);
    const commit = made.get(event.key);
    if (commit) ordered.push(commit);
  }

  const groups: ActivityGroup[] = [];
  const tasks = new TaskState();
  let stretch: WorkEvent[] = [];
  const flush = () => {
    if (stretch.length === 0) return;
    const runs = debugging(
      stragglers(sandwiched(adjacent(runsOf(stretch, tasks)), context)),
      context,
    );
    for (const run of runs)
      for (const part of commitsCut(run)) groups.push(workGroup(part, context));
    stretch = [];
  };
  let previous: { same: string; at: number; group: ActivityGroup } | null = null;
  for (const event of ordered) {
    // A question's call is said by its ask; Codex's reasoning is no act (V48c): the raw stream's.
    if (event.kind === 'call' && SAID_ELSEWHERE.has(event.call.tool)) continue;
    if (event.kind === 'call' || (event.kind === 'commit' && paired.has(event.key))) {
      stretch.push(event);
      continue;
    }
    if (event.kind === 'notice') continue;
    flush();
    // The same milestone recorded twice, one after the other: one group, both events in it.
    const same = sameness(event);
    const at = event.at ? Date.parse(event.at) : 0;
    if (
      same &&
      previous &&
      previous.same === same &&
      groups.at(-1) === previous.group &&
      at - previous.at <= 5000
    ) {
      previous.group.events.push(event);
      continue;
    }
    const group =
      event.kind === 'commit'
        ? workGroup({ kind: 'git', events: [event] }, context)
        : milestone(event, context);
    if (!group) continue;
    groups.push(group);
    previous = same ? { same, at, group } : null;
  }
  flush();
  return groups;
}
