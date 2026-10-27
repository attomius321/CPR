import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchAll, GitRefused, openRepo, pull, push, syncState } from '../src/index.js';
import { createRepo, tempDir, type TestRepo } from './helpers/git-repo.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const identity = (repo: TestRepo) => {
  repo.git('config', 'user.name', 'Symbiote Test');
  repo.git('config', 'user.email', 'test@example.com');
  repo.git('config', 'commit.gpgsign', 'false');
};

/**
 * `origin`, a bare repository; `here` cloned from it on main (A ── B); `there`, another clone that
 * pushes to it.
 */
function remotes() {
  const bare = tempDir();
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', bare]);
  cleanups.push(() => rmSync(bare, { recursive: true, force: true }));
  const here = createRepo();
  cleanups.push(() => here.cleanup());
  identity(here);
  here.write({ 'a.txt': 'a\n' });
  here.commit('A');
  here.write({ 'b.txt': 'b\n' });
  here.commit('B');
  here.git('remote', 'add', 'origin', bare);
  here.git('push', '--quiet', '-u', 'origin', 'main');
  const there = createRepo();
  cleanups.push(() => there.cleanup());
  identity(there);
  there.git('remote', 'add', 'origin', bare);
  there.git('fetch', '--quiet', 'origin');
  there.git('reset', '--quiet', '--hard', 'origin/main');
  there.git('branch', '--quiet', '--set-upstream-to=origin/main');
  const commitThere = (file: string) => {
    writeFileSync(join(there.root, file), `${file}\n`);
    there.git('add', '--all');
    there.git('commit', '--quiet', '--message', file);
    there.git('push', '--quiet', 'origin', 'main');
  };
  return { here, there, commitThere };
}

describe('syncState and fetchAll (V66e)', () => {
  it("says the branch's upstream and how far apart they are, after a fetch", async () => {
    const { here, commitThere } = remotes();
    const repo = await openRepo(here.root);
    expect(await syncState(repo)).toMatchObject({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      remotes: ['origin'],
    });
    commitThere('c.txt');
    here.write({ 'mine.txt': 'mine\n' });
    here.commit('mine');
    await fetchAll(repo);
    expect(await syncState(repo)).toMatchObject({ ahead: 1, behind: 1 });
  });
});

describe('pull (V66e)', () => {
  it('fast-forwards only by default, and refuses when the branches diverged', async () => {
    const { here, commitThere } = remotes();
    const repo = await openRepo(here.root);
    commitThere('c.txt');
    expect(await pull(repo, 'ff-only')).toEqual({});
    expect(here.git('log', '-1', '--format=%s')).toBe('c.txt');
    commitThere('d.txt');
    here.write({ 'mine.txt': 'mine\n' });
    const mine = here.commit('mine');
    await expect(pull(repo, 'ff-only')).rejects.toThrow(GitRefused);
    expect(here.git('rev-parse', 'HEAD')).toBe(mine);
  });

  it('merges or rebases when asked', async () => {
    const { here, commitThere } = remotes();
    const repo = await openRepo(here.root);
    commitThere('c.txt');
    here.write({ 'mine.txt': 'mine\n' });
    here.commit('mine');
    expect(await pull(repo, 'merge')).toEqual({});
    expect(here.git('log', '-1', '--format=%P').split(' ')).toHaveLength(2);
    commitThere('d.txt');
    here.write({ 'more.txt': 'more\n' });
    here.commit('more');
    expect(await pull(repo, 'rebase')).toEqual({});
    // Linear on top of the upstream: the local commits replayed, the merge gone.
    expect(here.git('log', '-1', '--format=%s')).toBe('more');
    expect(here.git('rev-list', '--merges', 'origin/main..HEAD')).toBe('');
    expect(here.git('merge-base', '--is-ancestor', 'origin/main', 'HEAD')).toBe('');
  });

  it('says a pull that stopped on conflicts, the merge left in progress', async () => {
    const { here, commitThere } = remotes();
    const repo = await openRepo(here.root);
    commitThere('a.txt');
    here.write({ 'a.txt': 'mine\n' });
    here.commit('mine');
    const stopped = await pull(repo, 'merge');
    expect(stopped.stopped).toMatch(/conflict/i);
    expect(here.git('status', '--porcelain')).toContain('UU a.txt');
  });

  it('refuses a branch with no upstream and a detached HEAD', async () => {
    const { here } = remotes();
    const repo = await openRepo(here.root);
    here.git('switch', '--quiet', '--create', 'local');
    await expect(pull(repo, 'ff-only')).rejects.toThrow('local has no upstream');
    here.git('switch', '--quiet', '--detach', 'main');
    await expect(pull(repo, 'ff-only')).rejects.toThrow('HEAD is detached');
  });
});

describe('push (V66e)', () => {
  it('pushes the branch to its upstream; a new branch to origin, its upstream set', async () => {
    const { here, there } = remotes();
    const repo = await openRepo(here.root);
    here.write({ 'mine.txt': 'mine\n' });
    const mine = here.commit('mine');
    expect(await push(repo)).toEqual({ upstream: 'origin/main' });
    there.git('fetch', '--quiet', 'origin');
    expect(there.git('rev-parse', 'origin/main')).toBe(mine);

    here.git('switch', '--quiet', '--create', 'topic');
    here.write({ 't.txt': 't\n' });
    here.commit('t');
    expect(await push(repo)).toEqual({ upstream: 'origin/topic', set: true });
    expect(here.git('rev-parse', '--abbrev-ref', 'topic@{upstream}')).toBe('origin/topic');
  });

  it("never forces: a rejected push is said in git's words", async () => {
    const { here, commitThere } = remotes();
    const repo = await openRepo(here.root);
    commitThere('c.txt');
    here.write({ 'mine.txt': 'mine\n' });
    here.commit('mine');
    await expect(push(repo)).rejects.toThrow(/rejected|fetch first/);
  });
});
