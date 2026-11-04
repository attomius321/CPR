import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { checkoutsOf } from '../src/checkouts.js';

const dir = realpathSync(tempDir());
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env });

/** A repository `store` with a commit, and worktrees: two beside it, one in a cache, one pruned. */
function repository() {
  const code = join(dir, 'code');
  const store = join(code, 'store');
  mkdirSync(store, { recursive: true });
  git(store, 'init', '-q', '-b', 'main');
  git(store, 'commit', '-q', '--allow-empty', '-m', 'first');
  const worktrees = join(code, 'store.worktrees');
  git(store, 'worktree', 'add', '-q', '-b', 'feature/carts', join(worktrees, 'carts'));
  git(store, 'worktree', 'add', '-q', '-b', 'fix/tax', join(worktrees, 'tax'));
  const cache = join(dir, 'cache');
  git(store, 'worktree', 'add', '-q', '--detach', join(cache, 'worktrees', 'store-1', 'head-0'));
  git(store, 'worktree', 'add', '-q', '-b', 'gone', join(dir, 'gone'));
  rmSync(join(dir, 'gone'), { recursive: true, force: true });
  return { store, worktrees, cache };
}

const { store, worktrees, cache } = repository();

describe('checkoutsOf (decision 914)', () => {
  it("is a repository's folder, then its worktrees by path: not the cache's, not a pruned one", async () => {
    expect(await checkoutsOf(store, { leaveOut: [cache] })).toEqual([
      { name: 'store', path: store, branch: 'main' },
      { name: 'carts', path: join(worktrees, 'carts'), branch: 'feature/carts' },
      { name: 'tax', path: join(worktrees, 'tax'), branch: 'fix/tax' },
    ]);
  });

  it('is the same from one of its worktrees', async () => {
    expect(
      (await checkoutsOf(join(worktrees, 'tax'), { leaveOut: [cache] }))?.map((c) => c.name),
    ).toEqual(['store', 'carts', 'tax']);
  });

  it("is the cache's worktrees too when not told to leave them out", async () => {
    expect((await checkoutsOf(store))?.map((c) => c.name)).toEqual([
      'store',
      'head-0',
      'carts',
      'tax',
    ]);
  });

  it('is null for a folder that is no repository, or is gone', async () => {
    expect(await checkoutsOf(dir)).toBeNull();
    expect(await checkoutsOf(join(dir, 'gone'))).toBeNull();
  });

  it('is the repository alone when it has no worktrees', async () => {
    const lone = join(dir, 'lone');
    mkdirSync(lone);
    git(lone, 'init', '-q', '-b', 'trunk');
    expect(await checkoutsOf(lone)).toEqual([{ name: 'lone', path: lone, branch: 'trunk' }]);
  });
});
