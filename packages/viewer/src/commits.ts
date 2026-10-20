import type { Commit, CommitRef, Graph } from '@cpr/core';
import type { ReviewMark } from './branchReviews.js';
import type { AgentChip } from './workspaces.js';

/** Two commits compared directly, by full SHA. */
export interface Pair {
  base: string;
  head: string;
}

/** What the picks compare, or why they cannot be compared. */
export interface Comparison {
  /** What Compare analyzes; null when nothing can be (the label says why). */
  pair: Pair | null;
  /** `a1b2c3d → e4f5a6b · 12 commits`, or why there is nothing to compare. */
  label: string;
  /** The picks are on lines that diverged (V10c): `pair.base` is their fork point. */
  diverged?: Diverged;
}

/** Two picks neither of which is an ancestor of the other. */
export interface Diverged {
  /** The pick on the base's side; its commits since the fork are not in the diff. */
  other: string;
  otherCommits: number;
  /** The fork point's row. */
  forkRow: number;
  /** Why that side is the base: on the default branch's line, HEAD's line, or the lower row. */
  by: 'default' | 'head' | 'older';
}

/** The history as `comparison` reads it. */
export interface Lines {
  /** Each row's parents as row numbers; one not in the history is below zero. */
  parents: readonly (readonly number[])[];
  /** HEAD's row: its first-parent line is the current branch's (lane 0). */
  head: number | null;
  /** The rows of the default branch's tips (the local branch's, the remotes'). */
  trunk: readonly number[];
  /** The whole shape is in: a parent not listed is outside the history (a shallow clone's edge). */
  complete: boolean;
  /** A row's SHA, if its details are loaded (the fork point's is needed to compare from it). */
  shaAt: (row: number) => string | undefined;
}

export const shortSha = (sha: string): string => sha.slice(0, 7);

/**
 * The commits picked after a click: a picked one is unpicked; with two picked, the new one
 * replaces the last picked (the first stays, as one end of the range).
 */
export function pick(picks: readonly string[], sha: string): string[] {
  if (picks.includes(sha)) return picks.filter((p) => p !== sha);
  return picks.length < 2 ? [...picks, sha] : [picks[0] ?? sha, sha];
}

/** A picked commit: its row, and its first parent's SHA (none for a root commit). */
export interface Picked {
  sha: string;
  row: number;
  parent?: string;
}

const plural = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;

/**
 * What the picks compare. One commit: against its first parent. Two, one an ancestor of the
 * other: the ancestor is the base. Two on lines that diverged (V10c): head's side from their
 * fork point, as a pull request shows it; the base's side is the pick on the default branch's
 * line, else on HEAD's, else the lower row (`swapped` turns it round). Null with nothing to
 * compare (nothing picked, a root commit alone).
 */
export function comparison(
  picks: readonly Picked[],
  lines: Lines,
  swapped = false,
): Comparison | null {
  const [first, second] = picks;
  if (!first) return null;
  if (!second) {
    if (!first.parent) return null;
    const parentRow = lines.parents[first.row]?.[0] ?? -1;
    const pair = { base: first.parent, head: first.sha };
    const arrow = `${shortSha(pair.base)} → ${shortSha(pair.head)}`;
    // Before the shape is in, a parent may not be listed yet: no count to give.
    if (parentRow < 0) return { pair, label: arrow };
    const { only } = paint(lines.parents, parentRow, first.row);
    return { pair, label: `${arrow} · ${plural(only[1])}` };
  }
  const { fork, only, missing } = paint(lines.parents, first.row, second.row);
  const [upper, lower] = first.row < second.row ? [first, second] : [second, first];
  const names = `${shortSha(upper.sha)} and ${shortSha(lower.sha)}`;
  if (fork === null) {
    let label = `${names} share no history: nothing to compare`;
    if (missing) {
      label = lines.complete
        ? `The fork point of ${names} is not in this clone`
        : `Finding where ${names} forked…`;
    }
    return { pair: null, label };
  }
  const commits = (pick: Picked) => only[pick === first ? 0 : 1];
  // An ancestor pair: the ancestor is the base (it is the fork point).
  const ancestor = fork === first.row ? first : fork === second.row ? second : null;
  if (ancestor !== null) {
    const head = ancestor === first ? second : first;
    return {
      pair: { base: ancestor.sha, head: head.sha },
      label: `${shortSha(ancestor.sha)} → ${shortSha(head.sha)} · ${plural(commits(head))}`,
    };
  }
  let base = lower;
  let by: Diverged['by'] = 'older';
  for (const [tips, rule] of [
    [lines.trunk, 'default'],
    [lines.head === null ? [] : [lines.head], 'head'],
  ] as const) {
    const onFirst = onLine(lines.parents, tips, first.row);
    if (onFirst !== onLine(lines.parents, tips, second.row)) {
      base = onFirst ? first : second;
      by = rule;
      break;
    }
  }
  if (swapped) base = base === first ? second : first;
  const head = base === first ? second : first;
  const diverged = { other: base.sha, otherCommits: commits(base), forkRow: fork, by };
  const forkSha = lines.shaAt(fork);
  // Its row's details are not loaded yet: the caller loads them.
  if (forkSha === undefined)
    return { pair: null, label: `Finding where ${names} forked…`, diverged };
  return {
    pair: { base: forkSha, head: head.sha },
    label: `${shortSha(forkSha)} → ${shortSha(head.sha)} · ${plural(commits(head))}`,
    diverged,
  };
}

/**
 * Paints down from rows `a` and `b` in graph order (every child above its parents, so a row's
 * marks are final when the walk reaches it): `only` counts the rows each side alone reaches
 * (`git rev-list --left-right --count a...b`), `fork` is the first row both reach — a best common
 * ancestor, `git merge-base` — or null. `missing`: a row reached by one side has a parent the
 * rows do not hold (not listed yet, or outside a shallow clone).
 */
function paint(
  parents: readonly (readonly number[])[],
  a: number,
  b: number,
): { fork: number | null; only: [number, number]; missing: boolean } {
  const marks = new Uint8Array(parents.length);
  marks[a] = (marks[a] ?? 0) | 1;
  marks[b] = (marks[b] ?? 0) | 2;
  const only: [number, number] = [0, 0];
  // Rows marked by one side and not reached yet: once none is left, nothing more is counted.
  let single = a === b ? 0 : 2;
  let fork: number | null = null;
  let missing = false;
  let row = Math.min(a, b);
  for (; row < parents.length && single > 0; row++) {
    const mark = marks[row] ?? 0;
    if (mark === 0) continue;
    if (mark === 3) fork ??= row;
    else {
      single--;
      only[mark === 1 ? 0 : 1]++;
    }
    for (const parent of parents[row] ?? []) {
      if (parent < 0 || parent >= parents.length) {
        if (mark !== 3) missing = true;
        continue;
      }
      const before = marks[parent] ?? 0;
      const after = before | mark;
      if (after === before) continue;
      if (before === 1 || before === 2) single--;
      if (after === 1 || after === 2) single++;
      marks[parent] = after;
    }
  }
  // Rows still marked are reached by both: the first of them is the fork point.
  for (; fork === null && row < parents.length; row++) if (marks[row] === 3) fork = row;
  return { fork, only, missing };
}

/** Whether `row` is on the first-parent line from one of `tips`. */
function onLine(parents: readonly (readonly number[])[], tips: readonly number[], row: number) {
  return tips.some((tip) => {
    let at = tip;
    // Rows only grow along the line: past `row`, it is not on it.
    while (at >= 0 && at < row) at = parents[at]?.[0] ?? -1;
    return at === row;
  });
}

/**
 * The first rows' parents as row numbers, before the history's shape is known: a parent not
 * listed gets a number of its own below zero, the same for the same commit, so lanes join.
 */
export function parentRows(commits: readonly Commit[]): number[][] {
  const rows = new Map(commits.map((c, i) => [c.sha, i]));
  const unlisted = new Map<string, number>();
  return commits.map((c) =>
    c.parents.map((p) => {
      const row = rows.get(p);
      if (row !== undefined) return row;
      if (!unlisted.has(p)) unlisted.set(p, -(unlisted.size + 1));
      return unlisted.get(p) ?? -1;
    }),
  );
}

/** Rows whose details are asked for together. */
export const BLOCK = 200;

/** The blocks of rows to have for rows `first` to `last` in view, and a screen around them. */
export function blocksAround(first: number, last: number, rows: number): number[] {
  const margin = last - first + 1;
  const from = Math.max(0, first - margin);
  const to = Math.min(rows - 1, last + margin);
  const blocks: number[] = [];
  for (let block = Math.floor(from / BLOCK); block <= Math.floor(to / BLOCK); block++) {
    blocks.push(block);
  }
  return blocks;
}

/** A badge on a commit's row: a ref, HEAD with its branch, or "+N" for refs folded away. */
export interface Badge {
  kind: CommitRef['kind'] | 'more';
  label: string;
  title?: string;
  /** The branch is reviewed (V15, V16): "+2", "✓", "✗" or "…", and what it means. */
  review?: ReviewMark;
  /** The branch is a workspace's (V18b): its agent's mark, a link to the workspace. */
  agent?: AgentChip & { href: string };
}

/** Badges shown on a row before the rest are folded into "+N" (Qwik tags 9 packages at once). */
const MAX_BADGES = 3;

/**
 * A row's badges: HEAD joined with the branch checked out ("HEAD → main"), so the current
 * commit stands out; the first few refs, then "+N" naming the others. `reviewed`: each reviewed
 * branch's mark, by ref name.
 */
export function rowBadges(
  refs: readonly CommitRef[],
  branch: string | null,
  reviewed: ReadonlyMap<string, ReviewMark> = new Map(),
  agents: ReadonlyMap<string, AgentChip & { href: string }> = new Map(),
): Badge[] {
  const head = refs.some((r) => r.kind === 'head');
  const review = (name: string) => {
    const mark = reviewed.get(name);
    const agent = agents.get(name);
    return { ...(mark === undefined ? {} : { review: mark }), ...(agent ? { agent } : {}) };
  };
  const badges: Badge[] = refs.flatMap((ref): Badge[] => {
    if (ref.kind === 'head') {
      return [
        branch && refs.some((r) => r.kind === 'branch' && r.name === branch)
          ? {
              kind: 'head',
              label: `HEAD → ${branch}`,
              title: `HEAD: the branch ${branch} is checked out`,
              ...review(branch),
            }
          : { kind: 'head', label: 'HEAD', title: 'HEAD, detached: no branch is checked out' },
      ];
    }
    if (head && ref.kind === 'branch' && ref.name === branch) return [];
    return [{ kind: ref.kind, label: ref.name, ...(ref.kind === 'tag' ? {} : review(ref.name)) }];
  });
  if (badges.length <= MAX_BADGES) return badges;
  const folded = badges.slice(MAX_BADGES - 1);
  const agent = foldedMark(folded);
  return [
    ...badges.slice(0, MAX_BADGES - 1),
    {
      kind: 'more',
      label: `+${folded.length}`,
      title: folded.map((b) => b.label).join('\n'),
      ...(agent ? { agent } : {}),
    },
  ];
}

/** Which workspace marks matter most: what needs the person, then what works, then what is done. */
const URGENCY: readonly AgentChip['tone'][] = [
  'failed',
  'waiting',
  'ready',
  'idle',
  'working',
  'done',
];

/**
 * The mark "+N" carries for the workspaces it folds (V18b): the most urgent one's, a link to that
 * workspace (V29a: there is no Workspaces page to list them), its title naming them all and how
 * many need the person.
 */
function foldedMark(folded: readonly Badge[]): (AgentChip & { href: string }) | undefined {
  const marked = folded.filter((b) => b.agent);
  const first = marked
    .map((b) => b.agent as AgentChip & { href: string })
    .sort((a, b) => URGENCY.indexOf(a.tone) - URGENCY.indexOf(b.tone))[0];
  if (!first) return undefined;
  const needs = marked.filter((b) => !['working', 'done'].includes(b.agent?.tone ?? '')).length;
  const state =
    needs === 1
      ? 'one needs you'
      : needs > 1
        ? `${needs} need you`
        : first.tone === 'working'
          ? 'working'
          : 'done';
  return {
    mark: first.mark,
    tone: first.tone,
    title: `Workspaces here: ${marked.map((b) => b.label).join(', ')} — ${state}`,
    href: first.href,
  };
}

const UNITS: [unit: string, seconds: number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** `2 days ago`, as commit lists say it. */
export function relativeDate(iso: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  for (const [unit, size] of UNITS) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

/** What a diff page's `api/graph` said: the graph, or how its analysis is going. */
export type Loaded =
  | { kind: 'graph'; graph: Graph }
  /** Being analyzed: `queued` analyses before it, its phase once it runs. */
  | { kind: 'progress'; pair: Pair; phase: string | null; queued: number; elapsedMs: number }
  | { kind: 'failed'; pair: Pair; error: string }
  /** No graph here: the commits page, a diff not analyzed (yet, or any more), or no server. */
  | { kind: 'missing'; pair?: Pair };

/** Reads `api/graph`'s answer (`cpr view`: 202 while analyzing, 502 when it failed). */
export function graphLoaded(status: number, body: unknown): Loaded {
  if (status === 200 && body && typeof body === 'object')
    return { kind: 'graph', graph: body as Graph };
  const value = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const pair =
    typeof value.base === 'string' && typeof value.head === 'string'
      ? { base: value.base, head: value.head }
      : undefined;
  if (pair && status === 202) {
    return {
      kind: 'progress',
      pair,
      phase: typeof value.phase === 'string' ? value.phase : null,
      queued: typeof value.queued === 'number' ? value.queued : 0,
      elapsedMs: typeof value.elapsedMs === 'number' ? value.elapsedMs : 0,
    };
  }
  if (pair && status === 502) {
    return { kind: 'failed', pair, error: typeof value.error === 'string' ? value.error : '' };
  }
  return pair ? { kind: 'missing', pair } : { kind: 'missing' };
}
