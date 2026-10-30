import { describe, expect, it } from 'vitest';
import type { DiffRow } from '../src/diff/detail.js';
import {
  blameStarts,
  changeRuns,
  operationWords,
  picksIn,
  stashWords,
  stoppedNotice,
} from '../src/history/actions.js';

describe('operationWords (decision 636)', () => {
  it('says what is in progress and what Continue does; a bisect has no Continue', () => {
    expect(operationWords('rebase')).toEqual({
      title: 'A rebase is in progress',
      continues: 'Commits this step and goes on with the rebase',
    });
    expect(operationWords('merge').continues).toBe('Commits the merge');
    expect(operationWords('bisect')).toEqual({ title: 'A bisect is in progress', continues: null });
  });
});

describe('changeRuns and picksIn (decision 642)', () => {
  const rows: DiffRow[] = [
    { type: 'same', text: 'a', base: 1, head: 1 },
    { type: 'del', text: 'b', base: 2 },
    { type: 'add', text: 'B', head: 2 },
    { type: 'same', text: 'c', base: 3, head: 3 },
    { type: 'add', text: 'd', head: 4 },
  ];

  it('groups rows changed next to each other, each a hunk', () => {
    expect(changeRuns(rows)).toEqual([
      { start: 1, end: 3, picks: [{ old: 2 }, { new: 2 }] },
      { start: 4, end: 5, picks: [{ new: 4 }] },
    ]);
  });

  it('picks the changed rows of a set of rows, context left out', () => {
    expect(picksIn(rows, new Set([0, 2, 4]))).toEqual([{ new: 2 }, { new: 4 }]);
    expect(picksIn(rows, new Set([0, 3]))).toEqual([]);
  });
});

describe('blameStarts (decision 643)', () => {
  it("marks the first line of each run of one commit's lines", () => {
    const lines = [
      { text: 'a', sha: 'x' },
      { text: 'b', sha: 'x' },
      { text: 'c', sha: null },
      { text: 'd', sha: 'x' },
    ];
    expect([...blameStarts(lines)]).toEqual([0, 2, 3]);
  });
});

describe('stashWords and stoppedNotice (decisions 637–639)', () => {
  it("says a stash's message, git's WIP line shortened", () => {
    expect(
      stashWords({ sha: 'e', message: 'WIP on main: Add cube', branch: 'main', date: '' }),
    ).toBe('Add cube');
    expect(stashWords({ sha: 'e', message: 'Halfway', date: '' })).toBe('Halfway');
  });

  it('turns a run that stopped into a warning, else the words given', () => {
    expect(stoppedNotice({}, 'Merged topic')).toEqual({ text: 'Merged topic' });
    expect(
      stoppedNotice({ stopped: 'The merge stopped on conflicts: b.txt' }, 'Merged topic'),
    ).toEqual({
      text: 'Stopped on conflicts: resolve them in the uncommitted changes',
      warning: 'The merge stopped on conflicts: b.txt',
    });
  });
});
