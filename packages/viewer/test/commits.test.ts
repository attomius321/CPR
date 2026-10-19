import type { Commit } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import {
  blocksAround,
  comparison,
  graphLoaded,
  parentRows,
  pick,
  relativeDate,
  rowBadges,
  type Lines,
  type Picked,
} from '../src/commits.js';

const sha = (c: string) => c.repeat(40);
/** Every row's SHA loaded. */
const shaOf = (rows: string[]) => (row: number) => (rows[row] ? sha(rows[row]) : undefined);

// In graph order: e ← d ← c ← b ← a, with a side branch x merged by d.
//   a ── b ── c ── d ── e
//         \── x ──/
const ROWS = ['e', 'd', 'x', 'c', 'b', 'a'];
const PARENTS = [[1], [3, 2], [4], [4], [5], []];
/** The history as the page has it once the shape is in: HEAD on e, no default branch. */
const LINES: Lines = { parents: PARENTS, head: 0, trunk: [], complete: true, shaAt: shaOf(ROWS) };
/** A pick of row `row` of `rows` (with `parents`). */
const pickOf = (rows: string[], parents: number[][], c: string): Picked => {
  const row = rows.indexOf(c);
  const first = parents[row]?.[0];
  return {
    sha: sha(c),
    row,
    ...(first === undefined || first < 0 ? {} : { parent: sha(rows[first] ?? '') }),
  };
};
/** A pick of the row holding commit `c`. */
const picked = (c: string): Picked => pickOf(ROWS, PARENTS, c);

describe('pick', () => {
  it('picks up to two commits; a picked one is unpicked; a third replaces the last', () => {
    expect(pick([], sha('a'))).toEqual([sha('a')]);
    expect(pick([sha('a')], sha('c'))).toEqual([sha('a'), sha('c')]);
    expect(pick([sha('a'), sha('c')], sha('a'))).toEqual([sha('c')]);
    expect(pick([sha('a'), sha('c')], sha('e'))).toEqual([sha('a'), sha('e')]);
  });
});

describe('comparison', () => {
  it('takes the ancestor (the lower row) as the base, in either order picked', () => {
    const expected = {
      pair: { base: sha('b'), head: sha('e') },
      label: 'bbbbbbb → eeeeeee · 4 commits',
    };
    expect(comparison([picked('b'), picked('e')], LINES)).toEqual(expected);
    expect(comparison([picked('e'), picked('b')], LINES)).toEqual(expected);
  });

  it('counts the commits head adds to base, merged ones included', () => {
    expect(comparison([picked('c'), picked('d')], LINES)?.label).toBe(
      'ccccccc → ddddddd · 2 commits',
    );
    expect(comparison([picked('b'), picked('x')], LINES)?.label).toBe(
      'bbbbbbb → xxxxxxx · 1 commit',
    );
  });

  it('compares one commit against its first parent', () => {
    expect(comparison([picked('c')], LINES)).toEqual({
      pair: { base: sha('b'), head: sha('c') },
      label: 'bbbbbbb → ccccccc · 1 commit',
    });
    expect(comparison([picked('d')], LINES)).toMatchObject({
      pair: { base: sha('c'), head: sha('d') },
      label: 'ccccccc → ddddddd · 2 commits',
    });
  });

  it('has nothing to compare for nothing picked, or the root commit alone', () => {
    expect(comparison([], LINES)).toBeNull();
    expect(comparison([picked('a')], LINES)).toBeNull();
  });

  it('compares a merged side branch with the line it left from where they forked', () => {
    // x and c diverged at b; c is on HEAD's line, so it is the base's side.
    expect(comparison([picked('x'), picked('c')], LINES)).toEqual({
      pair: { base: sha('b'), head: sha('x') },
      label: 'bbbbbbb → xxxxxxx · 1 commit',
      diverged: { other: sha('c'), otherCommits: 1, forkRow: 4, by: 'head' },
    });
  });
});

describe('comparison of picks on diverged lines (V10c)', () => {
  // main: a ← b ← c ← d; topic: b ← e ← f; other: a ← g. In graph order:
  //   d ─ c ─────── b ─── a
  //           f ─ e ┘     │
  //                   g ──┘
  const rows = ['d', 'c', 'f', 'e', 'b', 'g', 'a'];
  const parents = [[1], [4], [3], [4], [6], [6], []];
  const on = (c: string) => pickOf(rows, parents, c);
  /** main's tip (row 0) is the default branch's; HEAD on main unless said. */
  const lines = (over: Partial<Lines> = {}): Lines => ({
    parents,
    head: 0,
    trunk: [0],
    complete: true,
    shaAt: shaOf(rows),
    ...over,
  });

  it("compares the branch with the default branch from their fork point, main's side the base", () => {
    const expected = {
      pair: { base: sha('b'), head: sha('f') },
      label: 'bbbbbbb → fffffff · 2 commits',
      diverged: { other: sha('d'), otherCommits: 2, forkRow: 4, by: 'default' },
    };
    expect(comparison([on('d'), on('f')], lines())).toEqual(expected);
    expect(comparison([on('f'), on('d')], lines())).toEqual(expected);
    // An older commit of main is on its line too.
    expect(comparison([on('c'), on('f')], lines())).toEqual({
      ...expected,
      diverged: { other: sha('c'), otherCommits: 1, forkRow: 4, by: 'default' },
    });
  });

  it('keeps the default branch as the base with the branch checked out', () => {
    expect(comparison([on('d'), on('f')], lines({ head: 2 }))).toMatchObject({
      pair: { base: sha('b'), head: sha('f') },
      diverged: { other: sha('d'), by: 'default' },
    });
  });

  it("takes HEAD's line without a default branch, else the older pick", () => {
    expect(comparison([on('d'), on('f')], lines({ head: 2, trunk: [] }))).toEqual({
      pair: { base: sha('b'), head: sha('d') },
      label: 'bbbbbbb → ddddddd · 2 commits',
      diverged: { other: sha('f'), otherCommits: 2, forkRow: 4, by: 'head' },
    });
    // Neither f nor g is on main's line or HEAD's: g, the lower row, is the base's side.
    expect(comparison([on('f'), on('g')], lines())).toEqual({
      pair: { base: sha('a'), head: sha('f') },
      label: 'aaaaaaa → fffffff · 3 commits',
      diverged: { other: sha('g'), otherCommits: 1, forkRow: 6, by: 'older' },
    });
  });

  it("waits for the fork point's SHA when its row is not loaded yet", () => {
    const loaded = (row: number) => (row === 4 ? undefined : shaOf(rows)(row));
    expect(comparison([on('d'), on('f')], lines({ shaAt: loaded }))).toEqual({
      pair: null,
      label: 'Finding where ddddddd and fffffff forked…',
      diverged: { other: sha('d'), otherCommits: 2, forkRow: 4, by: 'default' },
    });
  });

  it('swaps the sides: the same fork point, the other pick as head', () => {
    expect(comparison([on('d'), on('f')], lines(), true)).toEqual({
      pair: { base: sha('b'), head: sha('d') },
      label: 'bbbbbbb → ddddddd · 2 commits',
      diverged: { other: sha('f'), otherCommits: 2, forkRow: 4, by: 'default' },
    });
    // An ancestor pair has no other way round.
    expect(comparison([on('b'), on('d')], lines(), true)).toEqual({
      pair: { base: sha('b'), head: sha('d') },
      label: 'bbbbbbb → ddddddd · 2 commits',
    });
  });

  it('takes one best common ancestor of a criss-cross, and counts each side', () => {
    // m merges b and c, n merges c and b: both b and c are best common ancestors of p and q.
    const cross = ['p', 'q', 'm', 'n', 'b', 'c', 'a'];
    const crossParents = [[2], [3], [4, 5], [5, 4], [6], [6], []];
    const result = comparison(
      [pickOf(cross, crossParents, 'p'), pickOf(cross, crossParents, 'q')],
      { parents: crossParents, head: 0, trunk: [], complete: true, shaAt: shaOf(cross) },
    );
    expect(result).toEqual({
      pair: { base: sha('b'), head: sha('q') },
      label: 'bbbbbbb → qqqqqqq · 2 commits',
      diverged: { other: sha('p'), otherCommits: 2, forkRow: 4, by: 'head' },
    });
  });

  it('says why there is nothing to compare: no shared history, not in this clone, or listing', () => {
    // Two roots: u and a share nothing.
    const apart = ['u', 'a'];
    const none = [[], []];
    const pickApart = [pickOf(apart, none, 'u'), pickOf(apart, none, 'a')];
    expect(
      comparison(pickApart, {
        parents: none,
        head: 1,
        trunk: [],
        complete: true,
        shaAt: shaOf(apart),
      }),
    ).toEqual({
      pair: null,
      label: 'uuuuuuu and aaaaaaa share no history: nothing to compare',
    });
    // A shallow clone's edge (-1): the fork point is not here.
    const cut = [[-1], [-1]];
    const pickCut = [pickOf(apart, cut, 'u'), pickOf(apart, cut, 'a')];
    expect(
      comparison(pickCut, {
        parents: cut,
        head: 1,
        trunk: [],
        complete: true,
        shaAt: shaOf(apart),
      }),
    ).toEqual({
      pair: null,
      label: 'The fork point of uuuuuuu and aaaaaaa is not in this clone',
    });
    // Before the shape, parents not listed yet (below zero) may still lead to it.
    const early = [[-1], [-2]];
    expect(
      comparison(pickCut, {
        parents: early,
        head: 1,
        trunk: [],
        complete: false,
        shaAt: shaOf(apart),
      }),
    ).toEqual({
      pair: null,
      label: 'Finding where uuuuuuu and aaaaaaa forked…',
    });
  });

  it('compares one pick with its parent, without a count while the parent is not listed', () => {
    const first = ['f', 'e'];
    const firstParents = [[1], [-1]];
    const pickE = { sha: sha('e'), row: 1, parent: sha('b') };
    expect(
      comparison([pickE], {
        parents: firstParents,
        head: 0,
        trunk: [],
        complete: false,
        shaAt: shaOf(first),
      }),
    ).toEqual({ pair: { base: sha('b'), head: sha('e') }, label: 'bbbbbbb → eeeeeee' });
    expect(
      comparison([pickOf(first, firstParents, 'f')], {
        parents: firstParents,
        head: 0,
        trunk: [],
        complete: false,
        shaAt: shaOf(first),
      }),
    ).toEqual({ pair: { base: sha('e'), head: sha('f') }, label: 'eeeeeee → fffffff · 1 commit' });
  });
});

const commit = (c: string, parents: string[]): Commit => ({
  sha: sha(c),
  parents: parents.map(sha),
  author: 'Ada',
  date: '2026-10-13T08:00:00Z',
  subject: `commit ${c}`,
  refs: [],
});

describe('parentRows', () => {
  it('numbers parents by row; one not listed gets a number of its own below zero', () => {
    const first = [commit('e', ['d']), commit('d', ['c', 'x']), commit('x', ['b'])];
    expect(parentRows(first)).toEqual([[1], [-1, 2], [-2]]);
    expect(parentRows([commit('p', ['q']), commit('r', ['q'])])).toEqual([[-1], [-1]]);
  });
});

describe('blocksAround', () => {
  it('names the blocks of 200 rows in view and a screen around them', () => {
    expect(blocksAround(0, 25, 1000)).toEqual([0]);
    expect(blocksAround(180, 205, 1000)).toEqual([0, 1]);
    expect(blocksAround(390, 415, 1000)).toEqual([1, 2]);
    // Not past the last row.
    expect(blocksAround(990, 999, 1000)).toEqual([4]);
  });
});

describe('relativeDate', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  it.each([
    ['2026-10-13T11:59:30Z', 'just now'],
    ['2026-10-13T11:58:00Z', '2 minutes ago'],
    ['2026-10-13T11:00:00Z', '1 hour ago'],
    ['2026-10-11T12:00:00Z', '2 days ago'],
    ['2026-08-01T12:00:00Z', '2 months ago'],
    ['2024-10-01T12:00:00Z', '2 years ago'],
  ])('%s is %s', (date, words) => {
    expect(relativeDate(date, now)).toBe(words);
  });
});

describe('graphLoaded', () => {
  const pair = { base: sha('b'), head: sha('e') };
  it('reads what a diff page answers while it is analyzed', () => {
    expect(
      graphLoaded(202, { ...pair, status: 'running', phase: 'loadHead', elapsedMs: 1200 }),
    ).toEqual({ kind: 'progress', pair, phase: 'loadHead', queued: 0, elapsedMs: 1200 });
    expect(graphLoaded(202, { ...pair, status: 'queued', queued: 2, elapsedMs: 0 })).toEqual({
      kind: 'progress',
      pair,
      phase: null,
      queued: 2,
      elapsedMs: 0,
    });
    expect(graphLoaded(502, { ...pair, error: 'cpr: boom' })).toEqual({
      kind: 'failed',
      pair,
      error: 'cpr: boom',
    });
    expect(graphLoaded(404, { ...pair, error: 'not analyzed' })).toEqual({
      kind: 'missing',
      pair,
    });
  });

  it('reads a graph, and anything else as no graph', () => {
    const graph = { schemaVersion: '0.6.0', nodes: [] };
    expect(graphLoaded(200, graph)).toEqual({ kind: 'graph', graph });
    expect(graphLoaded(404, null)).toEqual({ kind: 'missing' });
    expect(graphLoaded(200, 'not json')).toEqual({ kind: 'missing' });
    expect(graphLoaded(500, 'oops')).toEqual({ kind: 'missing' });
  });
});

describe('rowBadges', () => {
  it('puts the most urgent workspace mark of the badges it folds on "+N" (V18b)', () => {
    const chip = (mark: string, tone: 'working' | 'waiting', branch: string) => ({
      mark,
      tone,
      title: `Workspace: ${branch}`,
      href: `/?branch=${branch}`,
    });
    const agents = new Map([
      ['feature/a', chip('⚙', 'working', 'feature/a')],
      ['feature/b', chip('?', 'waiting', 'feature/b')],
    ]);
    const badges = rowBadges(
      [
        { kind: 'head', name: 'HEAD' },
        { kind: 'branch', name: 'main' },
        { kind: 'remote', name: 'origin/main' },
        { kind: 'branch', name: 'feature/a' },
        { kind: 'branch', name: 'feature/b' },
      ],
      'main',
      new Map(),
      agents,
    );
    expect(badges.at(-1)).toEqual({
      kind: 'more',
      label: '+2',
      title: 'feature/a\nfeature/b',
      agent: {
        mark: '?',
        tone: 'waiting',
        title: 'Workspaces here: feature/a, feature/b — one needs you',
        href: '/',
      },
    });
    // Without workspaces folded, "+N" carries no mark.
    expect(
      rowBadges(
        [
          { kind: 'head', name: 'HEAD' },
          { kind: 'branch', name: 'main' },
          { kind: 'tag', name: 'v1' },
          { kind: 'tag', name: 'v2' },
          { kind: 'tag', name: 'v3' },
        ],
        'main',
        new Map(),
        agents,
      ).at(-1),
    ).toEqual({ kind: 'more', label: '+2', title: 'v2\nv3' });
  });

  it('joins HEAD and the branch it is on into one badge', () => {
    expect(
      rowBadges(
        [
          { kind: 'head', name: 'HEAD' },
          { kind: 'branch', name: 'main' },
          { kind: 'branch', name: 'wip' },
          { kind: 'remote', name: 'origin/main' },
        ],
        'main',
      ),
    ).toEqual([
      { kind: 'head', label: 'HEAD → main', title: 'HEAD: the branch main is checked out' },
      { kind: 'branch', label: 'wip' },
      { kind: 'remote', label: 'origin/main' },
    ]);
  });

  it('says when HEAD is detached', () => {
    expect(
      rowBadges(
        [
          { kind: 'head', name: 'HEAD' },
          { kind: 'tag', name: 'v1' },
        ],
        null,
      ),
    ).toEqual([
      { kind: 'head', label: 'HEAD', title: 'HEAD, detached: no branch is checked out' },
      { kind: 'tag', label: 'v1' },
    ]);
  });

  it('shows three badges at most, then "+N" naming the rest', () => {
    const tags = ['t1', 't2', 't3', 't4', 't5'].map((name) => ({ kind: 'tag' as const, name }));
    expect(rowBadges(tags, 'main')).toEqual([
      { kind: 'tag', label: 't1' },
      { kind: 'tag', label: 't2' },
      { kind: 'more', label: '+3', title: 't3\nt4\nt5' },
    ]);
    expect(rowBadges(tags.slice(0, 3), 'main')).toHaveLength(3);
  });
});
