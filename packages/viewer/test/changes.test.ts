import type { WorkspaceFileChange } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  commitTitle,
  fileTitle,
  linesOf,
  moreText,
  opensInEditor,
  sinceText,
  splitPath,
  statusLetter,
} from '../src/workspaces/changes.js';

// A workspace's changes panel (V29d): the words of its rows.
const file = (over: Partial<WorkspaceFileChange>): WorkspaceFileChange => ({
  status: 'modified',
  path: 'src/a.ts',
  ...over,
});

describe('statusLetter', () => {
  it("gives each status the letter VS Code's source control shows", () => {
    expect(
      (
        [
          'added',
          'modified',
          'deleted',
          'renamed',
          'copied',
          'type-changed',
          'untracked',
          'conflicted',
        ] as const
      ).map(statusLetter),
    ).toEqual(['A', 'M', 'D', 'R', 'C', 'T', 'U', '!']);
  });
});

describe('splitPath', () => {
  it("splits a path into its file's name and its folder", () => {
    expect(splitPath('packages/viewer/src/App.tsx')).toEqual({
      name: 'App.tsx',
      folder: 'packages/viewer/src',
    });
    expect(splitPath('README.md')).toEqual({ name: 'README.md', folder: '' });
  });
});

describe('linesOf', () => {
  it('says the lines added and removed, a binary file as such, nothing when not known', () => {
    expect(linesOf(file({ added: 12, removed: 3 }))).toEqual({ added: '+12', removed: '−3' });
    expect(linesOf(file({ added: 0, removed: 1 }))).toEqual({ added: '+0', removed: '−1' });
    expect(linesOf(file({ binary: true }))).toBe('binary');
    expect(linesOf(file({ status: 'untracked' }))).toBeNull();
  });
});

describe('opensInEditor', () => {
  it('opens every file but one deleted', () => {
    expect(opensInEditor(file({}))).toBe(true);
    expect(opensInEditor(file({ status: 'untracked' }))).toBe(true);
    expect(opensInEditor(file({ status: 'deleted' }))).toBe(false);
  });
});

describe('fileTitle', () => {
  it('names the file, its status and lines, and what a click does', () => {
    expect(fileTitle(file({ added: 1, removed: 0 }))).toBe(
      'src/a.ts · modified · +1 −0. Opens in VS Code at its first change',
    );
    expect(
      fileTitle(
        file({
          status: 'renamed',
          path: 'src/b.ts',
          previousPath: 'src/a.ts',
          added: 0,
          removed: 0,
        }),
      ),
    ).toBe('src/a.ts → src/b.ts · renamed · +0 −0. Opens in VS Code at its first change');
    expect(fileTitle(file({ status: 'untracked', path: 'notes.md' }))).toBe(
      'notes.md · new, not tracked by git yet. Opens in VS Code',
    );
    expect(fileTitle(file({ status: 'deleted', added: 0, removed: 4 }))).toBe(
      'src/a.ts · deleted · +0 −4',
    );
    expect(fileTitle(file({ status: 'conflicted' }))).toBe(
      'src/a.ts · in conflict. Opens in VS Code at its first change',
    );
    expect(fileTitle(file({ binary: true }))).toBe(
      'src/a.ts · modified · binary. Opens in VS Code at its first change',
    );
  });
});

describe('sinceText, moreText and commitTitle', () => {
  it('says where the commits start, how many are not listed, and a commit in full', () => {
    expect(sinceText('main')).toBe('since main');
    expect(sinceText(undefined)).toBe('since it started');
    expect(moreText(301, 300)).toBe('and 1 more');
    expect(moreText(2, 2)).toBeNull();
    expect(
      commitTitle({
        sha: 'a'.repeat(40),
        subject: 'Add half',
        author: 'Ada',
        date: '2026-10-20T16:15:00+02:00',
      }),
    ).toMatch(/^aaaaaaa Add half\nAda, .*2026/);
  });
});
