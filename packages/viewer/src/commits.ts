import type { Commit, Graph } from '@cpr/core';

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

/**
 * What the picks compare: of two, the lower in the list (older) is the base; one commit is
 * compared with its first parent. Null with nothing to compare (a root commit has no parent).
 */
export function comparison(
  commits: readonly Commit[],
  picks: readonly string[],
): Comparison | null {
  let pair: Pair | null = null;
  if (picks.length === 1 && picks[0] !== undefined) {
    const commit = commits.find((c) => c.sha === picks[0]);
    const parent = commit?.parents[0];
    if (commit && parent) pair = { base: parent, head: commit.sha };
  } else if (picks.length === 2) {
    const [first, second] = picks.map((sha) => commits.findIndex((c) => c.sha === sha));
    if (first !== undefined && second !== undefined && first >= 0 && second >= 0) {
      const older = commits[Math.max(first, second)];
      const newer = commits[Math.min(first, second)];
      if (older && newer) pair = { base: older.sha, head: newer.sha };
    }
  }
  if (!pair) return null;
  const count = countBetween(commits, pair);
  const label = `${shortSha(pair.base)} → ${shortSha(pair.head)} · ${count} commit${count === 1 ? '' : 's'}`;
  return { ...pair, label };
}

/**
 * Commits head adds to base (`git rev-list --count base..head`), among the commits listed: the
 * history older than the list is not walked.
 */
function countBetween(commits: readonly Commit[], { base, head }: Pair): number {
  const parents = new Map(commits.map((c) => [c.sha, c.parents]));
  const reach = (from: string, stop: ReadonlySet<string>) => {
    const seen = new Set<string>();
    const todo = [from];
    for (let sha = todo.pop(); sha !== undefined; sha = todo.pop()) {
      if (seen.has(sha) || stop.has(sha) || !parents.has(sha)) continue;
      seen.add(sha);
      todo.push(...(parents.get(sha) ?? []));
    }
    return seen;
  };
  return reach(head, reach(base, new Set())).size;
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
