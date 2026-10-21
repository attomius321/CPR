import { afterEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import {
  checkMerge,
  commitsBetween,
  defaultBranch,
  defaultBranchTips,
  forkPoint,
  isAncestor,
  listRefs,
  openRepo,
  trackedFiles,
  upstreamOf,
  userEmail,
} from '../src/index.js';
import { createRepo, tempDir, type TestRepo } from './helpers/git-repo.js';

/**
 * main: A ── B ── M; wip: B ── W1 ── W2 (an agent's branch); a remote `origin` (never fetched)
 * with origin/main at B and origin/HEAD naming it.
 */
function branchRepo() {
  const repo = createRepo();
  const commit = (name: string) => {
    repo.write({ [`${name}.ts`]: `export const ${name} = 1;\n` });
    return repo.commit(name);
  };
  const A = commit('A');
  const B = commit('B');
  repo.git('switch', '--quiet', '--create', 'wip');
  const W1 = commit('W1');
  const W2 = commit('W2');
  repo.git('switch', '--quiet', 'main');
  const M = commit('M');
  repo.git('remote', 'add', 'origin', 'https://example.com/never-fetched.git');
  repo.git('update-ref', 'refs/remotes/origin/main', B);
  repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  return { repo, shas: { A, B, W1, W2, M } };
}

const repos: TestRepo[] = [];
const fresh = () => {
  const made = branchRepo();
  repos.push(made.repo);
  return made;
};
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
  vi.unstubAllEnvs();
});

describe('defaultBranch', () => {
  it("is origin/HEAD's branch, else main, else master, else none", async () => {
    const { repo } = fresh();
    const open = await openRepo(repo.root);
    expect(await defaultBranch(open, await listRefs(open))).toBe('main');

    repo.git('symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
    repo.git('branch', '--move', 'main', 'trunk');
    repo.git('update-ref', '-d', 'refs/remotes/origin/main');
    expect(await defaultBranch(open, await listRefs(open))).toBeNull();
    repo.git('branch', 'master', 'trunk');
    expect(await defaultBranch(open, await listRefs(open))).toBe('master');
    repo.git('branch', 'main', 'trunk');
    expect(await defaultBranch(open, await listRefs(open))).toBe('main');
  });
});

describe('defaultBranchTips', () => {
  it("names the default branch and its tips: the local branch's and each remote's", async () => {
    const { repo, shas } = fresh();
    const open = await openRepo(repo.root);
    expect(await defaultBranchTips(open)).toEqual({ name: 'main', tips: [shas.M, shas.B] });
    // One commit, one tip.
    repo.git('update-ref', 'refs/remotes/origin/main', shas.M);
    expect(await defaultBranchTips(open)).toEqual({ name: 'main', tips: [shas.M] });
    // Without a default branch, none.
    repo.git('symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
    repo.git('branch', '--move', 'main', 'trunk');
    repo.git('update-ref', '-d', 'refs/remotes/origin/main');
    expect(await defaultBranchTips(open)).toBeNull();
  });
});

describe('forkPoint', () => {
  it('is where a branch left the default branch, after main moved on', async () => {
    const { repo, shas } = fresh();
    const open = await openRepo(repo.root);
    expect(await forkPoint(open, shas.W2, 'main', await listRefs(open))).toBe(shas.B);
  });

  it('takes the latest of the local and remote default branches', async () => {
    const { repo, shas } = fresh();
    // The agent branched from origin/main, which is ahead of a stale local main.
    repo.git('update-ref', 'refs/remotes/origin/main', shas.M);
    repo.git('switch', '--quiet', '--create', 'agent', shas.M);
    repo.git('branch', '--force', 'main', shas.B);
    repo.write({ 'agent.ts': 'export const agent = 1;\n' });
    const tip = repo.commit('agent');
    const open = await openRepo(repo.root);
    expect(await forkPoint(open, tip, 'main', await listRefs(open))).toBe(shas.M);
  });

  it('moves with a rebase', async () => {
    const { repo, shas } = fresh();
    repo.git('switch', '--quiet', 'wip');
    repo.git('rebase', '--quiet', 'main');
    const open = await openRepo(repo.root);
    const tip = repo.git('rev-parse', 'wip');
    expect(await forkPoint(open, tip, 'main', await listRefs(open))).toBe(shas.M);
  });

  it('is the tip itself once merged, and null without a common ancestor', async () => {
    const { repo, shas } = fresh();
    const open = await openRepo(repo.root);
    expect(await forkPoint(open, shas.A, 'main', await listRefs(open))).toBe(shas.A);
    repo.git('switch', '--quiet', '--orphan', 'lonely');
    repo.write({ 'lonely.ts': 'export {};\n' });
    const lonely = repo.commit('lonely');
    expect(await forkPoint(open, lonely, 'main', await listRefs(open))).toBeNull();
    expect(await forkPoint(open, lonely, 'nope', await listRefs(open))).toBeNull();
  });
});

describe('commitsBetween', () => {
  it('lists the commits of one tip not on another, newest first, and counts them', async () => {
    const { repo, shas } = fresh();
    const open = await openRepo(repo.root);
    expect(await commitsBetween(open, shas.B, shas.W2)).toEqual({
      count: 2,
      shas: [shas.W2, shas.W1],
    });
    expect(await commitsBetween(open, shas.B, shas.W2, 1)).toEqual({ count: 2, shas: [shas.W2] });
    expect(await commitsBetween(open, shas.W2, shas.W2)).toEqual({ count: 0, shas: [] });
  });

  it('leaves out commits another ref has: the default branch merged into a branch (V17)', async () => {
    const { repo, shas } = fresh();
    const open = await openRepo(repo.root);
    // Reviewed at W2; then main (M) is merged into wip: one commit of wip's own, the merge.
    repo.git('switch', '--quiet', 'wip');
    repo.git('merge', '--quiet', '--no-edit', 'main');
    const merge = repo.git('rev-parse', 'HEAD');
    expect((await commitsBetween(open, shas.W2, merge)).count).toBe(2);
    expect(await commitsBetween(open, shas.W2, merge, 100, ['main', 'origin/main'])).toEqual({
      count: 1,
      shas: [merge],
    });
  });
});

describe('isAncestor', () => {
  it('says whether a commit is in another', async () => {
    const { repo, shas } = fresh();
    const open = await openRepo(repo.root);
    expect(await isAncestor(open, shas.B, shas.W2)).toBe(true);
    expect(await isAncestor(open, shas.W2, 'main')).toBe(false);
  });
});

describe('checkMerge', () => {
  it('says a merge is clean, or names the conflicting files, touching nothing (V17)', async () => {
    const { repo, shas } = fresh();
    const open = await openRepo(repo.root);
    const status = () => repo.git('status', '--porcelain', '--untracked-files=all');
    const heads = () => repo.git('for-each-ref', '--format=%(refname) %(objectname)');
    const before = { status: status(), heads: heads() };
    expect(await checkMerge(open, 'main', shas.W2)).toEqual({ clean: true });

    // Both sides change the same line of B.ts.
    repo.write({ 'B.ts': 'export const B = 2;\n' });
    repo.commit('main changes B');
    repo.git('switch', '--quiet', 'wip');
    repo.write({ 'B.ts': 'export const B = 3;\n', 'A.ts': 'export const A = 3;\n' });
    const tip = repo.commit('wip changes B');
    repo.git('switch', '--quiet', 'main');
    repo.write({ 'A.ts': 'export const A = 2;\n' });
    repo.commit('main changes A');
    const after = { status: status(), heads: heads() };
    expect(await checkMerge(open, 'main', tip)).toEqual({ conflicts: ['A.ts', 'B.ts'] });
    // Nothing moved: no ref, no file, no index.
    expect({ status: status(), heads: heads() }).toEqual(after);
    expect(before.status).toBe('');

    expect(await checkMerge(open, 'nope', tip)).toEqual({ error: expect.any(String) as string });
  });
});

describe('userEmail', () => {
  it("is the repository's user.email, or null", async () => {
    // The developer's own config must not leak in.
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    const { repo } = fresh();
    const open = await openRepo(repo.root);
    expect(await userEmail(open)).toBeNull();
    repo.git('config', 'user.email', 'ada@example.com');
    expect(await userEmail(open)).toBe('ada@example.com');
  });
});

describe('trackedFiles', () => {
  it('lists what git tracks in a folder, from anywhere in the repository', async () => {
    const { repo } = fresh();
    repo.write({
      'symbiote/config.json': '{}\n',
      'symbiote/reviews/x.json': '{}\n',
      'src/symbiote.ts': '',
    });
    repo.git('add', 'symbiote/config.json', 'src/symbiote.ts');
    const open = await openRepo(repo.root);
    expect(await trackedFiles(open, 'symbiote')).toEqual(['symbiote/config.json']);
    expect(await trackedFiles(open, 'none')).toEqual([]);
  });
});

/** The repository of `branchRepo`, with a bare `origin` holding main at B, tracked by main. */
function pushRepo() {
  const made = fresh();
  const bare = tempDir();
  made.repo.git('init', '--quiet', '--bare', bare);
  made.repo.git('remote', 'set-url', 'origin', bare);
  made.repo.git('push', '--quiet', 'origin', `${made.shas.B}:refs/heads/main`);
  made.repo.git('fetch', '--quiet', 'origin');
  made.repo.git('branch', '--set-upstream-to=origin/main', 'main');
  bares.push(bare);
  return made;
}
const bares: string[] = [];
afterEach(() => {
  for (const bare of bares.splice(0)) rmSync(bare, { recursive: true, force: true });
});

describe('upstreamOf', () => {
  it("names a branch's remote and its name there", async () => {
    const { repo, shas } = pushRepo();
    const open = await openRepo(repo.root);
    expect(await upstreamOf(open, 'main')).toEqual({
      remote: 'origin',
      branch: 'main',
      sha: shas.B,
    });
    expect(await upstreamOf(open, 'wip')).toBeNull();
    expect(await upstreamOf(open, 'nope')).toBeNull();
  });
});
