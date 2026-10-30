import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { describePins, pins, readPinned, writePinned } from '../src/pins.js';

const dir = tempDir();
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A folder of the test's own: `folders` in it, a `.git` folder where a name ends in `+`. */
function tree(name: string, folders: string[]): string {
  const root = join(dir, name);
  mkdirSync(root, { recursive: true });
  for (const folder of folders) {
    const plain = folder.replace(/\+$/, '');
    mkdirSync(join(root, plain), { recursive: true });
    if (folder.endsWith('+')) mkdirSync(join(root, plain, '.git'));
  }
  return root;
}

/** Outside any repository: the test's folders are under the system's temporary folder. */
const noRepository = () => Promise.resolve(null);

describe('readPinned', () => {
  it('is the pinned paths in the order pinned; none when the file is missing or broken', async () => {
    const folder = join(dir, 'read');
    mkdirSync(folder);
    const file = join(folder, 'nexus.json');
    expect(await readPinned(file)).toEqual([]);
    for (const text of ['{', 'null', '[]', '{"pinned":"/a"}', '{}']) {
      writeFileSync(file, text);
      expect(await readPinned(file), text).toEqual([]);
    }
    // Only absolute paths, each once, as `resolve` writes them.
    writeFileSync(file, '{"pinned":["/b","relative",7,"/a/","/b","/c/../a"]}');
    expect(await readPinned(file)).toEqual(['/b', '/a']);
  });
});

describe('writePinned', () => {
  it('writes the pins whole, beside what else the file holds, its folder made', async () => {
    const folder = join(dir, 'write', 'symbiote');
    const file = join(folder, 'nexus.json');
    await writePinned(file, ['/home/me/projects']);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ pinned: ['/home/me/projects'] });
    writeFileSync(file, '{"later":{"a":1},"pinned":[]}');
    await writePinned(file, ['/a', '/b']);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      later: { a: 1 },
      pinned: ['/a', '/b'],
    });
    // Written through a file beside it, renamed: none of those left.
    expect(readdirSync(folder)).toEqual(['nexus.json']);
    // A broken file is replaced by the pins.
    writeFileSync(file, '{');
    await writePinned(file, ['/a']);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ pinned: ['/a'] });
  });
});

describe('describePins', () => {
  it('names each pin, marks the repositories (a .git folder or file) and the folders gone', async () => {
    const root = tree('describe', ['notes', 'ky+', 'worktree']);
    writeFileSync(join(root, 'worktree', '.git'), 'gitdir: /somewhere/.git/worktrees/w\n');
    writeFileSync(join(root, 'a.txt'), '');
    expect(
      await describePins([
        join(root, 'notes'),
        join(root, 'ky'),
        join(root, 'worktree'),
        join(root, 'gone'),
        join(root, 'a.txt'),
        '/',
      ]),
    ).toEqual([
      { name: 'notes', path: join(root, 'notes'), repository: false },
      { name: 'ky', path: join(root, 'ky'), repository: true },
      { name: 'worktree', path: join(root, 'worktree'), repository: true },
      { name: 'gone', path: join(root, 'gone'), repository: false, missing: true },
      { name: 'a.txt', path: join(root, 'a.txt'), repository: false, missing: true },
      { name: '/', path: '/', repository: false },
    ]);
  });
});

describe('pins (NX4, decisions 617–619)', () => {
  it('pins a folder once, in the order pinned, and unpins it; the file keeps them', async () => {
    const root = tree('order', ['a', 'b+', 'c']);
    const file = join(dir, 'order-config', 'nexus.json');
    const kept = pins({ file, home: root, repositoryOf: noRepository });
    expect(await kept.read()).toEqual([]);
    await kept.set(join(root, 'c'), true);
    await kept.set(join(root, 'a'), true);
    expect(await kept.set(join(root, 'c'), true)).toEqual({
      pinned: [
        { name: 'c', path: join(root, 'c'), repository: false },
        { name: 'a', path: join(root, 'a'), repository: false },
      ],
    });
    expect(await kept.set(`${join(root, 'b')}/`, true)).toMatchObject({
      pinned: [
        { name: 'c' },
        { name: 'a' },
        { name: 'b', path: join(root, 'b'), repository: true },
      ],
    });
    expect(await kept.set(join(root, 'c'), false)).toMatchObject({
      pinned: [{ name: 'a' }, { name: 'b' }],
    });
    // One not pinned: nothing to undo.
    expect(await kept.set(join(root, 'c'), false)).toMatchObject({
      pinned: [{ name: 'a' }, { name: 'b' }],
    });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      pinned: [join(root, 'a'), join(root, 'b')],
    });
    // Another nexus reads what this one wrote.
    expect(await pins({ file, home: root, repositoryOf: noRepository }).read()).toMatchObject([
      { name: 'a' },
      { name: 'b' },
    ]);
  });

  it('keeps every pin asked for at once', async () => {
    const root = tree('together', ['a', 'b', 'c', 'd']);
    const kept = pins({ file: join(dir, 'together.json'), home: root, repositoryOf: noRepository });
    await Promise.all(['a', 'b', 'c', 'd'].map((name) => kept.set(join(root, name), true)));
    expect((await kept.read()).map((pin) => pin.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('says why a folder cannot be pinned: gone, not a folder, inside a repository', async () => {
    const root = tree('refused', ['ky/src', 'work']);
    writeFileSync(join(root, 'a.txt'), '');
    const ky = join(root, 'ky');
    // ky is a repository; home (root) is in none.
    const repositoryOf = (folder: string) =>
      Promise.resolve(folder === ky || folder.startsWith(`${ky}/`) ? ky : null);
    const kept = pins({ file: join(dir, 'refused.json'), home: root, repositoryOf });
    expect(await kept.set(join(root, 'gone'), true)).toEqual({
      status: 404,
      error: `No such folder: ${join(root, 'gone')}`,
    });
    expect(await kept.set(join(root, 'a.txt'), true)).toEqual({
      status: 400,
      error: `Not a folder: ${join(root, 'a.txt')}`,
    });
    expect(await kept.set(join(ky, 'src'), true)).toEqual({
      status: 422,
      error: `${join(ky, 'src')} is inside the repository ${ky}: pin the repository`,
    });
    // In its `.git` folder git names no top level: asked from the folder holding it.
    mkdirSync(join(ky, '.git', 'objects'), { recursive: true });
    expect(await kept.set(join(ky, '.git', 'objects'), true)).toMatchObject({ status: 422 });
    expect(await kept.read()).toEqual([]);
    // The repository itself, and a folder beside it, are pinned.
    expect(await kept.set(ky, true)).toMatchObject({ pinned: [{ name: 'ky' }] });
    expect(await kept.set(join(root, 'work'), true)).toMatchObject({
      pinned: [{ name: 'ky' }, { name: 'work' }],
    });
    // A folder gone is unpinned all the same.
    rmSync(join(root, 'work'), { recursive: true });
    expect(await kept.set(join(root, 'work'), false)).toMatchObject({ pinned: [{ name: 'ky' }] });
  });

  it('pins a folder of a home kept in git: that repository is no end (decision 554)', async () => {
    const home = tree('home-in-git', ['projects']);
    const kept = pins({
      file: join(dir, 'home-in-git.json'),
      home,
      repositoryOf: () => Promise.resolve(home),
    });
    expect(await kept.set(join(home, 'projects'), true)).toMatchObject({
      pinned: [{ name: 'projects' }],
    });
  });
});
