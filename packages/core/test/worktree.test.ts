import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkoutRevision, defaultCacheDir, openRepo, type GitRepo } from '../src/index.js';
import { createRepo, tempDir, type TestRepo } from './helpers/git-repo.js';

describe('checkoutRevision', () => {
  let repo: TestRepo;
  let gitRepo: GitRepo;
  let cacheDir: string;
  let slots: string;
  let v1: string;
  let v2: string;

  beforeAll(async () => {
    repo = createRepo();
    repo.write({ 'f.txt': 'v1\n' });
    v1 = repo.commit('v1');
    repo.write({ 'f.txt': 'v2\n' });
    v2 = repo.commit('v2');
    gitRepo = await openRepo(repo.root);
    cacheDir = tempDir();
    slots = join(cacheDir, 'worktrees', gitRepo.id);
  });

  afterAll(() => {
    repo.cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  const read = (root: string) => readFileSync(join(root, 'f.txt'), 'utf8');

  it('checks out a commit into the first slot', async () => {
    const source = await checkoutRevision(gitRepo, v1, { role: 'head', cacheDir });
    expect(source.root).toBe(join(slots, 'head-0'));
    expect(source.sha).toBe(v1);
    expect(read(source.root)).toBe('v1\n');
    await source.dispose();
  });

  it('reuses a released slot and moves it to another commit', async () => {
    const source = await checkoutRevision(gitRepo, v2, { role: 'head', cacheDir });
    expect(source.root).toBe(join(slots, 'head-0'));
    expect(read(source.root)).toBe('v2\n');
    await source.dispose();
  });

  it('gives concurrent runs different slots', async () => {
    const a = await checkoutRevision(gitRepo, v1, { role: 'head', cacheDir });
    const b = await checkoutRevision(gitRepo, v2, { role: 'head', cacheDir });
    expect([a.root, b.root]).toEqual([join(slots, 'head-0'), join(slots, 'head-1')]);
    expect([read(a.root), read(b.root)]).toEqual(['v1\n', 'v2\n']);
    await Promise.all([a.dispose(), b.dispose()]);
  });

  it('takes over a lock left by a dead process', async () => {
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(join(slots, 'head-0.lock'), `${deadPid}\n`);
    const source = await checkoutRevision(gitRepo, v1, { role: 'head', cacheDir });
    expect(source.root).toBe(join(slots, 'head-0'));
    await source.dispose();
  });

  it('rebuilds a broken slot', async () => {
    const slot = join(slots, 'head-0');
    rmSync(slot, { recursive: true, force: true });
    mkdirSync(slot);
    writeFileSync(join(slot, 'junk.txt'), 'not a worktree\n');

    const source = await checkoutRevision(gitRepo, v2, { role: 'head', cacheDir });
    expect(source.root).toBe(slot);
    expect(read(slot)).toBe('v2\n');
    await source.dispose();

    // The old registration was replaced, not duplicated: main checkout + head-0 + head-1.
    const worktrees = repo.git('worktree', 'list', '--porcelain').match(/^worktree /gm);
    expect(worktrees).toHaveLength(3);
  });
});

describe('defaultCacheDir', () => {
  it('prefers CPR_CACHE_DIR, then XDG_CACHE_HOME, then the platform default', () => {
    expect(defaultCacheDir({ CPR_CACHE_DIR: '/c', XDG_CACHE_HOME: '/x' }, 'linux', '/h')).toBe(
      '/c',
    );
    expect(defaultCacheDir({ XDG_CACHE_HOME: '/x' }, 'darwin', '/h')).toBe('/x/cpr');
    expect(defaultCacheDir({}, 'darwin', '/h')).toBe('/h/Library/Caches/cpr');
    expect(defaultCacheDir({}, 'linux', '/h')).toBe('/h/.cache/cpr');
  });
});
