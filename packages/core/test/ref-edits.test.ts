import { afterEach, describe, expect, it } from 'vitest';
import {
  BranchNotMerged,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  GitRefused,
  listRefs,
  openRepo,
  renameBranch,
} from '../src/index.js';
import { createRepo, type TestRepo } from './helpers/git-repo.js';

const repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

/** main: A ── B (HEAD); topic: B ── T, merged nowhere; done: at A, merged. */
function fresh() {
  const repo = createRepo();
  repos.push(repo);
  repo.git('config', 'user.name', 'Symbiote Test');
  repo.git('config', 'user.email', 'test@example.com');
  repo.git('config', 'tag.gpgsign', 'false');
  repo.write({ 'a.txt': 'a\n' });
  const A = repo.commit('A');
  repo.write({ 'b.txt': 'b\n' });
  const B = repo.commit('B');
  repo.git('switch', '--quiet', '--create', 'topic');
  repo.write({ 't.txt': 't\n' });
  const T = repo.commit('T');
  repo.git('switch', '--quiet', 'main');
  repo.git('branch', 'done', A);
  return { repo, shas: { A, B, T } };
}

describe('createBranch (V66d)', () => {
  it('makes a branch at a commit, checked out when asked', async () => {
    const { repo, shas } = fresh();
    const opened = await openRepo(repo.root);
    expect(await createBranch(opened, { name: 'fix/one', at: shas.A })).toEqual({});
    expect(repo.git('rev-parse', 'fix/one')).toBe(shas.A);
    expect(repo.git('branch', '--show-current')).toBe('main');
    expect(await createBranch(opened, { name: 'fix/two', at: shas.B, checkout: true })).toEqual({});
    expect(repo.git('branch', '--show-current')).toBe('fix/two');
  });

  it('refuses a name git refuses or a branch has, and a commit that is not one', async () => {
    const { repo, shas } = fresh();
    const opened = await openRepo(repo.root);
    await expect(createBranch(opened, { name: 'topic', at: shas.A })).rejects.toThrow(
      'a branch topic exists',
    );
    await expect(createBranch(opened, { name: 'bad name', at: shas.A })).rejects.toThrow(
      GitRefused,
    );
    await expect(createBranch(opened, { name: '-f', at: shas.A })).rejects.toThrow(GitRefused);
    await expect(createBranch(opened, { name: 'x', at: 'f'.repeat(40) })).rejects.toThrow(
      GitRefused,
    );
  });

  it('keeps the branch made when its checkout is refused, and says why', async () => {
    const { repo, shas } = fresh();
    repo.write({ 'b.txt': 'changed here\n' });
    const made = await createBranch(await openRepo(repo.root), {
      name: 'back',
      at: shas.A,
      checkout: true,
    });
    expect(repo.git('rev-parse', 'back')).toBe(shas.A);
    expect(repo.git('branch', '--show-current')).toBe('main');
    expect(made.warning).toMatch(/b\.txt/);
  });
});

describe('renameBranch and deleteBranch (V66d)', () => {
  it('renames a branch; refuses a name taken or one that is not a branch', async () => {
    const { repo, shas } = fresh();
    const opened = await openRepo(repo.root);
    await renameBranch(opened, 'topic', 'feature/topic');
    expect(repo.git('rev-parse', 'feature/topic')).toBe(shas.T);
    await expect(renameBranch(opened, 'done', 'main')).rejects.toThrow('a branch main exists');
    await expect(renameBranch(opened, 'nope', 'x')).rejects.toThrow('no branch nope');
  });

  it('deletes a merged branch; an unmerged one only when forced, saying what it alone holds', async () => {
    const { repo } = fresh();
    const opened = await openRepo(repo.root);
    await deleteBranch(opened, 'done');
    expect((await listRefs(opened)).branches.map((b) => b.name)).toEqual(['main', 'topic']);
    const refused = await deleteBranch(opened, 'topic').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(BranchNotMerged);
    expect((refused as BranchNotMerged).only).toBe(1);
    await deleteBranch(opened, 'topic', { force: true });
    expect((await listRefs(opened)).branches.map((b) => b.name)).toEqual(['main']);
  });

  it('refuses the branch checked out', async () => {
    const { repo } = fresh();
    await expect(deleteBranch(await openRepo(repo.root), 'main', { force: true })).rejects.toThrow(
      'main is checked out',
    );
  });
});

describe('createTag and deleteTag (V66d)', () => {
  it('makes a light tag, or an annotated one with a message; deletes one', async () => {
    const { repo, shas } = fresh();
    const opened = await openRepo(repo.root);
    await createTag(opened, { name: 'v1', at: shas.A });
    await createTag(opened, { name: 'v2', at: shas.B, message: 'Second release\n\nNotes.' });
    expect(repo.git('cat-file', '-t', 'v1')).toBe('commit');
    expect(repo.git('cat-file', '-t', 'v2')).toBe('tag');
    expect(repo.git('tag', '-l', '--format=%(contents)', 'v2')).toBe('Second release\n\nNotes.');
    await expect(createTag(opened, { name: 'v1', at: shas.B })).rejects.toThrow('a tag v1 exists');
    await deleteTag(opened, 'v1');
    expect((await listRefs(opened)).tags.map((t) => t.name)).toEqual(['v2']);
    await expect(deleteTag(opened, 'v9')).rejects.toThrow('no tag v9');
  });
});
