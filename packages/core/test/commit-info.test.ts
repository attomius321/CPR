import { afterEach, describe, expect, it } from 'vitest';
import { commitFileDiff, commitInfo, commitLines, openRepo } from '../src/index.js';
import { createBranchedRepo, createRepo, type TestRepo } from './helpers/git-repo.js';

const repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

describe('commitInfo (V66b)', () => {
  it("reads a commit's message, people and files against its first parent", async () => {
    const { repo, shas } = createBranchedRepo();
    repos.push(repo);
    const info = await commitInfo(await openRepo(repo.root), shas.feature);
    expect(info).toMatchObject({
      sha: shas.feature,
      parents: [shas.root],
      author: { name: 'Symbiote Test', email: 'test@example.com' },
      committer: { name: 'Symbiote Test', email: 'test@example.com' },
      subject: 'feature work',
      body: '',
    });
    expect(info?.author.date).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(info?.files).toEqual([
      { status: 'modified', path: 'src/a.ts' },
      { status: 'added', path: 'src/added.ts' },
      { status: 'deleted', path: 'src/gone.ts' },
      { status: 'renamed', path: 'src/new.ts', previousPath: 'src/old.ts', similarity: 100 },
    ]);
  });

  it('keeps the body apart from the subject, and lists a root commit against nothing', async () => {
    const repo = createRepo();
    repos.push(repo);
    repo.write({ 'a.txt': 'one\n' });
    repo.git('add', '--all');
    repo.git('commit', '--quiet', '--message', 'Root\n\nWhy it is so.\n\nMore lines.\n');
    const sha = repo.git('rev-parse', 'HEAD');
    const info = await commitInfo(await openRepo(repo.root), sha);
    expect(info).toMatchObject({
      parents: [],
      subject: 'Root',
      body: 'Why it is so.\n\nMore lines.',
      files: [{ status: 'added', path: 'a.txt' }],
    });
  });

  it("lists a merge's files against its first parent: what it brought in", async () => {
    const { repo, shas } = createBranchedRepo();
    repos.push(repo);
    repo.git('merge', '--quiet', '--no-ff', '--no-edit', 'feature');
    const merge = repo.git('rev-parse', 'HEAD');
    const info = await commitInfo(await openRepo(repo.root), merge);
    expect(info?.parents).toEqual([shas.main, shas.feature]);
    expect(info?.files.map((f) => f.path)).toEqual([
      'src/a.ts',
      'src/added.ts',
      'src/gone.ts',
      'src/new.ts',
    ]);
  });

  it('answers null for what is not a commit of the repository, or not a full SHA', async () => {
    const { repo, shas } = createBranchedRepo();
    repos.push(repo);
    const opened = await openRepo(repo.root);
    expect(await commitInfo(opened, 'f'.repeat(40))).toBeNull();
    expect(await commitInfo(opened, shas.root.slice(0, 7))).toBeNull();
    expect(await commitInfo(opened, '--all')).toBeNull();
  });
});

describe('commitLines and commitFileDiff (V66b)', () => {
  it("counts each file's lines, and gives one file's diff against the first parent", async () => {
    const repo = createRepo();
    repos.push(repo);
    repo.write({ 'a.txt': 'one\ntwo\nthree\n', 'b.txt': 'b\n' });
    repo.commit('first');
    repo.write({ 'a.txt': 'one\n2\nthree\nfour\n' });
    const sha = repo.commit('second');
    const opened = await openRepo(repo.root);
    expect(await commitLines(opened, sha)).toEqual([{ path: 'a.txt', added: 2, removed: 1 }]);
    const diff = await commitFileDiff(opened, sha, 'a.txt');
    expect(diff).toContain('-two\n+2\n');
    expect(diff).toContain(' one\n');
    // A file the commit does not change has no diff here.
    expect(await commitFileDiff(opened, sha, 'b.txt')).toBeNull();
    expect(await commitFileDiff(opened, sha, '../outside')).toBeNull();
  });

  it("follows a rename: the file's diff from its old path", async () => {
    const { repo, shas } = createBranchedRepo();
    repos.push(repo);
    const diff = await commitFileDiff(await openRepo(repo.root), shas.feature, 'src/new.ts');
    expect(diff).toContain('rename from src/old.ts');
  });
});
