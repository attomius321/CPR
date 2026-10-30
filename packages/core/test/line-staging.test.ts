import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRefused, openRepo, partialPatch, stageLines, workingFileDiff } from '../src/index.js';
import { createRepo, type TestRepo } from './helpers/git-repo.js';

const repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

const lines = (n: number, change: (i: number) => string | null = () => null) =>
  Array.from({ length: n }, (_, i) => change(i + 1) ?? `line ${i + 1}`).join('\n') + '\n';

/** A file of 20 lines committed, then changed at lines 2 and 15 (a removal and an addition). */
async function changed() {
  const repo = createRepo();
  repos.push(repo);
  repo.write({ 'f.txt': lines(20) });
  repo.commit('F');
  repo.write({
    'f.txt': lines(20, (i) => (i === 2 ? 'two' : i === 15 ? 'line 15\nadded' : null)),
  });
  const git = await openRepo(repo.root);
  const diff = (staged: boolean) => workingFileDiff(git, 'f.txt', staged);
  const index = async (staged: boolean) =>
    /^index .*$/m.exec((await diff(staged)) ?? '')?.[0] ?? '';
  const cached = () => repo.git('show', ':f.txt') + '\n';
  return { repo, git, diff, index, cached };
}

describe('partialPatch (decision 642)', () => {
  const diff = [
    'diff --git a/f.txt b/f.txt',
    'index 1111111..2222222 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,4 +1,4 @@',
    ' a',
    '-b',
    '+B',
    ' c',
    '-d',
    '+D',
    '',
  ].join('\n');

  it('keeps the picked changes; an added line not picked goes, a removed one stays as context', () => {
    expect(partialPatch(diff, [{ old: 2 }, { new: 2 }], false)).toBe(
      [
        'diff --git a/f.txt b/f.txt',
        'index 1111111..2222222 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,4 +1,4 @@',
        ' a',
        '-b',
        '+B',
        ' c',
        ' d',
        '',
      ].join('\n'),
    );
    expect(partialPatch(diff, [{ new: 4 }], false)).toContain(
      '@@ -1,4 +1,5 @@\n a\n b\n c\n d\n+D\n',
    );
  });

  it('reversed (unstaging), an added line not picked stays as context, a removed one goes', () => {
    expect(partialPatch(diff, [{ new: 2 }], true)).toContain('@@ -1,3 +1,4 @@\n a\n+B\n c\n D\n');
  });

  it('is null when nothing picked changes a line', () => {
    expect(partialPatch(diff, [], false)).toBeNull();
    expect(partialPatch(diff, [{ old: 1 }], false)).toBeNull();
  });
});

describe('stageLines (decision 642)', () => {
  it('stages the lines picked, the rest left on disk', async () => {
    const { git, index, cached, repo } = await changed();
    await stageLines(git, {
      path: 'f.txt',
      staged: false,
      lines: [{ old: 2 }, { new: 2 }],
      index: await index(false),
    });
    expect(cached()).toBe(lines(20, (i) => (i === 2 ? 'two' : null)));
    expect(readFileSync(join(repo.root, 'f.txt'), 'utf8')).toContain('added');
    // Then the other change, as a hunk: staged, the index is the file.
    await stageLines(git, {
      path: 'f.txt',
      staged: false,
      lines: [{ new: 16 }],
      index: await index(false),
    });
    expect(cached()).toBe(readFileSync(join(repo.root, 'f.txt'), 'utf8'));
  });

  it('unstages the lines picked from the index, the file on disk untouched', async () => {
    const { git, index, cached, repo } = await changed();
    repo.git('add', 'f.txt');
    await stageLines(git, {
      path: 'f.txt',
      staged: true,
      lines: [{ new: 16 }],
      index: await index(true),
    });
    expect(cached()).toBe(lines(20, (i) => (i === 2 ? 'two' : null)));
    expect(readFileSync(join(repo.root, 'f.txt'), 'utf8')).toContain('added');
  });

  it('refuses a diff that changed since it was read, a file not modified, and no lines', async () => {
    const { git, index, repo } = await changed();
    const seen = await index(false);
    repo.write({ 'f.txt': lines(20, (i) => (i === 3 ? 'three' : null)) });
    await expect(
      stageLines(git, { path: 'f.txt', staged: false, lines: [{ new: 3 }], index: seen }),
    ).rejects.toThrow('f.txt changed since');
    repo.write({ 'new.txt': 'n\n' });
    await expect(
      stageLines(git, { path: 'new.txt', staged: false, lines: [{ new: 1 }], index: '' }),
    ).rejects.toThrow(GitRefused);
    await expect(
      stageLines(git, { path: 'f.txt', staged: false, lines: [], index: await index(false) }),
    ).rejects.toThrow('no line');
  });
});
