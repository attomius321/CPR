import { afterAll, describe, expect, it } from 'vitest';
import {
  CprError,
  listChangedFiles,
  NoMergeBaseError,
  openRepo,
  parseNameStatus,
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
