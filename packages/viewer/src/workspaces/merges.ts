// Symbiote's merger on the page (V26a): what a queued merge's row says and offers. Pure.
import type {
  MergeCheckRun,
  MergeConflict,
  MergeEntry,
  MergeRegion,
  MergeStrategy,
  MergeTargets,
} from '@symbiote/core';

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
  const fastForward = entry.strategy === 'fast-forward';
  switch (entry.state) {
    case 'queued':
      if (entry.recheck && entry.merge) {
        return { text: `Queued: its check runs again on ${short(entry.merge)}`, tone: 'wait' };
      }
      return {
        text: `Queued: ${short(entry.head)} into ${entry.into}${fastForward ? ', by fast-forward' : ''}${entry.message ? ` (${entry.message})` : ''}`,
        tone: 'wait',
      };
    case 'merging':
      return fastForward
        ? { text: `Fast-forwarding ${entry.into}`, tone: 'wait' }
        : { text: `Merging into ${entry.into}`, tone: 'wait' };
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
          : {
              // A fast-forward merged nothing (V67).
              text: `${fastForward ? 'Not checked' : 'Merged, not checked'}: ${entry.message ?? 'Land when you have'}`,
              tone: 'you',
            };
    case 'landed': {
      const pushed = entry.pushed
        ? entry.pushed.ok
          ? `pushed to ${entry.pushed.remote}`
          : `not pushed to ${entry.pushed.remote}: ${entry.pushed.error}`
        : null;
      const at = !entry.merge
        ? (entry.message ?? '')
        : fastForward
          ? `${entry.into} fast-forwarded to ${short(entry.merge)}`
          : `${entry.into} is at ${short(entry.merge)}`;
      return { text: [`Landed: ${at}`, took, pushed].filter(Boolean).join(' · '), tone: 'done' };
    }
    case 'needs-you': {
      // A fast-forward its target can no longer take (V67): the person picks what next.
      if (fastForward && entry.behind) {
        return {
          text: `Cannot fast-forward: ${entry.into} has ${plural(entry.behind, 'commit')} ${entry.branch} does not. ${OTHERWISE(entry.into)}`,
          tone: 'you',
        };
      }
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
      // The agent asked: the person's turn, to answer it (fix/merge-viewer-on-conflict).
      if (entry.resolution?.needsYou && entry.message) {
        return {
          text: `${entry.message.charAt(0).toUpperCase()}${entry.message.slice(1)}`,
          tone: 'you',
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

export type MergeAction =
  'land' | 'approve' | 'change' | 'recheck' | 'merge-commit' | 'retry' | 'remove';

/** What else can be done when `into` cannot fast-forward (V67, decision 486). */
const OTHERWISE = (into: string) =>
  `Merge with a merge commit, or bring ${into} into the branch and review it again`;

/** A merge commit's subject; a fast-forward makes none and says where the target moves (V67). */
export function mergeTitle(entry: MergeEntry): string {
  return entry.strategy === 'fast-forward'
    ? `No merge commit: ${entry.into} moves to ${short(entry.head)}, the approved commit`
    : entry.title;
}

/** Why Merge into ▾ cannot fast-forward `into` to the approved commit (V67); null when it can. */
export function fastForwardBlocked(
  targets: MergeTargets,
  branch: string,
  into: string,
): string | null {
  if (targets.fastForward?.includes(into)) return null;
  return `${into} has commits ${branch} does not: it cannot fast-forward. ${OTHERWISE(into)}.`;
}

/** What Merge into ▾'s button does, as its tip says it. */
export function mergeTip(targets: MergeTargets, into: string, strategy: MergeStrategy): string {
  const head = short(targets.head ?? '');
  return strategy === 'fast-forward'
    ? `Fast-forward ${into} to ${head}\nNo merge commit: ${into} moves to the approved commit itself, once its check passes in Symbiote's own worktree`
    : `Merge ${head} into ${into}\nThe approved commit, in Symbiote's own worktree: checked, then landed`;
}

/** Whether a merge waits for the person's review of the merger agent's resolution (V26c). */
export const toReview = (entry: MergeEntry) =>
  entry.state === 'needs-you' &&
  Boolean(entry.merge) &&
  (entry.resolution?.regions.length ?? 0) > 0;

/**
 * What a row offers: Land when ready; Approve and Request changes on a resolution, its check
 * passed or failed, and Check again when it failed; Merge commit instead on a fast-forward its
 * target can no longer take (V67); Retry when it stopped; Remove unless it runs.
 */
export function mergeActions(entry: MergeEntry): MergeAction[] {
  if (['merging', 'resolving', 'checking'].includes(entry.state)) return [];
  const cannot = entry.state === 'needs-you' && entry.strategy === 'fast-forward' && entry.behind;
  return [
    ...(cannot ? (['merge-commit'] as const) : []),
    ...(toReview(entry) ? (['approve', 'change'] as const) : []),
    ...(toReview(entry) && entry.check?.ok === false ? (['recheck'] as const) : []),
    ...(entry.state === 'ready' ? (['land'] as const) : []),
    ...(entry.state === 'failed' || entry.state === 'needs-you' ? (['retry'] as const) : []),
    'remove',
  ];
}

/**
 * Where a merge's head draws its actions (V55): the frequent ones as buttons, Retry and Remove
 * under "⋯"; a landed merge's Remove, all it has left, as a button.
 */
export function mergeButtons(entry: MergeEntry): { buttons: MergeAction[]; more: MergeAction[] } {
  const actions = mergeActions(entry);
  if (entry.state === 'landed') return { buttons: actions, more: [] };
  const rare = (action: MergeAction) => action === 'retry' || action === 'remove';
  return { buttons: actions.filter((a) => !rare(a)), more: actions.filter(rare) };
}

/** Whether a merge's card offers Remove (V55): once it landed; any other from its own page. */
export const removableOnCard = (entry: MergeEntry): boolean => entry.state === 'landed';

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
  /** A copy of a side's line past the ones that side has, read in order. */
  twice?: true;
  /** A line the agent wrote that is also just above or below the region, which stay in the file. */
  repeats?: 'above' | 'below';
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
  /** Each side's own lines the resolution has neither as they were nor in lines the agent wrote. */
  dropped: { ours: string[]; theirs: string[] };
  /**
   * Each side's own lines not kept as they were whose change (their words and symbols the
   * ancestor lacks) is in lines the agent wrote, in order: wrapped again, or merged with the other
   * side's (fix/merge-viewer-on-conflict).
   */
  rewritten: { ours: string[]; theirs: string[] };
  /** Copies of a side's lines past the ones it has. */
  twice: number;
  /** Lines in no side and not in the ancestor, but for those that repeat a line around it. */
  written: number;
  /** Lines the agent wrote that are also just above or below the region: twice in the file. */
  repeats: { text: string; where: 'above' | 'below' }[];
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

/** Past this many cells, lines are paired in order greedily instead of by a table. */
const PAIR_CELLS = 4_000_000;

/**
 * Which of `a`'s lines and of `b`'s are paired with an equal line of the other (blank ones never):
 * in order first, a longest common subsequence with each pair as early in `a` as it can be, then,
 * with `moved`, the rest by text. Read in order, the `});` that closes a block of one side is
 * that block's, not a copy of the other side's (fix/merge-viewer-on-conflict).
 */
function pair(
  a: readonly string[],
  b: readonly string[],
  moved = true,
): { inA: boolean[]; inB: boolean[] } {
  const inA = a.map(() => false);
  const inB = b.map(() => false);
  const x = a.flatMap((key, i) => (key === '' ? [] : [i]));
  const y = b.flatMap((key, j) => (key === '' ? [] : [j]));
  const same = (i: number, j: number) => a[x[i]!] === b[y[j]!];
  const join = (i: number, j: number) => {
    inA[x[i]!] = true;
    inB[y[j]!] = true;
  };
  // An equal start pairs as it is.
  let start = 0;
  while (start < x.length && start < y.length && same(start, start)) join(start, start++);
  const n = x.length - start;
  const m = y.length - start;
  if (n > 0 && m > 0 && (n + 1) * (m + 1) <= PAIR_CELLS) {
    // The longest common subsequence of what follows from each pair of lines on.
    const w = m + 1;
    const table = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * w + j] = same(start + i, start + j)
          ? table[(i + 1) * w + j + 1]! + 1
          : Math.max(table[(i + 1) * w + j]!, table[i * w + j + 1]!);
      }
    }
    for (let i = 0, j = 0; i < n && j < m;) {
      if (same(start + i, start + j)) join(start + i++, start + j++);
      else if (table[i * w + j + 1]! >= table[(i + 1) * w + j]!) j++;
      else i++;
    }
  } else if (n > 0 && m > 0) {
    let i = start;
    for (let j = start; j < y.length; j++) {
      let k = i;
      while (k < x.length && !same(k, j)) k++;
      if (k < x.length) {
        join(k, j);
        i = k + 1;
      }
    }
  }
  if (!moved) return { inA, inB };
  // Lines moved: the rest paired by text, each with the first left.
  const left = new Map<string, number[]>();
  for (const i of x) {
    if (!inA[i]) left.set(a[i]!, [...(left.get(a[i]!) ?? []), i]);
  }
  for (const j of y) {
    const i = inB[j] ? undefined : left.get(b[j]!)?.shift();
    if (i === undefined) continue;
    inA[i] = true;
    inB[j] = true;
  }
  return { inA, inB };
}

/** Files of prose: their lines are read for their words only, as a comment's are. */
const PROSE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
const COMMENT = /^(\/\/|\/\*|\*|<!--)/;
const WORD = /[\p{L}\p{N}_]/u;

/** A line's words and, unless `words`, its symbols each on its own: what a rewrite must keep. */
const tokensOf = (line: string, words: boolean) => {
  const tokens = line.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
  return words ? tokens.filter((token) => WORD.test(token)) : tokens;
};

/**
 * What a side changed in each of its lines: its tokens not paired in order with the ancestor's.
 * A line of tokens the ancestor all has (moved, or with some taken out) is its tokens.
 */
function changesOf(side: readonly string[], base: readonly string[], words: boolean): string[][] {
  const lines = side.map((line) => tokensOf(line, words));
  const { inA } = pair(
    lines.flat(),
    base.flatMap((line) => tokensOf(line, words)),
    false,
  );
  let k = 0;
  return lines.map((tokens) => {
    const changed = tokens.filter(() => !inA[k++]);
    return changed.length > 0 ? changed : tokens;
  });
}

/** A rewrite keeps a line's tokens within twice as many, and a few the other side added. */
const reach = (tokens: number) => 2 * tokens + 8;

/** Past this much reading, a side's lines not kept as they were are all taken as dropped. */
const REWRITE_WORK = 2_000_000;

/** A resolution's tokens, and whether each is in a line the agent wrote. */
interface Stream {
  tokens: string[];
  wrote: boolean[];
}

/**
 * Where `tokens` end in `stream`, found in order from `from` within `span` of their first and in a
 * line the agent wrote at least in part: the index after the last, or -1.
 */
function foundIn(stream: Stream, tokens: readonly string[], from: number, span: number): number {
  const [first] = tokens;
  if (first === undefined) return -1;
  const all = stream.tokens;
  for (let s = from; s < all.length; s++) {
    if (all[s] !== first) continue;
    let k = 1;
    let end = s + 1;
    let wrote = stream.wrote[s] === true;
    for (let i = s + 1; i < all.length && k < tokens.length && i - s < span; i++) {
      if (all[i] === tokens[k]) {
        k++;
        end = i + 1;
        wrote ||= stream.wrote[i] === true;
      }
    }
    if (k === tokens.length && wrote) return end;
  }
  return -1;
}

/**
 * Reads a region's resolution against its sides: each line marked by where it came from, read in
 * order; each side's own lines kept, rewritten into lines the agent wrote (what the side changed
 * kept, in order: in code, its symbols too) or dropped; copies past a side's own; lines the agent
 * wrote, and those of them that repeat a line just around the region
 * (fix/merge-viewer-on-conflict). Pure.
 */
export function reviewRegion(region: MergeRegion): RegionReview {
  const text = region.text.split('\n');
  const base = region.base ?? [];
  const keys = text.map(norm);
  const ours = pair(keys, region.ours.map(norm));
  const theirs = pair(keys, region.theirs.map(norm));
  const has = { ours: counts(region.ours), theirs: counts(region.theirs) };
  // The ancestor's lines kept that no side pairs: at most as many as it has.
  const before = counts(base);
  const above = new Set((region.around?.before ?? []).map(norm));
  const below = new Set((region.around?.after ?? []).map(norm));
  const lines: ReviewLine[] = text.map((line, i): ReviewLine => {
    const key = keys[i]!;
    if (key === '') return { text: line, from: 'blank' };
    const o = ours.inA[i];
    const t = theirs.inA[i];
    if (o || t) return { text: line, from: o && t ? 'both' : o ? 'ours' : 'theirs' };
    const b = before.get(key) ?? 0;
    if (b > 0) {
      before.set(key, b - 1);
      return { text: line, from: 'base' };
    }
    const inO = has.ours.has(key);
    const inT = has.theirs.has(key);
    if (inO || inT)
      return { text: line, from: inO && inT ? 'both' : inO ? 'ours' : 'theirs', twice: true };
    if (above.has(key)) return { text: line, from: 'new', repeats: 'above' };
    if (below.has(key)) return { text: line, from: 'new', repeats: 'below' };
    return { text: line, from: 'new' };
  });
  // The resolution as tokens, words only and words with symbols, but for lines repeated from
  // around it: a side's line rewritten may run over a line the other side kept as it was.
  const prose = PROSE.test(region.path);
  const wrote = text.filter((_, i) => lines[i]!.from === 'new' && !lines[i]!.repeats);
  const streamOf = (words: boolean): Stream => {
    const stream: Stream = { tokens: [], wrote: [] };
    text.forEach((line, i) => {
      if (lines[i]!.repeats) return;
      for (const token of tokensOf(line, words)) {
        stream.tokens.push(token);
        stream.wrote.push(lines[i]!.from === 'new');
      }
    });
    return stream;
  };
  const streams = wrote.length > 0 ? { words: streamOf(true), all: streamOf(false) } : null;
  const baseKeys = base.map(norm);
  const read = (side: readonly string[], paired: readonly boolean[]) => {
    const inBase = pair(side.map(norm), baseKeys).inA;
    const own = side.filter((line, j) => norm(line) !== '' && !inBase[j]);
    const missed = side.flatMap((line, j) =>
      norm(line) !== '' && !inBase[j] && !paired[j] ? [j] : [],
    );
    const affordable = streams && missed.length * streams.all.tokens.length <= REWRITE_WORK;
    const dropped: string[] = [];
    const rewritten: string[] = [];
    // What the side changed, each line's, read only when a line is to be looked for.
    const changes = { words: null as string[][] | null, all: null as string[][] | null };
    // Each side's lines are looked for in order, from where its last one was found.
    const at = { words: 0, all: 0 };
    for (const j of missed) {
      const line = side[j]!;
      const mode = prose || COMMENT.test(norm(line)) ? 'words' : 'all';
      const words = mode === 'words';
      const tokens = affordable ? (changes[mode] ??= changesOf(side, base, words))[j]! : [];
      const span = reach(tokensOf(line, words).length);
      let end = affordable ? foundIn(streams[mode], tokens, at[mode], span) : -1;
      if (affordable && end < 0 && at[mode] > 0) end = foundIn(streams[mode], tokens, 0, span);
      if (end < 0) {
        dropped.push(line);
      } else {
        rewritten.push(line);
        at[mode] = end;
      }
    }
    return { kept: { kept: own.length - dropped.length, of: own.length }, dropped, rewritten };
  };
  const o = read(region.ours, ours.inB);
  const t = read(region.theirs, theirs.inB);
  return {
    lines,
    kept: { ours: o.kept, theirs: t.kept },
    dropped: { ours: o.dropped, theirs: t.dropped },
    rewritten: { ours: o.rewritten, theirs: t.rewritten },
    twice: lines.filter((line) => line.twice).length,
    written: wrote.length,
    repeats: lines.flatMap((line) =>
      line.repeats ? [{ text: line.text, where: line.repeats }] : [],
    ),
  };
}

export interface RegionFlag {
  tone: 'ok' | 'bad' | 'new';
  text: string;
}

/** A line quoted in a flag: at most 40 characters. */
const quoted = (line: string) => {
  const text = line.trim();
  return `“${text.length > 40 ? `${text.slice(0, 39)}…` : text}”`;
};

/**
 * What a region's review says in words: in red what was dropped, kept twice or repeated from
 * just around it; in amber what the agent wrote, and whether it keeps the changes of the lines
 * it replaces (fix/merge-viewer-on-conflict).
 */
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
  const { repeats, written } = review;
  const where = [...new Set(repeats.map((r) => r.where))].join(' and ');
  const rewritten = review.rewritten.ours.length + review.rewritten.theirs.length;
  const replaced =
    rewritten === 0
      ? ''
      : `, with the changes of ${rewritten === 1 ? 'the line' : `the ${rewritten}`} ${written === 1 ? 'it replaces' : 'they replace'}`;
  const flags: RegionFlag[] = [
    ...drops(review.kept.ours, into),
    ...drops(review.kept.theirs, branch),
    ...(review.twice > 0
      ? [{ tone: 'bad' as const, text: `${plural(review.twice, 'line')} kept twice` }]
      : []),
    ...(repeats.length > 0
      ? [
          {
            tone: 'bad' as const,
            text: `Repeats ${repeats.length === 1 ? quoted(repeats[0]!.text) : `${repeats.length} lines`} from just ${where} it`,
          },
        ]
      : []),
    ...(written > 0
      ? [
          {
            tone: 'new' as const,
            text: `${plural(written, 'line')} written by the agent${replaced}`,
          },
        ]
      : []),
  ];
  return flags.length > 0
    ? flags
    : [{ tone: 'ok', text: 'Keeps every line of both sides, nothing new' }];
}

/** A conflicting file of a merge and what its resolution did (V46c). */
export interface ResolutionFile {
  path: string;
  /** Its regions in the resolution, in order; none when nobody resolved it. */
  regions: MergeRegion[];
  /** Its regions the merger agent asked the person about, in order (fix/merge-viewer-on-conflict). */
  asked: MergeConflict[];
  /** Its regions' flags put together: what it lost, kept twice, repeated or had written. */
  flags: RegionFlag[];
  /**
   * `bad` when it loses, doubles or repeats lines; `new` when the agent wrote some; `asked` when
   * the agent asks the person about it; `none` unresolved.
   */
  tone: RegionFlag['tone'] | 'asked' | 'none';
  /** Why it has no resolution. */
  why?: string;
}

const UNRESOLVABLE = {
  deleted: 'Deleted on one side',
  submodule: 'A submodule',
  binary: 'Binary',
} as const;

/**
 * A merge's conflicting files (decision 317), each once in git's order: its regions and what
 * they did together, read as `regionFlags` reads one — or, unresolved, why.
 */
export function resolutionFiles(entry: MergeEntry): ResolutionFile[] {
  const regions = entry.resolution?.regions ?? [];
  const asked = entry.resolution?.needsYou ? (entry.resolution.asked ?? []) : [];
  const paths = [
    ...new Set([
      ...(entry.conflicts ?? []),
      ...regions.map((r) => r.path),
      ...asked.map((r) => r.path),
    ]),
  ];
  return paths.map((path) => {
    const own = regions.filter((r) => r.path === path);
    if (own.length === 0) {
      const kind = entry.unresolvable?.find((u) => u.path === path)?.kind;
      const its = asked.filter((r) => r.path === path);
      return {
        path,
        regions: [],
        asked: its,
        flags: [],
        tone: its.length > 0 ? 'asked' : 'none',
        why: kind
          ? `${UNRESOLVABLE[kind]}: not given to the merger agent`
          : mergeLive([entry])
            ? 'Resolving…'
            : its.length > 0
              ? 'Waiting for your answer'
              : 'Not resolved',
      };
    }
    const reviews = own.map(reviewRegion);
    const sum = (side: 'ours' | 'theirs') =>
      reviews.reduce(
        (all, r) => ({ kept: all.kept + r.kept[side].kept, of: all.of + r.kept[side].of }),
        { kept: 0, of: 0 },
      );
    const together: RegionReview = {
      lines: reviews.flatMap((r) => r.lines),
      kept: { ours: sum('ours'), theirs: sum('theirs') },
      dropped: {
        ours: reviews.flatMap((r) => r.dropped.ours),
        theirs: reviews.flatMap((r) => r.dropped.theirs),
      },
      rewritten: {
        ours: reviews.flatMap((r) => r.rewritten.ours),
        theirs: reviews.flatMap((r) => r.rewritten.theirs),
      },
      twice: reviews.reduce((n, r) => n + r.twice, 0),
      written: reviews.reduce((n, r) => n + r.written, 0),
      repeats: reviews.flatMap((r) => r.repeats),
    };
    const flags = regionFlags(together, entry.into, entry.branch);
    const tone = flags.some((f) => f.tone === 'bad')
      ? 'bad'
      : flags.some((f) => f.tone === 'new')
        ? 'new'
        : 'ok';
    return { path, regions: own, asked: [], flags, tone };
  });
}

/**
 * The regions a question of the merger agent names, by the numbers its prompt gave them: `Region
 * 4`, `regions 1 and 2`.
 */
export function askedRegions(question: string): number[] {
  const numbers = [
    ...question.matchAll(/\bregions?\s+(\d+)((?:\s*(?:,|and|&|–|-)\s*\d+)*)/gi),
  ].flatMap((match) => [match[1], ...(match[2]?.match(/\d+/g) ?? [])].map(Number));
  return [...new Set(numbers)];
}

/**
 * The file a merge's page shows first (fix/merge-viewer-on-conflict): when the agent asked, the one
 * holding the first region its question names; else the first that loses, doubles or repeats
 * lines, then the first the agent wrote in, then the first.
 */
export function firstFile(
  files: readonly ResolutionFile[],
  entry?: MergeEntry,
): ResolutionFile | undefined {
  const asked = entry?.resolution?.needsYou ? (entry.resolution.asked ?? []) : [];
  const [named] = entry?.resolution?.needsYou ? askedRegions(entry.resolution.needsYou) : [];
  const region = named === undefined ? undefined : asked[named - 1];
  return (
    (region &&
      files.find((f) => f.asked.some((r) => r.path === region.path && r.line === region.line))) ??
    files.find((f) => f.tone === 'bad') ??
    files.find((f) => f.tone === 'new') ??
    files[0]
  );
}

/** A gutter of side names is as wide as the longest, at most this many characters. */
const GUTTER_MOST = 24;

/** The characters a region's gutter takes for `names` (fix/merge-viewer-on-conflict). */
export const gutterChars = (names: readonly string[]) =>
  Math.min(GUTTER_MOST, Math.max(0, ...names.map((name) => name.length)));
