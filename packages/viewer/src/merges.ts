// Symbiote's merger on the page (V26a): what a queued merge's row says and offers. Pure.
import type { MergeCheckRun, MergeEntry, MergeRegion } from '@symbiote/core';

/** How a row is marked: waiting, the person's turn, done, or something went wrong. */
export type MergeTone = 'wait' | 'you' | 'done' | 'bad';

const short = (sha: string) => sha.slice(0, 7);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Tokens, short: `950`, `3.1K`. */
const tokens = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}K`);

/** A check's time: `4.2 s`, `1 min 21 s`. */
export function duration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** `a`, `a and b`, `a, b and c`. */
const listed = (words: readonly string[]) =>
  words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;

/** `its check failed (pnpm check)` for a check that failed; null otherwise. */
function checkFailed(check: MergeCheckRun | undefined): string | null {
  if (check?.ok !== false) return null;
  return `its check failed${check.failed ? ` (${check.failed})` : ''}`;
}

/**
 * A failed check, command by command (fix/fix-merger): those before the one that failed passed,
 * those after it did not run. Null unless it failed and says which command did.
 */
export function failedCheck(check: MergeCheckRun): string | null {
  if (check.ok !== false || !check.failed) return null;
  const at = check.commands.indexOf(check.failed);
  const passed = at < 0 ? [] : check.commands.slice(0, at);
  const skipped = at < 0 ? [] : check.commands.slice(at + 1);
  return [
    passed.length > 0 ? `${listed(passed)} passed` : null,
    `${check.failed} failed${check.ms === undefined ? '' : ` after ${duration(check.ms)}`}`,
    skipped.length > 0 ? `${listed(skipped)} did not run` : null,
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * Where a merge is, in a line, and its tone. A resolution's failed check is said, not taken for
 * a wrong resolution: the person reads what failed and decides (fix/fix-merger).
 */
export function mergeState(entry: MergeEntry): { text: string; tone: MergeTone } {
  const { check } = entry;
  const failed = checkFailed(check);
  const took = failed ?? (check?.ms === undefined ? null : `checked in ${duration(check.ms)}`);
  switch (entry.state) {
    case 'queued':
      return {
        text: `Queued: ${short(entry.head)} into ${entry.into}${entry.message ? ` (${entry.message})` : ''}`,
        tone: 'wait',
      };
    case 'merging':
      return { text: `Merging into ${entry.into}`, tone: 'wait' };
    case 'resolving':
      return {
        text: `Resolving ${plural(entry.conflicts?.length ?? 0, 'conflicting file')}: the merger agent answers each region`,
        tone: 'wait',
      };
    case 'checking':
      return { text: `Checking: ${check?.commands.join(' && ') ?? ''}`, tone: 'wait' };
    case 'ready':
      return check?.ok
        ? {
            text: `Checked in ${duration(check.ms ?? 0)}: ready to land${entry.message ? ` · ${entry.message}` : ''}`,
            tone: 'you',
          }
        : failed
          ? {
              text: `Approved, ${failed}: ready to land${entry.message ? ` · ${entry.message}` : ''}`,
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
    case 'needs-you': {
      const regions = entry.resolution?.regions ?? [];
      if (regions.length > 0 && entry.merge) {
        const usage = entry.resolution?.usage;
        const by = [
          entry.resolution?.model ?? entry.resolution?.agent,
          usage ? `${tokens(usage.input + usage.output)} tokens` : null,
        ]
          .filter(Boolean)
          .join(', ');
        const checked = failed
          ? ` · ${failed}: review it`
          : check?.ok
            ? ` · checked in ${duration(check.ms ?? 0)}: review it`
            : ': review it';
        return {
          text: `Resolved ${plural(regions.length, 'region')} (${by})${checked}`,
          tone: 'you',
        };
      }
      if (entry.resolution?.needsYou && entry.message) {
        return {
          text: `${entry.message.charAt(0).toUpperCase()}${entry.message.slice(1)}`,
          tone: 'bad',
        };
      }
      return entry.conflicts
        ? {
            text: `Conflicts with ${entry.into} in ${plural(entry.conflicts.length, 'file')}`,
            tone: 'bad',
          }
        : { text: entry.message ?? 'Needs you', tone: 'bad' };
    }
    case 'failed':
      return check?.ok === false
        ? { text: `The check failed: ${check.failed ?? ''}`, tone: 'bad' }
        : { text: `Failed: ${entry.message ?? ''}`, tone: 'bad' };
  }
}

/** Where a merge is, in a word or two: the label beside its branches. */
export function mergeLabel(entry: MergeEntry): string {
  switch (entry.state) {
    case 'queued':
      return 'Queued';
    case 'merging':
      return 'Merging';
    case 'resolving':
      return 'Resolving';
    case 'checking':
      return 'Checking';
    case 'needs-you':
      return toReview(entry) ? 'Review resolution' : 'Needs you';
    case 'ready':
      return 'Ready to land';
    case 'landed':
      return 'Landed';
    case 'failed':
      return 'Failed';
  }
}

export type MergeAction = 'land' | 'approve' | 'change' | 'retry' | 'remove';

/** Whether a merge waits for the person's review of the merger agent's resolution (V26c). */
export const toReview = (entry: MergeEntry) =>
  entry.state === 'needs-you' &&
  Boolean(entry.merge) &&
  (entry.resolution?.regions.length ?? 0) > 0;

/**
 * What a row offers: Land when ready; Approve and Request changes on a resolution, its check
 * passed or failed; Retry when it stopped; Remove unless it runs.
 */
export function mergeActions(entry: MergeEntry): MergeAction[] {
  if (['merging', 'resolving', 'checking'].includes(entry.state)) return [];
  return [
    ...(toReview(entry) ? (['approve', 'change'] as const) : []),
    ...(entry.state === 'ready' ? (['land'] as const) : []),
    ...(entry.state === 'failed' || entry.state === 'needs-you' ? (['retry'] as const) : []),
    'remove',
  ];
}

/** Whether the queue is to be read again soon: something in it runs or waits its turn. */
export function mergeLive(merges: readonly MergeEntry[]): boolean {
  return merges.some((e) => ['queued', 'merging', 'resolving', 'checking'].includes(e.state));
}

/**
 * Where a line of a resolution came from: the target's side (`ours`), the branch's (`theirs`),
 * both alike, the ancestor only, or neither (`new`: the merger agent wrote it).
 */
export type LineFrom = 'ours' | 'theirs' | 'both' | 'base' | 'new' | 'blank';

export interface ReviewLine {
  text: string;
  from: LineFrom;
  /** The resolution has this line more times than any side does. */
  twice?: true;
}

/** A side's own lines (those the ancestor lacks), and how many the resolution kept. */
export interface SideKept {
  kept: number;
  of: number;
}

/** A region's resolution read against its sides, for the reviewer's question: what was lost? */
export interface RegionReview {
  lines: ReviewLine[];
  kept: { ours: SideKept; theirs: SideKept };
  /** Each side's own lines the resolution does not have. */
  dropped: { ours: string[]; theirs: string[] };
  /** Lines kept more times than a side has them. */
  twice: number;
  /** Lines in no side and not in the ancestor. */
  written: number;
}

/** Lines compare without their indentation; blank ones are not counted. */
const norm = (line: string) => line.trim();

function counts(lines: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    const key = norm(line);
    if (key !== '') map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/** A side's lines the ancestor does not have, each ancestor line taken away once. */
function own(side: readonly string[], base: readonly string[]): string[] {
  const left = counts(base);
  return side.filter((line) => {
    const key = norm(line);
    if (key === '') return false;
    const n = left.get(key) ?? 0;
    if (n === 0) return true;
    left.set(key, n - 1);
    return false;
  });
}

/** A side's own lines the resolution has, each resolution line used once per side. */
function keptOf(lines: readonly string[], resolved: Map<string, number>) {
  const left = new Map(resolved);
  const dropped: string[] = [];
  for (const line of lines) {
    const key = norm(line);
    const n = left.get(key) ?? 0;
    if (n > 0) left.set(key, n - 1);
    else dropped.push(line);
  }
  return { kept: { kept: lines.length - dropped.length, of: lines.length }, dropped };
}

/**
 * Reads a region's resolution against its sides: each line marked by where it came from, each
 * side's own lines kept or dropped, lines kept twice and lines the agent wrote. Pure.
 */
export function reviewRegion(region: MergeRegion): RegionReview {
  const text = region.text.split('\n');
  const base = region.base ?? [];
  const ours = counts(region.ours);
  const theirs = counts(region.theirs);
  const before = counts(base);
  const resolved = counts(text);
  const allowed = (key: string) =>
    Math.max(ours.get(key) ?? 0, theirs.get(key) ?? 0) || (before.get(key) ?? 0);
  const lines: ReviewLine[] = text.map((line) => {
    const key = norm(line);
    if (key === '') return { text: line, from: 'blank' };
    const o = ours.get(key) ?? 0;
    const t = theirs.get(key) ?? 0;
    const b = before.get(key) ?? 0;
    const from: LineFrom =
      o > 0 && t > 0 ? 'both' : o > 0 ? 'ours' : t > 0 ? 'theirs' : b > 0 ? 'base' : 'new';
    return allowed(key) > 0 && (resolved.get(key) ?? 0) > allowed(key)
      ? { text: line, from, twice: true }
      : { text: line, from };
  });
  let twice = 0;
  for (const [key, n] of resolved) {
    if (allowed(key) > 0 && n > allowed(key)) twice += n - allowed(key);
  }
  const o = keptOf(own(region.ours, base), resolved);
  const t = keptOf(own(region.theirs, base), resolved);
  return {
    lines,
    kept: { ours: o.kept, theirs: t.kept },
    dropped: { ours: o.dropped, theirs: t.dropped },
    twice,
    written: lines.filter((line) => line.from === 'new').length,
  };
}

export interface RegionFlag {
  tone: 'ok' | 'bad' | 'new';
  text: string;
}

/** What a region's review says in words: what was dropped or kept twice, what was written. */
export function regionFlags(review: RegionReview, into: string, branch: string): RegionFlag[] {
  const drops = (side: SideKept, name: string): RegionFlag[] => {
    const n = side.of - side.kept;
    if (n === 0) return [];
    return [
      {
        tone: 'bad',
        text:
          n === side.of
            ? `Drops ${n === 1 ? 'the line' : `all ${n} lines`} from ${name}`
            : `Drops ${n} of ${side.of} lines from ${name}`,
      },
    ];
  };
  const flags: RegionFlag[] = [
    ...drops(review.kept.ours, into),
    ...drops(review.kept.theirs, branch),
    ...(review.twice > 0
      ? [{ tone: 'bad' as const, text: `${plural(review.twice, 'line')} kept twice` }]
      : []),
    ...(review.written > 0
      ? [{ tone: 'new' as const, text: `${plural(review.written, 'line')} written by the agent` }]
      : []),
  ];
  return flags.length > 0
    ? flags
    : [{ tone: 'ok', text: 'Keeps every line of both sides, nothing new' }];
}
