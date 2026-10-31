import { describe, expect, it } from 'vitest';
import type { WorkingChanges } from '@symbiote/core';
import {
  changesSummary,
  changesOrder,
  commitProblem,
  followShown,
  nextMatch,
  placeOf,
  rowAfterListing,
  stepShown,
  syncWords,
  withLines,
} from '../src/history/details.js';

describe('placeOf (V66b: Settings → Appearance)', () => {
  it('puts the details on the right unless below was chosen', () => {
    expect(placeOf(null)).toBe('right');
    expect(placeOf('below')).toBe('below');
    expect(placeOf('left')).toBe('right');
  });
});

describe('withLines (V66b)', () => {
  it('gives each file its lines, a binary file none, a file git did not count its own', () => {
    const files = [
      { status: 'modified' as const, path: 'a.ts' },
      { status: 'renamed' as const, path: 'b.ts', previousPath: 'old.ts' },
      { status: 'added' as const, path: 'logo.png' },
      { status: 'untracked' as const, path: 'new.ts' },
    ];
    expect(
      withLines(files, [
        { path: 'a.ts', added: 3, removed: 1 },
        { path: 'b.ts', previousPath: 'old.ts', added: 0, removed: 0 },
        { path: 'logo.png', added: null, removed: null },
      ]),
    ).toEqual([
      { status: 'modified', path: 'a.ts', added: 3, removed: 1 },
      { status: 'renamed', path: 'b.ts', previousPath: 'old.ts', added: 0, removed: 0 },
      { status: 'added', path: 'logo.png', binary: true },
      { status: 'untracked', path: 'new.ts' },
    ]);
  });
});

describe('changesSummary and commitProblem (V66c)', () => {
  it('says how many files changed and how many are staged', () => {
    const file = (path: string) => ({ path, status: 'modified' as const });
    expect(changesSummary({ staged: [], unstaged: [file('a')], operation: null })).toBe('1 file');
    expect(
      changesSummary({ staged: [file('a')], unstaged: [file('a'), file('b')], operation: null }),
    ).toBe('2 files · 1 staged');
    expect(changesSummary({ staged: [], unstaged: [file('a')], operation: 'merge' })).toBe(
      '1 file · a merge in progress',
    );
    // Every file committed, the operation still in progress (decision 636): no "0 files".
    expect(changesSummary({ staged: [], unstaged: [], operation: 'rebase' })).toBe(
      'a rebase in progress',
    );
  });

  it('says why a commit cannot be made yet', () => {
    expect(commitProblem('Fix it', 0, false)).toBe('Stage a file to commit it');
    expect(commitProblem('  ', 2, false)).toBe('Write a message');
    expect(commitProblem('Fix it', 2, false)).toBeNull();
    // Amending keeps the last message when none is written, and may take no file.
    expect(commitProblem('', 0, true)).toBeNull();
  });
});

describe('syncWords (V66e)', () => {
  it('says where the branch is against its upstream', () => {
    const base = { branch: 'main', ahead: 0, behind: 0, remotes: ['origin'] };
    expect(syncWords({ ...base, upstream: 'origin/main' })).toBe('Up to date with origin/main');
    expect(syncWords({ ...base, upstream: 'origin/main', ahead: 2, behind: 1 })).toBe(
      '2 to push, 1 to pull, against origin/main',
    );
    expect(syncWords(base)).toBe('main has no upstream: Push sets origin/main');
    expect(syncWords({ ...base, upstream: 'origin/main', gone: true })).toBe(
      'origin/main is gone from its remote',
    );
    expect(syncWords({ ...base, branch: null })).toBe('HEAD is detached');
    expect(syncWords({ ...base, remotes: [] })).toBe(
      'main has no upstream, and there is no remote',
    );
  });
});

describe('nextMatch (V66f)', () => {
  it('steps from the cursor to the next or the previous match, round the ends', () => {
    expect(nextMatch([3, 10, 40], 0, true)).toBe(3);
    expect(nextMatch([3, 10, 40], 3, true)).toBe(10);
    expect(nextMatch([3, 10, 40], 40, true)).toBe(3);
    expect(nextMatch([3, 10, 40], 10, false)).toBe(3);
    expect(nextMatch([3, 10, 40], 3, false)).toBe(40);
    expect(nextMatch([3, 10, 40], -1, true)).toBe(3);
    expect(nextMatch([], 5, true)).toBeNull();
  });
});

describe("the file shown in the rows' place (V70)", () => {
  const changes: WorkingChanges = {
    staged: [
      { path: 'a.ts', status: 'modified' },
      { path: 'b.ts', status: 'added' },
    ],
    unstaged: [
      { path: 'a.ts', status: 'modified' },
      { path: 'c.ts', status: 'untracked' },
    ],
    operation: null,
  };

  it('orders the uncommitted files as the pane lists them: staged, then the rest', () => {
    expect(changesOrder(changes)).toEqual([
      { path: 'a.ts', staged: true },
      { path: 'b.ts', staged: true },
      { path: 'a.ts', staged: false },
      { path: 'c.ts', staged: false },
    ]);
  });

  it('steps to the next or previous file, staying at the ends, a side apart from the other', () => {
    const files = changesOrder(changes);
    expect(stepShown(files, { path: 'b.ts', staged: true }, 1)).toEqual({
      path: 'a.ts',
      staged: false,
    });
    expect(stepShown(files, { path: 'a.ts', staged: false }, -1)).toEqual({
      path: 'b.ts',
      staged: true,
    });
    expect(stepShown(files, { path: 'c.ts', staged: false }, 1)).toEqual({
      path: 'c.ts',
      staged: false,
    });
    expect(stepShown(files, { path: 'a.ts', staged: true }, -1)).toEqual({
      path: 'a.ts',
      staged: true,
    });
    // A commit's files have no side.
    const commit = [{ path: 'x.ts' }, { path: 'y.ts' }];
    expect(stepShown(commit, { path: 'x.ts' }, 1)).toEqual({ path: 'y.ts' });
    // Gone from the list: where it was is not known; it stays.
    expect(stepShown(commit, { path: 'z.ts' }, 1)).toEqual({ path: 'z.ts' });
  });

  it('follows an uncommitted file to its other side when staged or unstaged, else closes it', () => {
    expect(followShown(changes, { path: 'c.ts', staged: false })).toEqual({
      path: 'c.ts',
      staged: false,
    });
    const staged: WorkingChanges = {
      ...changes,
      staged: [...changes.staged, { path: 'c.ts', status: 'added' }],
      unstaged: [{ path: 'a.ts', status: 'modified' }],
    };
    expect(followShown(staged, { path: 'c.ts', staged: false })).toEqual({
      path: 'c.ts',
      staged: true,
    });
    expect(followShown(staged, { path: 'gone.ts', staged: true })).toBeNull();
  });
});

describe('rowAfterListing (decision 634: listed anew in place)', () => {
  it('keeps the cursor on its commit, at its new row', () => {
    expect(rowAfterListing({ cursor: 4, wasHead: false, shown: false, kept: 5, head: 0 })).toBe(5);
    expect(rowAfterListing({ cursor: 0, wasHead: true, shown: true, kept: 1, head: 0 })).toBe(1);
  });

  it('follows HEAD from HEAD when no file is shown', () => {
    expect(rowAfterListing({ cursor: 2, wasHead: true, shown: false, kept: 3, head: 0 })).toBe(0);
  });

  it('goes to HEAD when its commit is no longer listed; the uncommitted row stays', () => {
    expect(rowAfterListing({ cursor: 4, wasHead: false, shown: true, kept: null, head: 2 })).toBe(
      2,
    );
    expect(
      rowAfterListing({ cursor: 4, wasHead: false, shown: false, kept: null, head: null }),
    ).toBe(0);
    expect(rowAfterListing({ cursor: -1, wasHead: false, shown: true, kept: null, head: 3 })).toBe(
      -1,
    );
  });
});
