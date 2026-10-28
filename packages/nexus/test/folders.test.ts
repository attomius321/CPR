import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createRepo, tempDir } from '../../core/test/helpers/git-repo.js';
import { folders, listFolder, places, repositoryRoot, windowsDrives } from '../src/folders.js';

const dir = tempDir();
const repo = createRepo();
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  repo.cleanup();
});

/** A folder of the test's own with `folders` (and a `.git` where a name ends in `+`). */
function tree(name: string, folders: string[], files: string[] = []): string {
  const root = join(dir, name);
  mkdirSync(root, { recursive: true });
  for (const folder of folders) {
    const plain = folder.replace(/\+$/, '');
    mkdirSync(join(root, plain), { recursive: true });
    if (folder.endsWith('+')) mkdirSync(join(root, plain, '.git'));
  }
  for (const file of files) writeFileSync(join(root, file), '');
  return root;
}

/** Outside any repository: the test's folders are under the system's temporary folder. */
const noRepository = () => Promise.resolve(null);

describe('listFolder', () => {
  it("lists a folder's folders by name, no files and no hidden ones, its repositories marked", async () => {
    const root = tree(
      'projects',
      ['zod+', 'ky+', 'notes', 'Beta', 'item10', 'item9', '.config'],
      ['README.md', '.bashrc'],
    );
    // A worktree: its `.git` is a file.
    mkdirSync(join(root, 'ky.worktrees', 'feature'), { recursive: true });
    writeFileSync(
      join(root, 'ky.worktrees', 'feature', '.git'),
      'gitdir: ../../ky/.git/worktrees/x',
    );
    const listing = await listFolder(root);
    expect(listing).toEqual({
      path: root,
      parent: dir,
      folders: [
        { name: 'Beta', path: join(root, 'Beta'), repository: false },
        { name: 'item9', path: join(root, 'item9'), repository: false },
        { name: 'item10', path: join(root, 'item10'), repository: false },
        { name: 'ky', path: join(root, 'ky'), repository: true },
        { name: 'ky.worktrees', path: join(root, 'ky.worktrees'), repository: false },
        { name: 'notes', path: join(root, 'notes'), repository: false },
        { name: 'zod', path: join(root, 'zod'), repository: true },
      ],
      more: 0,
    });
    expect((await listFolder(join(root, 'ky.worktrees'))).folders).toEqual([
      { name: 'feature', path: join(root, 'ky.worktrees', 'feature'), repository: true },
    ]);
  });

  it('lists a link to a folder as a folder, at its own path; a broken link not', async () => {
    const root = tree('links', ['real+']);
    symlinkSync(join(root, 'real'), join(root, 'linked'));
    symlinkSync(join(root, 'gone'), join(root, 'broken'));
    symlinkSync(join(dir, 'nowhere.txt'), join(root, 'file-link'));
    const { folders } = await listFolder(root);
    expect(folders).toEqual([
      { name: 'linked', path: join(root, 'linked'), repository: true },
      { name: 'real', path: join(root, 'real'), repository: true },
    ]);
  });

  it('lists the first `limit` folders by name, and counts the rest', async () => {
    const root = tree('many', ['e', 'd', 'c', 'b', 'a']);
    const listing = await listFolder(root, { limit: 3 });
    expect(listing.folders.map((folder) => folder.name)).toEqual(['a', 'b', 'c']);
    expect(listing.more).toBe(2);
  });

  it('says what each repository has checked out, from its HEAD (NX3, decision 555)', async () => {
    const root = tree('heads', ['on-main+', 'detached+', 'reftable+', 'no-head+', 'plain']);
    const head = (name: string, text: string) =>
      writeFileSync(join(root, name, '.git', 'HEAD'), text);
    head('on-main', 'ref: refs/heads/feature/nexus\n');
    head('detached', `${'c5031f43a7eaa0d96311746acf759ee6d6acb053'}\n`);
    // Reftable keeps HEAD as a stub naming no branch.
    head('reftable', 'ref: refs/heads/.invalid\n');
    // Worktrees: their `.git` file names their folder, absolute or relative to the worktree.
    const gitDirs = join(root, 'on-main', '.git', 'worktrees');
    mkdirSync(join(gitDirs, 'a'), { recursive: true });
    mkdirSync(join(gitDirs, 'b'), { recursive: true });
    writeFileSync(join(gitDirs, 'a', 'HEAD'), 'ref: refs/heads/fix/a\n');
    writeFileSync(join(gitDirs, 'b', 'HEAD'), 'ref: refs/heads/fix/b\n');
    mkdirSync(join(root, 'worktree-a'));
    writeFileSync(join(root, 'worktree-a', '.git'), `gitdir: ${join(gitDirs, 'a')}\n`);
    mkdirSync(join(root, 'worktree-b'));
    writeFileSync(join(root, 'worktree-b', '.git'), 'gitdir: ../on-main/.git/worktrees/b\n');
    mkdirSync(join(root, 'worktree-gone'));
    writeFileSync(join(root, 'worktree-gone', '.git'), 'gitdir: /nowhere/.git/worktrees/x\n');
    const { folders } = await listFolder(root);
    expect(folders).toEqual([
      {
        name: 'detached',
        path: join(root, 'detached'),
        repository: true,
        detached: 'c5031f43a7eaa0d96311746acf759ee6d6acb053',
      },
      { name: 'no-head', path: join(root, 'no-head'), repository: true },
      { name: 'on-main', path: join(root, 'on-main'), repository: true, branch: 'feature/nexus' },
      { name: 'plain', path: join(root, 'plain'), repository: false },
      { name: 'reftable', path: join(root, 'reftable'), repository: true },
      { name: 'worktree-a', path: join(root, 'worktree-a'), repository: true, branch: 'fix/a' },
      { name: 'worktree-b', path: join(root, 'worktree-b'), repository: true, branch: 'fix/b' },
      { name: 'worktree-gone', path: join(root, 'worktree-gone'), repository: true },
    ]);
  });

  it('resolves the path, and has no parent at the top', async () => {
    const root = tree('dots', ['a']);
    expect((await listFolder(join(root, 'a', '..'))).path).toBe(root);
    const top = await listFolder('/');
    expect(top.parent).toBeNull();
    expect(top.folders.length).toBeGreaterThan(0);
  });

  it("says what is wrong with a folder it cannot list, by the system's code", async () => {
    const root = tree('errors', [], ['a-file']);
    await expect(listFolder(join(root, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(listFolder(join(root, 'a-file'))).rejects.toMatchObject({ code: 'ENOTDIR' });
    if (process.getuid?.() === 0) return; // root reads everything
    mkdirSync(join(root, 'locked'));
    chmodSync(join(root, 'locked'), 0o000);
    try {
      await expect(listFolder(join(root, 'locked'))).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      chmodSync(join(root, 'locked'), 0o755);
    }
  });
});

describe('folders', () => {
  it("lists the folder asked for, or the newest Symbiote's folder, or home; with the places", async () => {
    const root = tree('home', ['projects/ky+', 'projects/zod+', 'work']);
    const options = {
      home: root,
      drives: [],
      repositoryOf: noRepository,
    };
    const atHome = await folders(null, { ...options, roots: [] });
    expect(atHome.path).toBe(root);
    expect(atHome.places).toEqual([
      { kind: 'home', name: 'Home', path: root },
      { kind: 'top', name: '/', path: '/' },
    ]);
    const roots = [join(root, 'projects', 'zod'), join(root, 'projects', 'ky')];
    const theirs = await folders(null, { ...options, roots });
    expect(theirs.path).toBe(join(root, 'projects'));
    expect(theirs.folders.map((folder) => folder.name)).toEqual(['ky', 'zod']);
    expect(theirs.places[1]).toEqual({
      kind: 'symbiotes',
      name: 'projects',
      path: join(root, 'projects'),
    });
    expect((await folders(join(root, 'work'), { ...options, roots })).path).toBe(
      join(root, 'work'),
    );
    expect(theirs.picked).toBeNull();
  });
});

describe('folders: a repository is the end of the way down (NX3, decision 554)', () => {
  it('answers the folder holding the repository, picked, for the repository or any folder inside', async () => {
    const held = tree('held', ['other', 'app/src/deep']);
    const app = join(held, 'app');
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', app]);
    const options = { home: dir, roots: [], drives: [] };
    for (const inside of [
      app,
      join(app, 'src'),
      join(app, 'src', 'deep'),
      join(app, '.git', 'refs'),
    ]) {
      const answer = await folders(inside, options);
      expect(answer.path, inside).toBe(held);
      expect(answer.picked, inside).toBe(app);
      expect(answer.folders).toEqual([
        { name: 'app', path: app, repository: true, branch: 'main' },
        { name: 'other', path: join(held, 'other'), repository: false },
      ]);
    }
    const outside = await folders(join(held, 'other'), options);
    expect([outside.path, outside.picked]).toEqual([join(held, 'other'), null]);
  });

  it('goes up to the outermost repository; one holding home is no end', async () => {
    const root = tree('nested', ['outer/vendor/inner/src', 'git-home/projects/ky']);
    const outer = join(root, 'outer');
    const inner = join(outer, 'vendor', 'inner');
    const gitHome = join(root, 'git-home');
    const repositoryOf = (folder: string) =>
      Promise.resolve(
        folder.startsWith(inner)
          ? inner
          : folder.startsWith(outer)
            ? outer
            : folder.startsWith(gitHome)
              ? gitHome
              : null,
      );
    const nested = await folders(join(inner, 'src'), {
      home: dir,
      roots: [],
      drives: [],
      repositoryOf,
    });
    expect([nested.path, nested.picked]).toEqual([root, outer]);
    // A home kept in git (`~/.git`): every folder of it is in that repository, and listed.
    const inHome = await folders(join(gitHome, 'projects'), {
      home: gitHome,
      roots: [],
      drives: [],
      repositoryOf,
    });
    expect([inHome.path, inHome.picked]).toEqual([join(gitHome, 'projects'), null]);
  });

  it("is the system's error for a folder outside any repository that cannot be listed", async () => {
    await expect(
      folders(join(dir, 'missing'), {
        home: dir,
        roots: [],
        drives: [],
        repositoryOf: noRepository,
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('repositoryRoot', () => {
  it("is git's top level for a folder in a work tree, null elsewhere", async () => {
    repo.write({ 'src/deep/a.ts': '' });
    repo.commit('first');
    expect(await repositoryRoot(repo.root)).toBe(repo.root);
    expect(await repositoryRoot(join(repo.root, 'src'))).toBe(repo.root);
    expect(await repositoryRoot(dir)).toBeNull();
    expect(await repositoryRoot(join(repo.root, '.git'))).toBeNull();
    expect(await repositoryRoot(join(dir, 'missing'))).toBeNull();
  });
});

describe('places', () => {
  it('is home, the folders the running Symbiotes are in (newest first, three at most), the top, the drives', () => {
    expect(
      places({
        home: '/home/me',
        roots: [
          '/home/me/projects/ky',
          '/home/me/projects/zod',
          '/home/me/work/api',
          '/home/me/repo',
          '/srv/one/a',
          '/srv/two/b',
          '/x',
        ],
        drives: [{ kind: 'drive', name: 'C:', path: '/mnt/c' }],
      }),
    ).toEqual([
      { kind: 'home', name: 'Home', path: '/home/me' },
      { kind: 'symbiotes', name: 'projects', path: '/home/me/projects' },
      { kind: 'symbiotes', name: 'work', path: '/home/me/work' },
      { kind: 'symbiotes', name: 'one', path: '/srv/one' },
      { kind: 'top', name: '/', path: '/' },
      { kind: 'drive', name: 'C:', path: '/mnt/c' },
    ]);
    expect(places({ home: '/home/me', roots: [], drives: [] })).toEqual([
      { kind: 'home', name: 'Home', path: '/home/me' },
      { kind: 'top', name: '/', path: '/' },
    ]);
  });
});

describe('windowsDrives', () => {
  it("is WSL's drives, one letter each under /mnt; none elsewhere", () => {
    const mnt = ['c', 'd', 'wsl', 'wslg', 'e-file'];
    const folder = (name: string) => name !== 'e-file';
    expect(
      windowsDrives({
        version: () => 'Linux version 6.6.87.2-microsoft-standard-WSL2 (root@x)',
        mnt: () => mnt,
        isFolder: (path) => folder(path.slice('/mnt/'.length)),
      }),
    ).toEqual([
      { kind: 'drive', name: 'C:', path: '/mnt/c' },
      { kind: 'drive', name: 'D:', path: '/mnt/d' },
    ]);
    expect(
      windowsDrives({
        version: () => 'Linux version 6.8.0-45-generic (buildd@lcy02)',
        mnt: () => mnt,
        isFolder: () => true,
      }),
    ).toEqual([]);
    expect(
      windowsDrives({
        version: () => {
          throw new Error('no /proc');
        },
        mnt: () => mnt,
        isFolder: () => true,
      }),
    ).toEqual([]);
  });
});
