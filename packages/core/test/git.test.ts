import { afterAll, describe, expect, it } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SymbioteError,
  fileChangedSince,
  fileForCheckout,
  listChangedFiles,
  listChangedLines,
  listLineCounts,
  NoMergeBaseError,
  openRepo,
  parseChangedLines,
  parseNameStatus,
  parseNumstat,
  resolveRevisions,
  type ChangedFile,
} from '../src/index.js';
import { createBranchedRepo, createRepo, tempDir } from './helpers/git-repo.js';

const byPath = (files: ChangedFile[]) => [...files].sort((a, b) => a.path.localeCompare(b.path));

describe('resolveRevisions + listChangedFiles', () => {
  const { repo, shas } = createBranchedRepo();
  afterAll(() => repo.cleanup());

  it('compares against the merge-base by default', async () => {
    const revisions = await resolveRevisions(await openRepo(repo.root), 'main', 'feature');
    expect(revisions).toEqual({
      base: { ref: 'main', sha: shas.main, mergeBase: shas.root },
      head: { ref: 'feature', sha: shas.feature },
      from: shas.root,
    });
  });

  it('lists only files changed on the branch, with renames', async () => {
    const gitRepo = await openRepo(repo.root);
    const { from, head } = await resolveRevisions(gitRepo, 'main', 'feature');
    expect(byPath(await listChangedFiles(gitRepo, from, head.sha))).toEqual([
      { status: 'modified', path: 'src/a.ts' },
      { status: 'added', path: 'src/added.ts' },
      { status: 'deleted', path: 'src/gone.ts' },
      { status: 'renamed', path: 'src/new.ts', previousPath: 'src/old.ts', similarity: 100 },
    ]);
  });

  it('compares against base directly when merge-base is off', async () => {
    const gitRepo = await openRepo(repo.root);
    const revisions = await resolveRevisions(gitRepo, 'main', 'feature', { mergeBase: false });
    expect(revisions.base.mergeBase).toBeNull();
    expect(revisions.from).toBe(shas.main);

    const files = await listChangedFiles(gitRepo, revisions.from, revisions.head.sha);
    expect(files).toContainEqual({ status: 'deleted', path: 'src/main-only.ts' });
  });

  it('works from a subdirectory', async () => {
    expect((await openRepo(`${repo.root}/src`)).root).toBe(repo.root);
  });

  it('rejects unknown refs', async () => {
    const gitRepo = await openRepo(repo.root);
    await expect(resolveRevisions(gitRepo, 'main', 'nope')).rejects.toThrow(
      new SymbioteError("unknown revision 'nope'"),
    );
  });

  it('never reads a ref as a git option', async () => {
    const gitRepo = await openRepo(repo.root);
    await expect(resolveRevisions(gitRepo, '--output=/tmp/x', 'main')).rejects.toThrow(
      "unknown revision '--output=/tmp/x'",
    );
  });
});

describe('errors', () => {
  it('reports branches without a common ancestor', async () => {
    const repo = createRepo();
    try {
      repo.write({ 'a.txt': 'a\n' });
      repo.commit('main');
      repo.git('switch', '--quiet', '--orphan', 'lonely');
      repo.write({ 'b.txt': 'b\n' });
      repo.commit('lonely');

      const gitRepo = await openRepo(repo.root);
      await expect(resolveRevisions(gitRepo, 'main', 'lonely')).rejects.toBeInstanceOf(
        NoMergeBaseError,
      );
    } finally {
      repo.cleanup();
    }
  });

  it('reports folders outside a git repo', async () => {
    await expect(openRepo(tempDir())).rejects.toBeInstanceOf(SymbioteError);
  });
});

describe('parseNameStatus', () => {
  it('handles spaces, tabs and renames', () => {
    expect(parseNameStatus('M\0src/a b.ts\0R087\0old\tname.ts\0new name.ts\0T\0link\0')).toEqual([
      { status: 'modified', path: 'src/a b.ts' },
      { status: 'renamed', path: 'new name.ts', previousPath: 'old\tname.ts', similarity: 87 },
      { status: 'type-changed', path: 'link' },
    ]);
  });

  it('returns nothing for empty output', () => {
    expect(parseNameStatus('')).toEqual([]);
  });

  it('rejects unknown status codes', () => {
    expect(() => parseNameStatus('X\0file\0')).toThrow("unexpected git diff status 'X'");
  });
});

describe('listChangedLines', () => {
  const { repo, shas } = createBranchedRepo();
  afterAll(() => repo.cleanup());

  it('lists removed and added lines per side, renames under their own paths', async () => {
    const lines = await listChangedLines(await openRepo(repo.root), shas.root, shas.feature);
    expect(Object.fromEntries(lines.base)).toEqual({ 'src/a.ts': [1], 'src/gone.ts': [1] });
    expect(Object.fromEntries(lines.head)).toEqual({ 'src/a.ts': [1], 'src/added.ts': [1] });
  });
});

describe('parseChangedLines', () => {
  const patch = [
    'diff --git a/src/x.ts b/src/y.ts',
    'similarity index 80%',
    'rename from src/x.ts',
    'rename to src/y.ts',
    '--- a/src/x.ts',
    '+++ b/src/y.ts',
    '@@ -3,2 +3 @@ function f() {',
    '--- a removed SQL comment, not a header',
    '-  old();',
    '+  next();',
    '@@ -10,0 +10,2 @@',
    '+a',
    '+b',
    String.raw`diff --git "a/caf\303\251 \"q\".ts" "b/caf\303\251 \"q\".ts"`,
    'new file mode 100644',
    '--- /dev/null',
    String.raw`+++ "b/caf\303\251 \"q\".ts"`,
    '@@ -0,0 +1 @@',
    '+x',
    '',
  ].join('\n');

  it('reads hunks, renames, new files and quoted names', () => {
    const lines = parseChangedLines(patch);
    expect(Object.fromEntries(lines.base)).toEqual({ 'src/x.ts': [3, 4] });
    expect(Object.fromEntries(lines.head)).toEqual({
      'src/y.ts': [3, 10, 11],
      'café "q".ts': [1],
    });
  });
});

describe('parseNumstat (V29d)', () => {
  it('reads lines per file: renames under both paths, binary files as null, spaces and tabs', () => {
    const output = [
      '3\t1\tsrc/a b.ts',
      '0\t0\t',
      'old\tname.ts',
      'new name.ts',
      '-\t-\tlogo.png',
      '12\t0\tsrc/added.ts',
      '',
    ].join('\0');
    expect(parseNumstat(output)).toEqual([
      { path: 'src/a b.ts', added: 3, removed: 1 },
      { path: 'new name.ts', previousPath: 'old\tname.ts', added: 0, removed: 0 },
      { path: 'logo.png', added: null, removed: null },
      { path: 'src/added.ts', added: 12, removed: 0 },
    ]);
    expect(parseNumstat('')).toEqual([]);
  });

  it('rejects output it cannot read', () => {
    expect(() => parseNumstat('3\tsrc/a.ts\0')).toThrow('unexpected git diff --numstat record');
  });
});

describe('listLineCounts (V29d)', () => {
  const { repo, shas } = createBranchedRepo();
  afterAll(() => repo.cleanup());

  it("counts each file's lines between two commits, renames detected", async () => {
    const counts = await listLineCounts(await openRepo(repo.root), shas.root, shas.feature);
    expect([...counts].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'src/a.ts', added: 1, removed: 1 },
      { path: 'src/added.ts', added: 1, removed: 0 },
      { path: 'src/gone.ts', added: 0, removed: 1 },
      { path: 'src/new.ts', previousPath: 'src/old.ts', added: 0, removed: 0 },
    ]);
  });

  it('counts the working copy against a commit without a second one: tracked files only', async () => {
    const git = await openRepo(repo.root);
    repo.write({
      'src/main-only.ts': 'export {};\nexport const x = 1;\n',
      'src/untracked.ts': '1;\n',
    });
    try {
      expect(await listLineCounts(git, 'HEAD')).toEqual([
        { path: 'src/main-only.ts', added: 1, removed: 0 },
      ]);
    } finally {
      repo.git('checkout', '--quiet', '--', 'src/main-only.ts');
      repo.git('clean', '--quiet', '--force', '--', 'src/untracked.ts');
    }
  });
});

describe('fileForCheckout and fileChangedSince (V43)', () => {
  const repo = createRepo();
  afterAll(() => repo.cleanup());
  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a, 0x1a]);
  repo.write({
    '.gitattributes': 'crlf.txt text eol=crlf\n',
    'src/a.ts': 'export const a = 1;\n',
    'crlf.txt': 'one\ntwo\n',
  });
  writeFileSync(join(repo.root, 'logo.png'), binary);
  repo.commit('Files');
  // A submodule's entry (a gitlink), without the submodule itself.
  const pinned = repo.git('rev-parse', 'HEAD');
  repo.git('update-index', '--add', '--cacheinfo', `160000,${pinned},vendor/lib`);
  repo.git('commit', '--quiet', '--message', 'Submodule');
  const sha = repo.git('rev-parse', 'HEAD');

  it("gives a file's bytes at a commit as a checkout writes them", async () => {
    const git = await openRepo(repo.root);
    expect((await fileForCheckout(git, sha, 'src/a.ts'))?.toString()).toBe('export const a = 1;\n');
    expect(await fileForCheckout(git, sha, 'logo.png')).toEqual(binary);
    // Its line endings as the worktree's attributes have them, not the blob's.
    expect((await fileForCheckout(git, sha, 'crlf.txt'))?.toString()).toBe('one\r\ntwo\r\n');
    // A submodule as git diff shows it.
    expect((await fileForCheckout(git, sha, 'vendor/lib'))?.toString()).toBe(
      `Subproject commit ${pinned}\n`,
    );
  });

  it('gives none for a path that is not a file at that commit', async () => {
    const git = await openRepo(repo.root);
    expect(await fileForCheckout(git, sha, 'src/gone.ts')).toBeNull();
    expect(await fileForCheckout(git, sha, 'src')).toBeNull();
    expect(await fileForCheckout(git, pinned, 'vendor/lib')).toBeNull();
  });

  it("says whether the working copy's file differs from a commit's", async () => {
    const git = await openRepo(repo.root);
    expect(await fileChangedSince(git, sha, 'src/a.ts')).toBe(false);
    try {
      repo.write({ 'src/a.ts': 'export const a = 2;\n' });
      expect(await fileChangedSince(git, sha, 'src/a.ts')).toBe(true);
      // Staged, then put back in the working copy: what is on the disk counts.
      repo.git('add', 'src/a.ts');
      repo.write({ 'src/a.ts': 'export const a = 1;\n' });
      expect(await fileChangedSince(git, sha, 'src/a.ts')).toBe(false);
      rmSync(join(repo.root, 'src', 'a.ts'));
      expect(await fileChangedSince(git, sha, 'src/a.ts')).toBe(true);
    } finally {
      repo.git('reset', '--quiet', '--hard');
    }
  });
});
