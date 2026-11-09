// An agent's calls into runs (V73, decision 515): by their kind and task, the commits paired with
// the calls that made them, short runs merged into their neighbours, debugging after a failed test.
import { COMMAND_TOOLS, isCommitCommand, type WorkKind } from './classify.js';
import type { ActivityEvent, ToolCall } from './events.js';
import {
  type CallEvent,
  type CommitEvent,
  type Context,
  type Run,
  type WorkEvent,
  callsIn,
  commandOf,
  isCall,
  isTest,
  kindOf,
  outcome,
  testName,
} from './group-parts.js';

/**
 * Commits paired with the calls that made them (V73): a `git commit` (or merge) whose run holds
 * the commit's time — git keeps it in whole seconds, so a second's leeway each side. A commit no
 * call made (in a terminal, by another agent) stays alone.
 */
export function commitsMade(events: readonly ActivityEvent[]): Map<string, CommitEvent> {
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
export function runsOf(events: readonly WorkEvent[], tasks: TaskState): Run[] {
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
export class TaskState {
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
export function adjacent(runs: readonly Run[]): Run[] {
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
export function sandwiched(runs: readonly Run[], context: Context): Run[] {
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
export function stragglers(runs: readonly Run[]): Run[] {
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
export function debugging(runs: readonly Run[], context: Context): Run[] {
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
export function commitsCut(run: Run): Run[] {
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
