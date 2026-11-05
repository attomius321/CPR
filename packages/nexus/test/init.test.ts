import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { repositoryRoot } from '../src/folders.js';
import { opener, type OpenerOptions } from '../src/init.js';
import type { Running } from '../src/registry.js';
import type { StartAnswer } from '../src/start.js';

const dir = tempDir();
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const home = join(dir, 'home');
const drive = join(dir, 'mnt', 'c');
const cache = join(home, '.cache', 'symbiote');
const config = join(home, '.config', 'symbiote');
for (const path of [
  join(home, 'notes', 'drafts'),
  join(home, 'code', 'ky', 'src'),
  join(drive, 'Projects', 'site'),
  join(dir, 'etc'),
  join(cache, 'worktrees', 'head-0'),
  join(config, 'more'),
]) {
  mkdirSync(path, { recursive: true });
}
mkdirSync(join(home, 'code', 'ky', '.git'));

const symbiote = (root: string): Running => ({
  url: 'http://127.0.0.1:40000/',
  pid: 1,
  root,
  name: root.split('/').pop() ?? '',
  started: '2026-11-05T10:00:00.000Z',
});

/**
 * An opener on the test's home, drive, cache and settings folders. Its starter answers a Symbiote
 * in the folder asked; `started` says what it was asked, `inits` where `git init` ran.
 */
function make(overrides: Partial<OpenerOptions> = {}) {
  const started: string[] = [];
  const inits: string[] = [];
  const open = opener({
    home,
    cache,
    config,
    drives: [drive],
    repositoryOf: (folder) =>
      Promise.resolve(
        folder === join(home, 'code', 'ky') || folder.startsWith(`${join(home, 'code', 'ky')}/`)
          ? join(home, 'code', 'ky')
          : null,
      ),
    start: (folder): Promise<StartAnswer> => {
      started.push(folder);
      return Promise.resolve({ symbiote: symbiote(folder) });
    },
    init: (folder) => {
      inits.push(folder);
      return Promise.resolve(null);
    },
    ...overrides,
  });
  return { open, started, inits };
}

describe('opener (NX6, decisions 927, 928)', () => {
  it('starts a repository, or the repository a folder is in, as Open does', async () => {
    const { open, started, inits } = make();
    expect(await open(join(home, 'code', 'ky'), false)).toEqual({
      symbiote: symbiote(join(home, 'code', 'ky')),
    });
    expect(await open(join(home, 'code', 'ky', 'src'), true)).toMatchObject({ symbiote: {} });
    // A `.git` folder: git names no top level there; the folder holding it is the repository.
    expect(await open(join(home, 'code', 'ky', '.git'), true)).toMatchObject({ symbiote: {} });
    expect(started).toEqual([
      join(home, 'code', 'ky'),
      join(home, 'code', 'ky', 'src'),
      join(home, 'code', 'ky'),
    ]);
    expect(inits).toEqual([]);
  });

  it('offers git init for a plain folder, and runs it only when asked, then starts it', async () => {
    const { open, started, inits } = make();
    const notes = join(home, 'notes');
    expect(await open(notes, false)).toEqual({
      status: 409,
      init: true,
      error: `${notes} is no git repository`,
    });
    expect(inits).toEqual([]);
    expect(started).toEqual([]);
    expect(await open(notes, true)).toEqual({ symbiote: symbiote(notes) });
    expect(inits).toEqual([notes]);
    expect(started).toEqual([notes]);
    // On a Windows drive, in a folder.
    expect(await open(join(drive, 'Projects'), false)).toMatchObject({ status: 409, init: true });
  });

  it('refuses the top, home, a drive, the cache and settings folders, and folders outside home', async () => {
    const { open, started, inits } = make();
    const refused: [string, string][] = [
      ['/', 'The top folder (/) cannot be made a repository'],
      [home, 'Your home folder cannot be made a repository: pick a folder in it'],
      [drive, `The drive ${drive} cannot be made a repository: pick a folder on it`],
      [cache, `Symbiote's cache folder cannot be made a repository: ${cache}`],
      [
        join(cache, 'worktrees', 'head-0'),
        `Symbiote's cache folder cannot be made a repository: ${join(cache, 'worktrees', 'head-0')}`,
      ],
      [
        join(config, 'more'),
        `Symbiote's settings folder cannot be made a repository: ${join(config, 'more')}`,
      ],
      [
        join(dir, 'etc'),
        `Only a folder in your home or on a Windows drive can be made a repository: ${join(dir, 'etc')} is neither`,
      ],
    ];
    for (const [folder, error] of refused) {
      expect(await open(folder, false), folder).toEqual({ status: 422, error });
      expect(await open(folder, true), folder).toEqual({ status: 422, error });
    }
    expect(inits).toEqual([]);
    expect(started).toEqual([]);
  });

  it('refuses a link out of home as the folder it leads to', async () => {
    symlinkSync(join(dir, 'etc'), join(home, 'etc-link'));
    const { open, inits } = make();
    expect(await open(join(home, 'etc-link'), true)).toMatchObject({ status: 422 });
    expect(inits).toEqual([]);
  });

  it('refuses a folder in a home kept in git: that repository is no end (decision 554)', async () => {
    const { open, started, inits } = make({ repositoryOf: () => Promise.resolve(home) });
    const notes = join(home, 'notes');
    expect(await open(notes, true)).toEqual({
      status: 422,
      error: `${notes} is in your home, which is kept in git: Symbiote makes no repository inside it`,
    });
    expect(inits).toEqual([]);
    expect(started).toEqual([]);
  });

  it('says what is wrong with a folder: missing, not a folder, not absolute', async () => {
    const { open } = make();
    expect(await open(join(home, 'gone'), true)).toEqual({
      status: 404,
      error: `No such folder: ${join(home, 'gone')}`,
    });
    expect(await open('notes', true)).toEqual({
      status: 400,
      error: 'Not an absolute path: notes',
    });
  });

  it('says why git init failed, and starts nothing', async () => {
    const { open, started } = make({ init: () => Promise.resolve('git: permission denied') });
    expect(await open(join(home, 'notes'), true)).toEqual({
      status: 422,
      error: `git init failed in ${join(home, 'notes')}: git: permission denied`,
    });
    expect(started).toEqual([]);
  });

  it('runs a real git init: a .git folder, nothing else written, no commit', async () => {
    const real = join(home, 'notes', 'drafts');
    const { open, started } = make({ init: undefined, repositoryOf: repositoryRoot });
    expect(await open(real, true)).toMatchObject({ symbiote: { root: real } });
    expect(started).toEqual([real]);
    expect(readdirSync(real)).toEqual(['.git']);
    expect(existsSync(join(real, '.git', 'HEAD'))).toBe(true);
    expect(readdirSync(join(real, '.git', 'refs', 'heads'))).toEqual([]);
    // Now a repository: opened, not offered again.
    expect(await open(real, false)).toMatchObject({ symbiote: { root: real } });
  });
});
