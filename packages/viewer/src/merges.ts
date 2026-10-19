// CPR's merger on the page (V26a): what a queued merge's row says and offers. Pure.
import type { MergeEntry } from '@cpr/core';

/** How a row is marked: waiting, the person's turn, done, or something went wrong. */
export type MergeTone = 'wait' | 'you' | 'done' | 'bad';

const short = (sha: string) => sha.slice(0, 7);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A check's time: `4.2 s`, `1 min 21 s`. */
export function duration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Where a merge is, in a line, and its tone. */
export function mergeState(entry: MergeEntry): { text: string; tone: MergeTone } {
  const { check } = entry;
  const took = check?.ms === undefined ? null : `checked in ${duration(check.ms)}`;
  switch (entry.state) {
    case 'queued':
      return {
        text: `Queued: ${short(entry.head)} into ${entry.into}${entry.message ? ` (${entry.message})` : ''}`,
        tone: 'wait',
      };
    case 'merging':
      return { text: `Merging into ${entry.into}`, tone: 'wait' };
    case 'checking':
      return { text: `Checking: ${check?.commands.join(' && ') ?? ''}`, tone: 'wait' };
    case 'ready':
      return check?.ok
        ? {
            text: `Checked in ${duration(check.ms ?? 0)}: ready to land${entry.message ? ` · ${entry.message}` : ''}`,
            tone: 'you',
          }
        : { text: `Merged, not checked: ${entry.message ?? 'Land when you have'}`, tone: 'you' };
    case 'landed': {
      const pushed = entry.pushed
        ? entry.pushed.ok
          ? `pushed to ${entry.pushed.remote}`
          : `not pushed to ${entry.pushed.remote}: ${entry.pushed.error}`
        : null;
      const at = entry.merge ? `${entry.into} is at ${short(entry.merge)}` : (entry.message ?? '');
      return { text: [`Landed: ${at}`, took, pushed].filter(Boolean).join(' · '), tone: 'done' };
    }
    case 'needs-you':
      return entry.conflicts
        ? {
            text: `Conflicts with ${entry.into} in ${plural(entry.conflicts.length, 'file')}`,
            tone: 'bad',
          }
        : { text: entry.message ?? 'Needs you', tone: 'bad' };
    case 'failed':
      return check?.ok === false
        ? { text: `The check failed: ${check.failed ?? ''}`, tone: 'bad' }
        : { text: `Failed: ${entry.message ?? ''}`, tone: 'bad' };
  }
}

export type MergeAction = 'land' | 'retry' | 'remove';

/** What a row offers: Land when ready, Retry when it stopped, Remove unless it runs. */
export function mergeActions(entry: MergeEntry): MergeAction[] {
  if (entry.state === 'merging' || entry.state === 'checking') return [];
  return [
    ...(entry.state === 'ready' ? (['land'] as const) : []),
    ...(entry.state === 'failed' || entry.state === 'needs-you' ? (['retry'] as const) : []),
    'remove',
  ];
}

/** Whether the queue is to be read again soon: something in it runs or waits its turn. */
export function mergeLive(merges: readonly MergeEntry[]): boolean {
  return merges.some((e) => ['queued', 'merging', 'checking'].includes(e.state));
}
