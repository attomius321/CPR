import type { Commit } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { comparison, graphLoaded, pick, relativeDate } from '../src/commits.js';

const sha = (c: string) => c.repeat(40);
const commit = (c: string, parents: string[]): Commit => ({
  sha: sha(c),
  parents: parents.map(sha),
  author: 'Ada',
  date: '2026-10-13T08:00:00Z',
  subject: `commit ${c}`,
  refs: [],
});

// Newest first, as listed: e ← d ← c ← b ← a, with a side branch x merged by d.
//   a ── b ── c ── d ── e
//         \── x ──/
const commits = [
  commit('e', ['d']),
  commit('d', ['c', 'x']),
  commit('x', ['b']),
  commit('c', ['b']),
  commit('b', ['a']),
  commit('a', []),
];

describe('pick', () => {
  it('picks up to two commits; a picked one is unpicked; a third replaces the last', () => {
    expect(pick([], sha('a'))).toEqual([sha('a')]);
    expect(pick([sha('a')], sha('c'))).toEqual([sha('a'), sha('c')]);
    expect(pick([sha('a'), sha('c')], sha('a'))).toEqual([sha('c')]);
    expect(pick([sha('a'), sha('c')], sha('e'))).toEqual([sha('a'), sha('e')]);
  });
});

describe('comparison', () => {
  it('takes the lower in the list (older) as the base, in either order picked', () => {
    const expected = {
      base: sha('b'),
      head: sha('e'),
      label: 'bbbbbbb → eeeeeee · 4 commits',
    };
    expect(comparison(commits, [sha('b'), sha('e')])).toEqual(expected);
    expect(comparison(commits, [sha('e'), sha('b')])).toEqual(expected);
  });

  it('counts the commits head adds to base, merged ones included', () => {
    expect(comparison(commits, [sha('c'), sha('d')])?.label).toBe('ccccccc → ddddddd · 2 commits');
    expect(comparison(commits, [sha('x'), sha('c')])?.label).toBe('ccccccc → xxxxxxx · 1 commit');
  });

  it('compares one commit against its first parent', () => {
    expect(comparison(commits, [sha('c')])).toEqual({
      base: sha('b'),
      head: sha('c'),
      label: 'bbbbbbb → ccccccc · 1 commit',
    });
    expect(comparison(commits, [sha('d')])).toMatchObject({ base: sha('c'), head: sha('d') });
  });

  it('has nothing to compare for nothing picked, or the root commit alone', () => {
    expect(comparison(commits, [])).toBeNull();
    expect(comparison(commits, [sha('a')])).toBeNull();
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
