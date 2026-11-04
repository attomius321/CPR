import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { scanFolder, scanner, type ScanResult } from '../src/scan.js';

const dir = tempDir();
afterAll(() => {
  chmodSync(join(dir, 'readonly', 'locked'), 0o755);
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A folder of the test's own: each path a folder; one ending in `+` a repository (a `.git` folder
 * with a `HEAD` on main), in `@` a worktree (a `.git` file).
 */
function tree(name: string, paths: string[]): string {
  const root = join(dir, name);
  mkdirSync(root, { recursive: true });
  for (const path of paths) {
    const plain = path.replace(/[+@]$/, '');
    mkdirSync(join(root, plain), { recursive: true });
    if (path.endsWith('+')) {
      mkdirSync(join(root, plain, '.git'));
      writeFileSync(join(root, plain, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    }
    if (path.endsWith('@')) {
      writeFileSync(join(root, plain, '.git'), 'gitdir: /nowhere/.git/worktrees/w\n');
    }
  }
  return root;
}

/** The repositories a scan found, relative to the folder scanned. */
const found = (root: string, result: ScanResult) =>
  result.repositories.map((r) => relative(root, r.path));

/** Every folder's and file's path and modification time under `root`: what a scan must not change. */
function snapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      out.push(
        `${relative(root, path)} ${statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 'link'}`,
      );
      if (entry.isDirectory()) {
        try {
          walk(path);
        } catch {
          // A folder it cannot read: the scan cannot either.
        }
      }
    }
  };
  walk(root);
  return out.sort();
}

describe('scanFolder (decision 911)', () => {
  it('finds the repositories in a folder, by path, each with what it has checked out', async () => {
    const root = tree('basic', [
      'zod+',
      'ky+',
      'notes/drafts',
      'work/acme/api+',
      'ky.worktrees/feature@',
    ]);
    const result = await scanFolder(root);
    expect(found(root, result)).toEqual(['ky', 'ky.worktrees/feature', 'work/acme/api', 'zod']);
    expect(result.repositories[0]).toEqual({ name: 'ky', path: join(root, 'ky'), branch: 'main' });
    // A worktree whose HEAD cannot be read is still a repository, with nothing checked out said.
    expect(result.repositories[1]).toEqual({
      name: 'feature',
      path: join(root, 'ky.worktrees', 'feature'),
    });
    expect(result).toMatchObject({ folder: root, short: false });
    // The folder, its five, three under them, and api (read to find its `.git`).
    expect(result.folders).toBe(10);
    expect(typeof result.ms).toBe('number');
    expect(new Date(result.at).getTime()).not.toBeNaN();
  });

  it('ends at a repository: never reads inside one', async () => {
    const root = tree('end', ['app+', 'app/packages/inner+', 'app/node_stuff/deep+']);
    expect(found(root, await scanFolder(root))).toEqual(['app']);
  });

  it('never counts the folder scanned as a repository (a home kept in git)', async () => {
    const root = tree('home-in-git', ['code/ky+']);
    mkdirSync(join(root, '.git'));
    expect(found(root, await scanFolder(root))).toEqual(['code/ky']);
  });

  it('leaves out hidden folders, build and package folders, and the folders it is told to', async () => {
    const root = tree('skipped', [
      '.config/tool+',
      'web/node_modules/pkg+',
      'go/vendor/lib+',
      'rust/target/x+',
      'py/venv/y+',
      'py/__pycache__/z+',
      'site/dist/a+',
      'site/build/b+',
      'cache/worktrees/head-0+',
      'real+',
    ]);
    const result = await scanFolder(root, { leaveOut: [join(root, 'cache')] });
    expect(found(root, result)).toEqual(['real']);
  });

  it('goes 5 levels down at most', async () => {
    const root = tree('deep', ['1/2/3/4/five+', '1/2/3/4/5/six+', 'a/b/c/d/e/f/g+']);
    expect(found(root, await scanFolder(root))).toEqual(['1/2/3/4/five']);
    expect(found(root, await scanFolder(root, { depth: 2 }))).toEqual([]);
  });

  it('never follows a link: no loop, nothing outside the folder', async () => {
    const outside = tree('outside', ['elsewhere+']);
    const root = tree('links', ['own+', 'loop']);
    symlinkSync(root, join(root, 'loop', 'back'));
    symlinkSync(outside, join(root, 'out'));
    symlinkSync(join(outside, 'elsewhere'), join(root, 'linked-repo'));
    expect(found(root, await scanFolder(root))).toEqual(['own']);
  });

  it('reads nothing beside the folder, and changes nothing in it', async () => {
    const parent = tree('beside', ['chosen/a+', 'chosen/b/c+', 'next-to-it+', 'other/d+']);
    const chosen = join(parent, 'chosen');
    const before = snapshot(parent);
    expect(found(chosen, await scanFolder(chosen))).toEqual(['a', 'b/c']);
    expect(snapshot(parent)).toEqual(before);
  });

  it('reads a folder it may only read, and passes over one it may not', async () => {
    const root = tree('readonly', ['open+', 'locked/inside+']);
    chmodSync(root, 0o555);
    chmodSync(join(root, 'locked'), 0o000);
    try {
      expect(found(root, await scanFolder(root))).toEqual(['open']);
    } finally {
      chmodSync(root, 0o755);
    }
  });

  it('stops after so many folders read, and says it stopped short', async () => {
    const root = tree(
      'many',
      Array.from({ length: 30 }, (_, i) => `f${String(i).padStart(2, '0')}/x`),
    );
    const result = await scanFolder(root, { maxFolders: 10 });
    expect(result.short).toBe(true);
    expect(result.folders).toBeLessThanOrEqual(10);
    expect((await scanFolder(root)).short).toBe(false);
  });

  it('stops after so long, and says it stopped short', async () => {
    const root = tree('slow', ['a/b/c', 'd/e/f', 'g+']);
    let t = 0;
    // Each look at the clock is a second later: past the 2 s at the third.
    const result = await scanFolder(root, { now: () => (t += 1000) });
    expect(result.short).toBe(true);
  });

  it('answers the system’s error for a folder that cannot be scanned', async () => {
    await expect(scanFolder(join(dir, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('scanner (decision 911)', () => {
  it('scans nothing while no folder is chosen', async () => {
    const file = join(dir, 'scanner-none', 'scan.json');
    const scans = scanner({ folder: () => Promise.resolve(null), file });
    expect(await scans.current()).toBeNull();
    expect(await scans.scan()).toBeNull();
    expect(() => statSync(file)).toThrow();
  });

  it('scans the chosen folder, keeps the result in its file, and gives it back at the next start', async () => {
    const root = tree('scanner', ['ky+', 'zod+']);
    const file = join(dir, 'scanner-cache', 'scan.json');
    let chosen: string | null = root;
    const scans = scanner({ folder: () => Promise.resolve(chosen), file });
    const result = await scans.scan();
    expect(result && found(root, result)).toEqual(['ky', 'zod']);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(result);
    // A new nexus: the last result, before it scans again.
    const next = scanner({ folder: () => Promise.resolve(chosen), file });
    expect(await next.current()).toEqual(result);
    // Another folder chosen: the last result was another folder's, so none until it scans.
    chosen = join(root, 'ky');
    expect(await next.current()).toBeNull();
    chosen = null;
    expect(await next.current()).toBeNull();
  });

  it('runs one scan at a time: asked again while one runs, it answers that one', async () => {
    const root = tree('scanner-once', ['ky+']);
    const scans = scanner({
      folder: () => Promise.resolve(root),
      file: join(dir, 'scanner-once.json'),
    });
    const [a, b] = await Promise.all([scans.scan(), scans.scan()]);
    expect(a).toBe(b);
  });

  it('keeps no result for a folder that cannot be scanned', async () => {
    const scans = scanner({
      folder: () => Promise.resolve(join(dir, 'gone-folder')),
      file: join(dir, 'scanner-gone.json'),
    });
    expect(await scans.scan()).toBeNull();
    expect(await scans.current()).toBeNull();
  });
});
