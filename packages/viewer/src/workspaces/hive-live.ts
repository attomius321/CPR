// What Hive runs now on a workspace, in words (decisions 697–699): its check — the command
// running, its place among several, the time since the check started against the last passing
// check of the same commands — or its running review — its time and what the reviewer runs now.
// The times are worked out from the recorded starts at each tick of the page's clock. Pure.
import type { HiveLive, WorkspaceHive } from '@symbiote/core';

/** A running time on a clock: "0:42", "4:12", "1:02:03". */
export function clockWords(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${s}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${s}`;
}

/** An expected time, rounded: "~40 s", "~7 min", "~1 h 5 min". */
export function aboutWords(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `~${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `~${minutes} min`;
  const rest = minutes % 60;
  return `~${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`;
}

/** Since `iso`, at `now`; nothing before it. */
const since = (iso: string, now: number) => Math.max(0, now - Date.parse(iso));

/** A running time, and the expected one after it when there is one: "4:12 of ~7 min". */
export const timeWords = (ms: number, expected?: number) =>
  expected === undefined ? clockWords(ms) : `${clockWords(ms)} of ${aboutWords(expected)}`;

/** What Hive runs now, in the parts a card draws and in one line for a head or a tip. */
export interface LiveWords {
  /** "Checking 4/4", "Checking", "Reviewing". */
  head: string;
  /** "4:12 of ~7 min", "1:05". */
  time: string;
  /** The command running, or what the reviewer runs now; "no check found". */
  detail?: string;
  /** All of it: "Checking 4/4: pnpm test:e2e · 4:12 of ~7 min". */
  line: string;
}

/** Hive reviews without a check: its note says none was set or found (decision 674). */
const noCheck = (note: string | undefined) => note?.startsWith('no check') === true;

/** What a running review does now, from its log: the reviewer's call, an install or a rerun. */
function reviewDoing(live: Extract<HiveLive, { kind: 'review' }>): string | undefined {
  if (live.phase === 'install' && live.title) return `Installing: ${live.title}`;
  if (live.phase === 'rerun' && live.title) return `Rerunning ${live.title}`;
  if (live.phase === 'review') return live.doing ?? 'The reviewer reads the change';
  return undefined;
}

/** What Hive runs now on a workspace, at `now`; null when nothing runs. */
export function liveWords(
  hive: Pick<WorkspaceHive, 'live' | 'note'>,
  now: number,
): LiveWords | null {
  const live = hive.live;
  if (!live) return null;
  if (live.kind === 'check') {
    const command = live.commands[live.step] ?? '';
    const head =
      live.commands.length > 1 ? `Checking ${live.step + 1}/${live.commands.length}` : 'Checking';
    const time = timeWords(since(live.started, now), live.expected?.ms);
    return { head, time, detail: command, line: `${head}: ${command} · ${time}` };
  }
  const time = clockWords(since(live.started, now));
  const detail = [noCheck(hive.note) ? 'no check found' : undefined, reviewDoing(live)]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
  return {
    head: 'Reviewing',
    time,
    ...(detail ? { detail } : {}),
    line: `Reviewing · ${time}${detail ? ` · ${detail}` : ''}`,
  };
}

/** A check's command in the Review tab's steps: done, running or waiting, with its time. */
export interface CheckStepWords {
  command: string;
  mark: 'passed' | 'failed' | 'running' | 'waiting';
  /** "✓ 1:10", "2:03 of ~3 min", "~2 min" (waiting, its last time known), "" otherwise. */
  time: string;
}

/** A running check's commands at `now`, each done, running or waiting. */
export function checkSteps(
  live: Extract<HiveLive, { kind: 'check' }>,
  now: number,
): CheckStepWords[] {
  return live.commands.map((command, i) => {
    const expected = live.expected?.steps[i];
    const done = live.done[i];
    if (done) return { command, mark: done.ok ? 'passed' : 'failed', time: clockWords(done.ms) };
    if (i === live.step) {
      return { command, mark: 'running', time: timeWords(since(live.since, now), expected) };
    }
    return { command, mark: 'waiting', time: expected === undefined ? '' : aboutWords(expected) };
  });
}
