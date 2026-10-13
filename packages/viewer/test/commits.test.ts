import type { Commit } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import {
  blocksAround,
  comparison,
  graphLoaded,
  parentRows,
  pick,
  relativeDate,
  type Picked,
} from '../src/commits.js';

const sha = (c: string) => c.repeat(40);

// In graph order: e ← d ← c ← b ← a, with a side branch x merged by d.
//   a ── b ── c ── d ── e
//         \── x ──/
const ROWS = ['e', 'd', 'x', 'c', 'b', 'a'];
const PARENTS = [[1], [3, 2], [4], [4], [5], []];
/** A pick of the row holding commit `c`. */
const picked = (c: string): Picked => {
  const row = ROWS.indexOf(c);
  const first = PARENTS[row]?.[0];
  return { sha: sha(c), row, ...(first === undefined ? {} : { parent: sha(ROWS[first] ?? '') }) };
};

describe('pick', () => {
  it('picks up to two commits; a picked one is unpicked; a third replaces the last', () => {
    expect(pick([], sha('a'))).toEqual([sha('a')]);
    expect(pick([sha('a')], sha('c'))).toEqual([sha('a'), sha('c')]);
    expect(pick([sha('a'), sha('c')], sha('a'))).toEqual([sha('c')]);
    expect(pick([sha('a'), sha('c')], sha('e'))).toEqual([sha('a'), sha('e')]);
  });
});

describe('comparison', () => {
  it('takes the lower row (older) as the base, in either order picked', () => {
    const expected = {
      base: sha('b'),
      head: sha('e'),
      label: 'bbbbbbb → eeeeeee · 4 commits',
    };
    expect(comparison([picked('b'), picked('e')], PARENTS)).toEqual(expected);
    expect(comparison([picked('e'), picked('b')], PARENTS)).toEqual(expected);
  });

  it('counts the commits head adds to base, merged ones included', () => {
    expect(comparison([picked('c'), picked('d')], PARENTS)?.label).toBe(
      'ccccccc → ddddddd · 2 commits',
    );
    expect(comparison([picked('x'), picked('c')], PARENTS)?.label).toBe(
      'ccccccc → xxxxxxx · 1 commit',
    );
  });

  it('compares one commit against its first parent', () => {
    expect(comparison([picked('c')], PARENTS)).toEqual({
      base: sha('b'),
      head: sha('c'),
      label: 'bbbbbbb → ccccccc · 1 commit',
    });
    expect(comparison([picked('d')], PARENTS)).toMatchObject({
      base: sha('c'),
      head: sha('d'),
      label: 'ccccccc → ddddddd · 2 commits',
    });
  });

  it('has nothing to compare for nothing picked, or the root commit alone', () => {
    expect(comparison([], PARENTS)).toBeNull();
    expect(comparison([picked('a')], PARENTS)).toBeNull();
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
