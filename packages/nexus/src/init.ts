// Opening a selected folder (NX6, decisions 927, 928): a repository, or a folder in one, starts its
// Symbiote as Open does; a plain folder is offered `git init`, and made a repository only when the
// person said yes, then started. `git init` is the one write the nexus makes in a folder: a `.git`
// folder, no commit. The guards are the server's, checked at each ask.
import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { checkoutOf, within } from './folders.js';
import type { StartAnswer } from './start.js';

/** What opening a folder answers: its Symbiote, `git init` offered, or why not. */
export type OpenAnswer =
  | StartAnswer
  | { status: 409; init: true; error: string }
  | { status: 400 | 404 | 422; error: string };

export interface OpenerOptions {
  home: string;
  /** Symbiote's cache and settings folders: never made a repository. */
  cache: string;
  config: string;
  /** Windows' drives under WSL (`/mnt/c`): a folder on one may be made a repository, not the drive. */
  drives: readonly string[];
  /** The repository root a folder is in (git's top level); null outside one. */
  repositoryOf: (folder: string) => Promise<string | null>;
  /** Starts `symbiote view` in a folder (`Starter.start`). */
  start: (folder: string) => Promise<StartAnswer>;
  /** Runs `git init` in a folder: null once done, else git's words. */
  init?: (folder: string) => Promise<string | null>;
}

/** Opens `folder`; `init`: the person said yes to `git init` in it. */
export type Opener = (folder: string, init: boolean) => Promise<OpenAnswer>;

export function opener(options: OpenerOptions): Opener {
  const { repositoryOf, start } = options;
  const init = options.init ?? gitInit;
  // The guards' folders as real paths, as the folder asked is judged: a home reached through a
  // link (`/home` → `/data/home`) still holds its folders.
  const real = (path: string) => realpath(path).catch(() => resolve(path));
  const guarded = Promise.all([
    real(options.home),
    real(options.cache),
    real(options.config),
    Promise.all(options.drives.map(real)),
  ]).then(([home, cache, config, drives]) => ({ home, cache, config, drives }));

  /** Why `path` (a real path, not a repository) may not be made one; null when it may. */
  async function refusal(path: string): Promise<string | null> {
    const { home, cache, config, drives } = await guarded;
    if (path === '/') return 'The top folder (/) cannot be made a repository';
    if (path === home) return 'Your home folder cannot be made a repository: pick a folder in it';
    if (drives.includes(path)) {
      return `The drive ${path} cannot be made a repository: pick a folder on it`;
    }
    if (within(path, cache)) return `Symbiote's cache folder cannot be made a repository: ${path}`;
    if (within(path, config)) {
      return `Symbiote's settings folder cannot be made a repository: ${path}`;
    }
    if (!within(path, home) && !drives.some((drive) => within(path, drive))) {
      return `Only a folder in your home or on a Windows drive can be made a repository: ${path} is neither`;
    }
    return null;
  }

  return async (folder, yes) => {
    if (!isAbsolute(folder)) return { status: 400, error: `Not an absolute path: ${folder}` };
    const asked = resolve(folder);
    const isFolder = await stat(asked).then(
      (stats) => stats.isDirectory(),
      () => null,
    );
    if (isFolder === null) return { status: 404, error: `No such folder: ${asked}` };
    if (!isFolder) return { status: 400, error: `Not a folder: ${asked}` };
    // A link is judged as the folder it leads to.
    const path = await realpath(asked);
    // In a `.git` folder git names no top level: asked from the folder holding it.
    const outside = path.replace(/\/\.git(?:\/.*)?$/, '') || '/';
    const root = await repositoryOf(outside);
    // A repository holding home (a home kept in git) is no end (decision 554).
    const { home } = await guarded;
    if (root !== null && !within(home, root)) return start(outside === path ? asked : root);
    // A `.git` git does not take (a listing marks it a repository): started, so the CLI says why;
    // `git init` is never run over it.
    if (await checkoutOf(path)) return start(asked);
    const why = await refusal(path);
    if (why) return { status: 422, error: why };
    if (root !== null) {
      return {
        status: 422,
        error: `${asked} is in your home, which is kept in git: Symbiote makes no repository inside it`,
      };
    }
    if (!yes) return { status: 409, init: true, error: `${asked} is no git repository` };
    const failed = await init(path);
    if (failed !== null) return { status: 422, error: `git init failed in ${asked}: ${failed}` };
    return start(asked);
  };
}

/** `git init` in `folder`, quietly, within 10 s: null once done, else git's own words. */
export function gitInit(folder: string): Promise<string | null> {
  return new Promise((done) => {
    execFile('git', ['init', '--quiet'], { cwd: folder, timeout: 10_000 }, (error, _out, err) =>
      done(error ? err.trim() || error.message : null),
    );
  });
}
