// A merge's page as proof 05-merge draws it (V93, decisions 880, 881): the state's pill, its four
// steps (Approved, Merge, Check, Land) with their words, where it is in the queue, the time since
// the person's OK, and its check's commands against the newest passing check's. Pure: tested in
// `test/merge-steps.test.ts`; the page is `Merge.tsx`.
import type { MergeEntry } from '@symbiote/core';
import { clockWords } from './hive-live.js';
import { toReview } from './merges.js';

export type MergeStepState = 'done' | 'now' | 'todo' | 'bad';

export interface MergeStep {
  name: 'Approved' | 'Merge' | 'Check' | 'Land';
  state: MergeStepState;
  detail: string;
  /** The running check against the last pass, 0–1. */
  progress?: number;
}

export interface MergeCommand {
  command: string;
  mark: 'passed' | 'failed' | 'running' | 'waiting' | 'skipped';
  time?: string;
  /** The running command against its last passing time, 0–1. */
  share?: number;
}

export interface MergePageWords {
  title: string;
  pill: { word: string; tone: 'run' | 'you' | 'ok' | 'fail' | 'idle' };
  /** The head's line after the branch: who approved it and when, where it is in the queue. */
  line: string[];
  steps: MergeStep[];
  queue: { value: string; of: string; words: string };
  time: { value: string; words: string };
  commands: MergeCommand[];
  /** The check's time in the Steps card's Check: "0:12 of ~0:20". */
  checkTime?: string;
  /** The Steps card's Land: where the target goes, and that it is pushed. */
  landWords: string;
  /** The approval: which of the branch's reviews, when, its words. */
  approval: { words: string; at: string; quote?: string };
}

/** The approving verdict, as the review list serves it (decision 882). */
export interface MergeVerdict {
  at: string;
  number?: number | undefined;
  summary?: string | undefined;
}

const two = (n: number) => String(n).padStart(2, '0');
const hm = (iso: string) => {
  const date = new Date(iso);
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
};
const short = (sha: string) => sha.slice(0, 7);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "1st", "2nd", "3rd", "11th". */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const end = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${end}`;
}

/** A step's time: "0.4 s" under ten seconds, else a clock. */
function took(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : clockWords(ms);
}

/** The merge's title: its workspace's, else the subject after "Merge <branch>: ", else its branch. */
export function mergeName(entry: MergeEntry, title?: string): string {
  if (title) return title;
  const prefix = `Merge ${entry.branch}: `;
  return entry.title.startsWith(prefix) ? entry.title.slice(prefix.length) : entry.branch;
}

/**
 * The newest passing check's command times with the same commands, from the queue's entries
 * (decision 881); none before a check that recorded them.
 */
export function expectedCheck(
  entries: readonly MergeEntry[],
  commands: readonly string[],
): number[] | undefined {
  const same = (a: readonly string[]) =>
    a.length === commands.length && a.every((c, i) => c === commands[i]);
  const passed = entries
    .filter(
      (e) =>
        e.check?.ok === true && same(e.check.commands) && e.check.steps?.length === commands.length,
    )
    .sort((a, b) => Date.parse(b.landed ?? b.updated) - Date.parse(a.landed ?? a.updated));
  return passed[0]?.check?.steps?.map((step) => step.ms);
}

/** The check's commands: done with their times, the one running against its last pass, the rest. */
function commandsOf(entry: MergeEntry, expected: number[] | undefined, now: number) {
  const check = entry.check;
  if (!check) return { commands: [] as MergeCommand[], running: undefined };
  const steps = check.steps ?? [];
  const running =
    entry.state === 'checking' && check.started && steps.length < check.commands.length
      ? {
          index: steps.length,
          ms: now - Date.parse(check.started) - steps.reduce((sum, step) => sum + step.ms, 0),
        }
      : undefined;
  const commands = check.commands.map((command, i): MergeCommand => {
    const step = steps[i];
    if (step) return { command, mark: step.ok ? 'passed' : 'failed', time: clockWords(step.ms) };
    if (running?.index === i) {
      const last = expected?.[i];
      return {
        command,
        mark: 'running',
        time: clockWords(running.ms),
        ...(last ? { share: Math.min(1, Math.round((running.ms / last) * 100) / 100) } : {}),
      };
    }
    if (check.ok === false) return { command, mark: 'skipped' };
    // A check from before V93 recorded no steps: passed as a whole.
    if (check.ok === true) return { command, mark: 'passed' };
    return { command, mark: 'waiting' };
  });
  return { commands, running };
}

/** What a merge's page says of it at `now`. */
export function mergePage(
  entry: MergeEntry,
  {
    queue,
    verdict,
    title,
    expected,
    push = false,
    now,
  }: {
    /** The queue's entries, in its order. */
    queue: readonly MergeEntry[];
    verdict?: MergeVerdict | undefined;
    /** Its workspace's title. */
    title?: string | undefined;
    /** The last passing check's command times (`expectedCheck`). */
    expected?: number[] | undefined;
    /** `merge.push` is set (the merge list says it): what lands is pushed. */
    push?: boolean | undefined;
    now: number;
  },
): MergePageWords {
  const { state, check } = entry;
  const by = entry.by === 'hive' ? 'Hive' : 'you';
  const okAt = verdict?.at;
  const live = state !== 'landed';
  const waiting = queue.filter((e) => e.state !== 'landed');
  const place = waiting.indexOf(entry) + 1;
  const behind = place > 0 ? waiting.length - place : 0;

  const pill: MergePageWords['pill'] =
    state === 'checking'
      ? { word: 'Checking the merge', tone: 'run' }
      : state === 'merging'
        ? { word: 'Merging', tone: 'run' }
        : state === 'resolving'
          ? { word: 'Resolving conflicts', tone: 'run' }
          : state === 'ready'
            ? { word: 'Ready to land', tone: 'you' }
            : state === 'needs-you'
              ? { word: toReview(entry) ? 'Review resolution' : 'Needs you', tone: 'you' }
              : state === 'failed'
                ? { word: check?.ok === false ? 'Check failed' : 'Failed', tone: 'fail' }
                : state === 'landed'
                  ? { word: 'Landed', tone: 'ok' }
                  : { word: 'Queued', tone: 'idle' };

  const line = [
    ...(okAt ? [`approved by ${by} at ${hm(okAt)}`] : []),
    live
      ? place > 0
        ? `${place === 1 ? 'first' : ordinal(place)} in the queue`
        : 'in the queue'
      : entry.landed
        ? `landed at ${hm(entry.landed)}`
        : 'landed',
  ];

  // Approved: by whom and when; else when it was queued.
  const approved: MergeStep = {
    name: 'Approved',
    state: 'done',
    detail: okAt ? `by ${by} · ${hm(okAt)}` : `queued · ${hm(entry.queued)}`,
  };

  // Merge: to come while queued, now while it merges or resolves, failed on conflicts left.
  const conflicts = entry.conflicts?.length ?? 0;
  const merged = entry.merge !== undefined;
  const mergeStep: MergeStep =
    state === 'queued' && !merged
      ? { name: 'Merge', state: 'todo', detail: `into ${entry.into}` }
      : state === 'merging'
        ? { name: 'Merge', state: 'now', detail: `into ${entry.into}` }
        : state === 'resolving'
          ? { name: 'Merge', state: 'now', detail: `resolving ${plural(conflicts, 'conflict')}` }
          : !merged && conflicts > 0
            ? {
                name: 'Merge',
                state: 'bad',
                detail: `${plural(conflicts, 'conflict')} with ${entry.into}`,
              }
            : !merged && state === 'failed'
              ? { name: 'Merge', state: 'bad', detail: entry.message?.split('\n')[0] ?? 'failed' }
              : {
                  name: 'Merge',
                  state: merged ? 'done' : 'todo',
                  detail: [
                    entry.strategy === 'fast-forward'
                      ? `fast-forward to ${short(entry.head)}`
                      : `into ${entry.into}${entry.base ? ` at ${short(entry.base)}` : ''}`,
                    ...(entry.mergeMs !== undefined ? [took(entry.mergeMs)] : []),
                  ].join(' · '),
                };

  // Check: its command and time against the last pass while it runs; passed or failed after.
  const { commands, running } = commandsOf(entry, expected, now);
  const total = expected?.reduce((sum, ms) => sum + ms, 0);
  const elapsed = check?.started ? now - Date.parse(check.started) : undefined;
  const checkTime =
    state === 'checking' && elapsed !== undefined
      ? `${clockWords(elapsed)}${total ? ` of ~${clockWords(Math.round(total / 1000) * 1000)}` : ''}`
      : check?.ms !== undefined
        ? clockWords(check.ms)
        : undefined;
  const checkStep: MergeStep = !check
    ? {
        name: 'Check',
        state: state === 'landed' || state === 'ready' ? 'done' : 'todo',
        detail: state === 'landed' || state === 'ready' ? 'no check set' : 'merge.checks',
      }
    : check.ok === true
      ? {
          name: 'Check',
          state: 'done',
          detail: check.ms !== undefined ? `passed in ${clockWords(check.ms)}` : 'passed',
        }
      : check.ok === false
        ? { name: 'Check', state: 'bad', detail: `${check.failed ?? 'a command'} failed` }
        : state === 'checking'
          ? {
              name: 'Check',
              state: 'now',
              detail: [
                running ? check.commands[running.index] : check.commands.join(' && '),
                checkTime,
              ]
                .filter(Boolean)
                .join(' · '),
              ...(total && elapsed !== undefined
                ? { progress: Math.min(1, Math.round((elapsed / total) * 100) / 100) }
                : {}),
            }
          : { name: 'Check', state: 'todo', detail: check.commands.join(' && ') };

  // Land: the target moves to the merge; pushed when the merger pushes (Hive's always do).
  const pushed = push || entry.by === 'hive';
  const land: MergeStep =
    state === 'landed'
      ? {
          name: 'Land',
          state: 'done',
          detail: [
            entry.merge ? `${entry.into} at ${short(entry.merge)}` : (entry.message ?? 'landed'),
            ...(entry.pushed
              ? [
                  entry.pushed.ok
                    ? `pushed to ${entry.pushed.remote}`
                    : `not pushed to ${entry.pushed.remote}`,
                ]
              : []),
          ].join(' · '),
        }
      : {
          name: 'Land',
          state: 'todo',
          detail: `${entry.into} fast-forwards${pushed ? ', then push' : ''}`,
        };
  const landWords =
    state === 'landed'
      ? land.detail
      : entry.merge
        ? `${entry.into} to ${short(entry.merge)}${pushed ? ', then pushed' : ''}`
        : land.detail;

  const queueCell = live
    ? {
        value: place > 0 ? String(place) : '—',
        of: place > 0 ? `of ${waiting.length}` : '',
        words: behind === 0 ? 'nothing behind it' : `${plural(behind, 'merge')} behind it`,
      }
    : { value: '—', of: '', words: entry.landed ? `landed at ${hm(entry.landed)}` : 'landed' };
  const from = okAt ?? entry.queued;
  const timeCell = live
    ? { value: clockWords(now - Date.parse(from)), words: okAt ? 'since your OK' : 'since queued' }
    : {
        value: clockWords(Date.parse(entry.landed ?? entry.updated) - Date.parse(from)),
        words: okAt ? 'from your OK to landed' : 'from queued to landed',
      };

  return {
    title: mergeName(entry, title),
    pill,
    line,
    steps: [approved, mergeStep, checkStep, land],
    queue: queueCell,
    time: timeCell,
    commands,
    landWords,
    ...(checkTime ? { checkTime } : {}),
    approval: {
      words:
        entry.by === 'hive'
          ? "Hive's running reviewer"
          : verdict?.number
            ? `your review, ${ordinal(verdict.number)}`
            : 'your review',
      at: hm(okAt ?? entry.queued),
      ...(verdict?.summary ? { quote: verdict.summary } : {}),
    },
  };
}
