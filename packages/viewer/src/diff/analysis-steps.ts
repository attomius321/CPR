// An analysis's steps on its page (V71, decision 504; a timeline since V90, decision 846): the
// pipeline's phases in their order (`AnalysisPhase`, core's pipeline.ts), each done, running or to
// come, failed or stopped where it ended, with its time as the page saw the phases change.

export type StepMark = 'done' | 'running' | 'next' | 'failed' | 'stopped';

export interface AnalysisStep {
  key: string;
  name: string;
  /** What the step does, in a few words. */
  detail: string;
  mark: StepMark;
  /** How long it took, or runs so far; absent when the page did not see it start. */
  ms?: number;
}

/** When the page first saw each phase (its own clock, ms), by phase key. */
export type Seen = Readonly<Record<string, number>>;

const short = (sha: string) => sha.slice(0, 7);

const PHASES: [phase: string, name: string, detail: (base: string, head: string) => string][] = [
  ['checkout', 'Check out both sides', (b, h) => `${b} and ${h}, each in a worktree`],
  ['loadBase', 'Load the base', (b) => `the TypeScript program at ${b}`],
  ['loadHead', 'Load the head', (_, h) => `the same at ${h}`],
  ['extract', 'Extract symbols', () => 'functions, classes, methods and types on both sides'],
  ['references', 'Find references', () => 'who calls what changed, and what it calls'],
  [
    'findings',
    'Look for findings',
    () => 'removed but still used, new but unused, changed signatures and APIs',
  ],
];

/** The phase's index, or -1 for one this page does not know. */
const indexOf = (phase: string | null) =>
  phase === null ? 0 : PHASES.findIndex(([key]) => key === phase);

/**
 * `seen` with `phase` noted at `at` if it is new: the first step before any phase is reported
 * (`null`), nothing while `queued` analyses come first or for a phase the page does not know.
 */
export function seePhase(seen: Seen, phase: string | null, at: number, queued = 0): Seen {
  if (queued > 0) return seen;
  const key = PHASES[indexOf(phase)]?.[0];
  if (key === undefined || key in seen) return seen;
  return { ...seen, [key]: at };
}

interface Options {
  /** When each phase was first seen; without it, no step has a time. */
  seen?: Seen;
  /** The page's clock now: the running step's time is counted to it. */
  now?: number;
  /** The commits compared, named in the steps' details. */
  pair?: { base: string; head: string };
}

/**
 * The time of step `i` by `seen`: from when it was seen to when the first later step was, else
 * (`running`) to `now`. A step never seen has none; the step before it holds its time.
 */
function timeOf(i: number, seen: Seen, end: number | undefined): number | undefined {
  const start = seen[PHASES[i]?.[0] ?? ''];
  if (start === undefined) return undefined;
  const next = PHASES.slice(i + 1)
    .map(([key]) => seen[key])
    .find((at) => at !== undefined);
  const stop = next ?? end;
  return stop === undefined ? undefined : Math.max(0, stop - start);
}

function step(i: number, mark: StepMark, pair: Options['pair'], ms: number | undefined) {
  const [key, name, detail] = PHASES[i] ?? ['', '', () => ''];
  return {
    key,
    name,
    detail: detail(short(pair?.base ?? ''), short(pair?.head ?? '')),
    mark,
    ...(ms === undefined ? {} : { ms }),
  };
}

/**
 * The steps for `phase` (null before the first is reported) with `queued` analyses before it.
 * Steps before the phase are done: the page asks every 500 ms, so a short one is never seen. A
 * phase it does not know claims no progress: as before the first.
 */
export function analysisSteps(
  phase: string | null,
  queued: number,
  { seen = {}, now, pair }: Options = {},
): AnalysisStep[] {
  if (queued > 0) {
    const waiting = `Waiting for ${queued} other analys${queued === 1 ? 'is' : 'es'}`;
    return [
      { key: 'queue', name: waiting, detail: 'one analysis runs at a time', mark: 'running' },
      ...PHASES.map((_, i) => step(i, 'next', pair, undefined)),
    ];
  }
  const at = Math.max(0, indexOf(phase));
  return PHASES.map((_, i) =>
    step(
      i,
      i < at ? 'done' : i === at ? 'running' : 'next',
      pair,
      i <= at ? timeOf(i, seen, i === at ? now : undefined) : undefined,
    ),
  );
}

/**
 * The steps of an analysis that ended (`failed` or `stopped`) at the last phase the page saw;
 * none when it saw none (opened after the end). The step it ended at has no time: when it ended
 * is not known.
 */
export function endedSteps(seen: Seen, end: 'failed' | 'stopped', pair?: Options['pair']) {
  let last = -1;
  PHASES.forEach(([key], i) => {
    if (key in seen) last = i;
  });
  if (last < 0) return [];
  return PHASES.map((_, i) =>
    step(
      i,
      i < last ? 'done' : i === last ? end : 'next',
      pair,
      i < last ? timeOf(i, seen, undefined) : undefined,
    ),
  );
}

/** A step's time: "0.4 s", "4.8 s", "13 s", from a minute "1:15". */
export function stepTime(ms: number): string {
  if (ms >= 60_000) return clockTime(ms);
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

/** A running clock: "0:09", "62:05". */
export function clockTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
