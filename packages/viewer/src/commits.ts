import type { Commit, CommitRef, Graph } from '@cpr/core';

/** Two commits compared directly, by full SHA. */
export interface Pair {
  base: string;
  head: string;
}

export interface Comparison extends Pair {
  /** `a1b2c3d → e4f5a6b · 12 commits`. */
  label: string;
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

/**
 * What the picks compare: of two, the lower row (older: in graph order an ancestor is always
 * lower) is the base; one commit is compared with its first parent. Null with nothing to
 * compare (a root commit has no parent). `parents` are the history's rows' parents.
 */
export function comparison(
  picks: readonly Picked[],
  parents: readonly (readonly number[])[],
): Comparison | null {
  let pair: (Pair & { rows: [base: number, head: number] }) | null = null;
  const [first, second] = picks;
  if (first && !second) {
    if (first.parent) {
      const parentRow = parents[first.row]?.[0] ?? -1;
      pair = { base: first.parent, head: first.sha, rows: [parentRow, first.row] };
    }
  } else if (first && second) {
    const [older, newer] = first.row > second.row ? [first, second] : [second, first];
    pair = { base: older.sha, head: newer.sha, rows: [older.row, newer.row] };
  }
  if (!pair) return null;
  const count = countBetween(parents, ...pair.rows);
  const label = `${shortSha(pair.base)} → ${shortSha(pair.head)} · ${count} commit${count === 1 ? '' : 's'}`;
  return { base: pair.base, head: pair.head, label };
}

/** Commits head adds to base (`git rev-list --count base..head`), walked through the rows. */
function countBetween(parents: readonly (readonly number[])[], base: number, head: number): number {
  const reach = (from: number, stop: ReadonlySet<number>) => {
    const seen = new Set<number>();
    const todo = [from];
    for (let row = todo.pop(); row !== undefined; row = todo.pop()) {
      if (seen.has(row) || stop.has(row) || row < 0 || row >= parents.length) continue;
      seen.add(row);
      todo.push(...(parents[row] ?? []));
    }
    return seen;
  };
  return reach(head, reach(base, new Set())).size;
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
}

/** Badges shown on a row before the rest are folded into "+N" (Qwik tags 9 packages at once). */
const MAX_BADGES = 3;

/**
 * A row's badges: HEAD joined with the branch checked out ("HEAD → main"), so the current
 * commit stands out; the first few refs, then "+N" naming the others.
 */
export function rowBadges(refs: readonly CommitRef[], branch: string | null): Badge[] {
  const head = refs.some((r) => r.kind === 'head');
  const badges: Badge[] = refs.flatMap((ref): Badge[] => {
    if (ref.kind === 'head') {
      return [
        branch && refs.some((r) => r.kind === 'branch' && r.name === branch)
          ? {
              kind: 'head',
              label: `HEAD → ${branch}`,
              title: `HEAD: the branch ${branch} is checked out`,
            }
          : { kind: 'head', label: 'HEAD', title: 'HEAD, detached: no branch is checked out' },
      ];
    }
    if (head && ref.kind === 'branch' && ref.name === branch) return [];
    return [{ kind: ref.kind, label: ref.name }];
  });
  if (badges.length <= MAX_BADGES) return badges;
  const folded = badges.slice(MAX_BADGES - 1);
  return [
    ...badges.slice(0, MAX_BADGES - 1),
    { kind: 'more', label: `+${folded.length}`, title: folded.map((b) => b.label).join('\n') },
  ];
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
