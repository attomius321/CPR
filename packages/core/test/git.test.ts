import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CprError,
  firstChangedLine,
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
      new CprError("unknown revision 'nope'"),
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
    await expect(openRepo(tempDir())).rejects.toBeInstanceOf(CprError);
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

describe('listLineCounts and firstChangedLine (V29d)', () => {
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

  it("finds a file's first change in the working copy against a commit", async () => {
    const git = await openRepo(repo.root);
    repo.git('switch', '--quiet', 'feature');
    try {
      writeFileSync(
        join(repo.root, 'src', 'new.ts'),
        'export function old() {\n  return "a body long enough for rename detection";\n}\nexport const more = 1;\n',
      );
      // Committed and uncommitted changes alike; a rename found through both of its paths.
      expect(await firstChangedLine(git, shas.root, ['src/a.ts'])).toBe(1);
      expect(await firstChangedLine(git, shas.root, ['src/new.ts', 'src/old.ts'])).toBe(4);
      // Its new path alone: the whole file is new, from its first line.
      expect(await firstChangedLine(git, shas.root, ['src/new.ts'])).toBe(1);
      // Only lines removed: the line before them.
      writeFileSync(join(repo.root, 'src', 'a.ts'), '');
      expect(await firstChangedLine(git, shas.feature, ['src/a.ts'])).toBe(1);
      // No change, or a file git does not track: none.
      expect(await firstChangedLine(git, shas.feature, ['src/added.ts'])).toBeNull();
      writeFileSync(join(repo.root, 'src', 'loose.ts'), '1;\n');
      expect(await firstChangedLine(git, shas.feature, ['src/loose.ts'])).toBeNull();
    } finally {
      repo.git('checkout', '--quiet', '--', '.');
      repo.git('clean', '--quiet', '--force');
      repo.git('switch', '--quiet', 'main');
    }
  });
});
