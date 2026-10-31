import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cherryPick,
  commitsLeaving,
  discardFile,
  endOperation,
  GitRefused,
  mergeInto,
  openRepo,
  rebaseOnto,
  resetTo,
  revertCommit,
  workingChanges,
} from '../src/index.js';
import { createRepo, type TestRepo } from './helpers/git-repo.js';

const repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

/** main: A ── B; topic from A: T (b.txt changed one way); main's B changes it another. */
function diverged() {
  const repo = createRepo();
  repos.push(repo);
  repo.git('config', 'user.name', 'Symbiote Test');
  repo.git('config', 'user.email', 'test@example.com');
  repo.git('config', 'commit.gpgsign', 'false');
  repo.write({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  const a = repo.commit('A');
  repo.git('switch', '--quiet', '-c', 'topic');
  repo.write({ 'b.txt': 'topic\n', 't.txt': 't\n' });
  const t = repo.commit('T');
  repo.git('switch', '--quiet', 'main');
  repo.write({ 'b.txt': 'main\n' });
  const b = repo.commit('B');
  return { repo, a, b, t };
}

const subjects = (repo: TestRepo, n: number) => repo.git('log', `-${n}`, '--format=%s').split('\n');

describe('cherryPick and revertCommit (decision 637)', () => {
  it('cherry-picks a commit onto the branch checked out, and reverts one it holds', async () => {
    const { repo } = diverged();
    repo.git('switch', '--quiet', 'topic');
    repo.write({ 'c.txt': 'c\n' });
    const c = repo.commit('C');
    repo.git('switch', '--quiet', 'main');
    const git = await openRepo(repo.root);
    expect(await cherryPick(git, c)).toEqual({});
    expect(subjects(repo, 1)).toEqual(['C']);
    expect(readFileSync(join(repo.root, 'c.txt'), 'utf8')).toBe('c\n');
    expect(await revertCommit(git, repo.git('rev-parse', 'HEAD'))).toEqual({});
    expect(subjects(repo, 1)).toEqual(['Revert "C"']);
    expect(existsSync(join(repo.root, 'c.txt'))).toBe(false);
  });

  it('stops on a conflict, the cherry-pick left in progress; Abort ends it', async () => {
    const { repo, t, b } = diverged();
    const git = await openRepo(repo.root);
    const { stopped } = await cherryPick(git, t);
    expect(stopped).toMatch(/^The cherry-pick stopped on conflicts/);
    expect((await workingChanges(git)).operation).toBe('cherry-pick');
    await expect(cherryPick(git, t)).rejects.toThrow('a cherry-pick is in progress');
    expect(await endOperation(git, 'abort')).toEqual({});
    expect((await workingChanges(git)).operation).toBeNull();
    expect(repo.git('rev-parse', 'HEAD')).toBe(b);
  });

  it('refuses a commit the branch holds already, and reverting one it does not', async () => {
    const { repo, a, t } = diverged();
    const git = await openRepo(repo.root);
    await expect(cherryPick(git, a)).rejects.toThrow(GitRefused);
    await expect(revertCommit(git, t)).rejects.toThrow(GitRefused);
    await expect(cherryPick(git, 'f'.repeat(40))).rejects.toThrow('no commit');
  });
});

describe('endOperation (decision 636)', () => {
  it('continues a cherry-pick once its conflicts are staged, with no editor', async () => {
    const { repo, t } = diverged();
    const git = await openRepo(repo.root);
    await cherryPick(git, t);
    await expect(endOperation(git, 'continue')).rejects.toThrow('1 conflicted file');
    repo.write({ 'b.txt': 'both\n' });
    repo.git('add', 'b.txt');
    expect(await endOperation(git, 'continue')).toEqual({});
    expect((await workingChanges(git)).operation).toBeNull();
    expect(subjects(repo, 1)).toEqual(['T']);
  });

  it('continues a merge as its commit, and refuses with nothing in progress', async () => {
    const { repo } = diverged();
    const git = await openRepo(repo.root);
    await expect(endOperation(git, 'continue')).rejects.toThrow('nothing is in progress');
    expect((await mergeInto(git, 'topic')).stopped).toMatch(/^The merge stopped on conflicts/);
    repo.write({ 'b.txt': 'both\n' });
    repo.git('add', 'b.txt');
    expect(await endOperation(git, 'continue')).toEqual({});
    expect(subjects(repo, 1)).toEqual(["Merge branch 'topic'"]);
    expect(repo.git('log', '-1', '--format=%P').split(' ')).toHaveLength(2);
  });

  it('continues a rebase to its end', async () => {
    const { repo, b } = diverged();
    repo.git('switch', '--quiet', 'topic');
    const git = await openRepo(repo.root);
    expect((await rebaseOnto(git, 'main')).stopped).toMatch(/^The rebase stopped on conflicts/);
    expect((await workingChanges(git)).operation).toBe('rebase');
    repo.write({ 'b.txt': 'both\n' });
    repo.git('add', 'b.txt');
    expect(await endOperation(git, 'continue')).toEqual({});
    expect((await workingChanges(git)).operation).toBeNull();
    expect(repo.git('rev-parse', 'HEAD~1')).toBe(b);
    expect(repo.git('symbolic-ref', '--short', 'HEAD')).toBe('topic');
  });
});

describe('mergeInto and rebaseOnto (decision 638)', () => {
  it('merges a branch in, fast-forward when it can', async () => {
    const { repo, t } = diverged();
    repo.git('switch', '--quiet', '-c', 'behind', 'HEAD~1');
    const git = await openRepo(repo.root);
    expect(await mergeInto(git, 'topic')).toEqual({});
    expect(repo.git('rev-parse', 'HEAD')).toBe(t);
  });

  it('rebases the branch checked out onto another', async () => {
    const { repo, b } = diverged();
    repo.git('switch', '--quiet', '-c', 'side', 'HEAD~1');
    repo.write({ 's.txt': 's\n' });
    repo.commit('S');
    const git = await openRepo(repo.root);
    expect(await rebaseOnto(git, 'main')).toEqual({});
    expect(repo.git('rev-parse', 'HEAD~1')).toBe(b);
    expect(subjects(repo, 1)).toEqual(['S']);
  });

  it('refuses the branch checked out, a detached HEAD, an unknown branch, and says git’s refusal', async () => {
    const { repo, a } = diverged();
    const git = await openRepo(repo.root);
    await expect(mergeInto(git, 'main')).rejects.toThrow('main is the branch checked out');
    await expect(mergeInto(git, 'nope')).rejects.toThrow('no branch nope');
    await expect(rebaseOnto(git, '--force')).rejects.toThrow(GitRefused);
    repo.write({ 'b.txt': 'local\n' });
    await expect(rebaseOnto(git, 'topic')).rejects.toThrow(/unstaged changes|uncommitted/);
    repo.git('checkout', '--quiet', 'b.txt');
    repo.git('switch', '--quiet', '--detach', a);
    await expect(mergeInto(git, 'topic')).rejects.toThrow('HEAD is detached');
  });
});

describe('resetTo and commitsLeaving (decision 640)', () => {
  it('moves the branch, soft keeping the changes staged and mixed unstaged; never hard', async () => {
    const { repo, a, b } = diverged();
    const git = await openRepo(repo.root);
    expect(await commitsLeaving(git, a)).toBe(1);
    await resetTo(git, a, 'soft');
    expect(repo.git('rev-parse', 'HEAD')).toBe(a);
    expect((await workingChanges(git)).staged.map((f) => f.path)).toEqual(['b.txt']);
    repo.git('reset', '--quiet', '--hard', b);
    await resetTo(git, a, 'mixed');
    const changes = await workingChanges(git);
    expect(changes.staged).toEqual([]);
    expect(changes.unstaged.map((f) => f.path)).toEqual(['b.txt']);
    expect(readFileSync(join(repo.root, 'b.txt'), 'utf8')).toBe('main\n');
    await expect(resetTo(git, a, 'hard' as 'soft')).rejects.toThrow(GitRefused);
  });
});

describe('discardFile (decision 641)', () => {
  it('puts a changed file back as the index has it, deletes a new one, and leaves what is staged', async () => {
    const { repo } = diverged();
    const git = await openRepo(repo.root);
    repo.write({ 'a.txt': 'staged\n' });
    repo.git('add', 'a.txt');
    repo.write({ 'a.txt': 'more\n', 'new.txt': 'n\n' });
    await discardFile(git, 'a.txt');
    expect(readFileSync(join(repo.root, 'a.txt'), 'utf8')).toBe('staged\n');
    expect((await workingChanges(git)).staged.map((f) => f.path)).toEqual(['a.txt']);
    await discardFile(git, 'new.txt');
    expect(existsSync(join(repo.root, 'new.txt'))).toBe(false);
    await expect(discardFile(git, 'b.txt')).rejects.toThrow('b.txt has no change to discard');
  });
});
