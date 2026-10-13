import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkout,
  CheckoutRefused,
  listRefs,
  openRepo,
  UnknownCheckoutTarget,
  workingState,
} from '../src/index.js';
import { createRepo, tempDir, type TestRepo } from './helpers/git-repo.js';

/**
 * main: A ── B (HEAD), annotated tag v1 on A; wip: B ── W; a remote `origin` (never fetched)
 * with origin/topic at T (from A) and origin/wip at B.
 */
function refsRepo() {
  const repo = createRepo();
  const commit = (name: string, content = `export const ${name} = 1;\n`) => {
    repo.write({ [`${name}.ts`]: content });
    return repo.commit(name);
  };
  const A = commit('A');
  repo.git('tag', '--annotate', '--message', 'one', 'v1', A);
  const B = commit('B');
  repo.git('switch', '--quiet', '--create', 'wip');
  const W = commit('W');
  repo.git('switch', '--quiet', '--detach', A);
  const T = commit('T');
  repo.git('switch', '--quiet', 'main');
  repo.git('remote', 'add', 'origin', 'https://example.com/never-fetched.git');
  repo.git('update-ref', 'refs/remotes/origin/topic', T);
  repo.git('update-ref', 'refs/remotes/origin/wip', B);
  repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/topic');
  return { repo, shas: { A, B, W, T } };
}

const repos: TestRepo[] = [];
const fresh = () => {
  const made = refsRepo();
  repos.push(made.repo);
  return made;
};
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});
const head = (repo: TestRepo) => repo.git('rev-parse', 'HEAD');
const branch = (repo: TestRepo) => repo.git('branch', '--show-current');

describe('listRefs', () => {
  it('lists branches with their upstream, remote branches by remote, tags at their commit', async () => {
    const { repo, shas } = fresh();
    repo.git('branch', '--set-upstream-to', 'origin/wip', 'wip');
    const refs = await listRefs(await openRepo(repo.root));
    expect(refs.branches).toEqual([
      { name: 'main', sha: shas.B },
      { name: 'wip', sha: shas.W, upstream: 'origin/wip', ahead: 1, behind: 0 },
    ]);
    // A remote's HEAD only names its default branch.
    expect(refs.remotes).toEqual([
      { name: 'origin/topic', remote: 'origin', branch: 'topic', sha: shas.T },
      { name: 'origin/wip', remote: 'origin', branch: 'wip', sha: shas.B },
    ]);
    expect(refs.tags).toEqual([{ name: 'v1', sha: shas.A }]);
  });

  it('says when an upstream is gone', async () => {
    const { repo } = fresh();
    repo.git('branch', '--set-upstream-to', 'origin/wip', 'wip');
    repo.git('update-ref', '-d', 'refs/remotes/origin/wip');
    const refs = await listRefs(await openRepo(repo.root));
    expect(refs.branches.find((b) => b.name === 'wip')).toMatchObject({
      upstream: 'origin/wip',
      gone: true,
    });
  });
});

describe('workingState', () => {
  it('counts tracked files with local changes, not untracked ones', async () => {
    const { repo } = fresh();
    const git = await openRepo(repo.root);
    expect(await workingState(git)).toEqual({ changed: 0, operation: null });
    repo.write({ 'A.ts': 'changed\n', 'B.ts': 'changed\n', 'new.ts': 'untracked\n' });
    expect(await workingState(git)).toEqual({ changed: 2, operation: null });
  });

  it('names a merge, a cherry-pick and a bisect in progress', async () => {
    const { repo, shas } = fresh();
    const git = await openRepo(repo.root);
    // main and side change the same file differently: merging stops on the conflict.
    repo.write({ 'B.ts': 'main side\n' });
    repo.commit('main side');
    repo.git('switch', '--quiet', '--create', 'side', shas.B);
    repo.write({ 'B.ts': 'other side\n' });
    const other = repo.commit('other side');
    repo.git('switch', '--quiet', 'main');
    expect(() => repo.git('merge', '--quiet', 'side')).toThrow();
    expect((await workingState(git)).operation).toBe('merge');
    repo.git('merge', '--abort');

    expect(() => repo.git('cherry-pick', other)).toThrow();
    expect((await workingState(git)).operation).toBe('cherry-pick');
    repo.git('cherry-pick', '--abort');

    repo.git('bisect', 'start');
    expect((await workingState(git)).operation).toBe('bisect');
    repo.git('bisect', 'reset');
    expect((await workingState(git)).operation).toBeNull();
  });
});

describe('checkout', () => {
  it('checks out a local branch', async () => {
    const { repo, shas } = fresh();
    const result = await checkout(await openRepo(repo.root), { kind: 'branch', name: 'wip' });
    expect(result).toEqual({ branch: 'wip', head: shas.W });
    expect(branch(repo)).toBe('wip');
  });

  it('checks out a remote branch as a new local branch tracking it', async () => {
    const { repo, shas } = fresh();
    const result = await checkout(await openRepo(repo.root), {
      kind: 'remote',
      name: 'origin/topic',
    });
    expect(result).toEqual({ branch: 'topic', head: shas.T, created: true });
    expect(repo.git('rev-parse', '--abbrev-ref', 'topic@{upstream}')).toBe('origin/topic');
  });

  it('checks out the local branch already tracking a remote branch', async () => {
    const { repo, shas } = fresh();
    repo.git('branch', '--set-upstream-to', 'origin/wip', 'wip');
    const result = await checkout(await openRepo(repo.root), {
      kind: 'remote',
      name: 'origin/wip',
    });
    // The local branch, where it is (one commit ahead of origin/wip).
    expect(result).toEqual({ branch: 'wip', head: shas.W });
  });

  it('refuses a remote branch whose local name tracks something else', async () => {
    const { repo, shas } = fresh();
    const git = await openRepo(repo.root);
    await expect(checkout(git, { kind: 'remote', name: 'origin/wip' })).rejects.toThrow(
      new CheckoutRefused(
        'a local branch wip exists and does not track origin/wip: check it out instead',
      ),
    );
    expect(head(repo)).toBe(shas.B);
  });

  it('detaches HEAD at a tag (its commit) or a commit', async () => {
    const { repo, shas } = fresh();
    const git = await openRepo(repo.root);
    expect(await checkout(git, { kind: 'tag', name: 'v1' })).toEqual({
      branch: null,
      head: shas.A,
    });
    expect(branch(repo)).toBe('');
    expect(await checkout(git, { kind: 'commit', sha: shas.T })).toEqual({
      branch: null,
      head: shas.T,
    });
  });

  it('carries a local change the target leaves alone', async () => {
    const { repo, shas } = fresh();
    repo.write({ 'A.ts': 'local change\n' });
    await checkout(await openRepo(repo.root), { kind: 'branch', name: 'wip' });
    expect(head(repo)).toBe(shas.W);
    expect(repo.git('status', '--porcelain')).toBe('M A.ts');
  });

  it("refuses with git's message when the target would overwrite a local change", async () => {
    const { repo, shas } = fresh();
    repo.write({ 'B.ts': 'local change\n' });
    await expect(
      checkout(await openRepo(repo.root), { kind: 'commit', sha: shas.A }),
    ).rejects.toThrow(/Your local changes to the following files would be overwritten[\s\S]*B\.ts/);
    expect(head(repo)).toBe(shas.B);
    expect(repo.git('status', '--porcelain')).toBe('M B.ts');
  });

  it('refuses a branch checked out in another worktree', async () => {
    const { repo } = fresh();
    const other = join(tempDir(), 'other');
    repo.git('worktree', 'add', '--quiet', other, 'wip');
    await expect(
      checkout(await openRepo(repo.root), { kind: 'branch', name: 'wip' }),
    ).rejects.toThrow(/already used by worktree/);
    expect(branch(repo)).toBe('main');
  });

  it('refuses while a merge is in progress', async () => {
    const { repo, shas } = fresh();
    repo.write({ 'B.ts': 'main side\n' });
    repo.commit('main side');
    repo.git('switch', '--quiet', '--create', 'side', shas.B);
    repo.write({ 'B.ts': 'other side\n' });
    repo.commit('other side');
    repo.git('switch', '--quiet', 'main');
    expect(() => repo.git('merge', '--quiet', 'side')).toThrow();
    await expect(
      checkout(await openRepo(repo.root), { kind: 'branch', name: 'wip' }),
    ).rejects.toThrow(new CheckoutRefused('a merge is in progress: finish or abort it first'));
  });

  it('refuses names and SHAs the repository does not have', async () => {
    const { repo, shas } = fresh();
    const git = await openRepo(repo.root);
    for (const target of [
      { kind: 'branch', name: 'nope' },
      { kind: 'branch', name: '-f' },
      { kind: 'branch', name: 'origin/topic' },
      { kind: 'remote', name: 'topic' },
      { kind: 'tag', name: 'main' },
      { kind: 'commit', sha: shas.A.slice(0, 7) },
      { kind: 'commit', sha: 'f'.repeat(40) },
    ] as const) {
      await expect(checkout(git, target), JSON.stringify(target)).rejects.toBeInstanceOf(
        UnknownCheckoutTarget,
      );
    }
    expect(head(repo)).toBe(shas.B);
  });

  it('checks out, with a warning, when the post-checkout hook fails', async () => {
    const { repo, shas } = fresh();
    const hook = join(repo.root, '.git', 'hooks', 'post-checkout');
    writeFileSync(hook, '#!/bin/sh\necho "hook says no" >&2\nexit 3\n');
    chmodSync(hook, 0o755);
    const result = await checkout(await openRepo(repo.root), { kind: 'branch', name: 'wip' });
    expect(result).toMatchObject({ branch: 'wip', head: shas.W });
    expect(result.warning).toMatch(/hook says no/);
  });
});
