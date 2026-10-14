import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commitsBetween,
  defaultBranch,
  forkPoint,
  listRefs,
  openRepo,
  trackedFiles,
  userEmail,
} from '../src/index.js';
import { createRepo, type TestRepo } from './helpers/git-repo.js';

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
    repo.write({ 'cpr/config.json': '{}\n', 'cpr/reviews/x.json': '{}\n', 'src/cpr.ts': '' });
    repo.git('add', 'cpr/config.json', 'src/cpr.ts');
    const open = await openRepo(repo.root);
    expect(await trackedFiles(open, 'cpr')).toEqual(['cpr/config.json']);
    expect(await trackedFiles(open, 'none')).toEqual([]);
  });
});
