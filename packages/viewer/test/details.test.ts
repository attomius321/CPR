import { describe, expect, it } from 'vitest';
import {
  changesSummary,
  commitProblem,
  nextMatch,
  placeOf,
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
