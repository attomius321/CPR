// This PC's folders, for the nexus's Folders tab (NX2, decision 540): a folder's folders, its
// repositories marked, and the places to start from. Folders only, no files; hidden ones left out.
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/** A folder of a listing. */
export interface Folder {
  name: string;
  /** Its absolute path, through the folder listed (a link's own, not its target's). */
  path: string;
  /** It holds a `.git` folder or file: a repository's root, or a worktree's. */
  repository: boolean;
}

/** A folder to start from: home, the running Symbiotes' folders, the top, a drive. */
export interface Place {
  kind: 'home' | 'symbiotes' | 'top' | 'drive';
  name: string;
  path: string;
}

/** A folder's folders. */
export interface Listing {
  path: string;
  /** The folder above it; null at the top. */
  parent: string | null;
  /** The root of the repository it is in (git's top level); null outside one. */
  repository: string | null;
  /** By name, the first `limit`. */
  folders: Folder[];
  /** The folders beyond `limit`, not listed. */
  more: number;
}

/** What `GET /api/folders` answers: a listing and the places. */
export interface FoldersAnswer extends Listing {
  places: Place[];
}

/** File managers' order: case aside, numbers by value (item9 before item10). */
const byName = new Intl.Collator('en', { numeric: true }).compare;

/**
 * The folders in `path`, by name; the system's error (its `code`: ENOENT, EACCES, ENOTDIR) when
 * it cannot be listed. Measured: 2–6 ms for a home folder, 38 ms for 4,950 entries (NX2 spike).
 */
export async function listFolder(
  path: string,
  {
    limit = 1000,
    repositoryOf = repositoryRoot,
  }: { limit?: number; repositoryOf?: (folder: string) => Promise<string | null> } = {},
): Promise<Listing> {
  const folder = resolve(path);
  const [entries, repository] = await Promise.all([
    readdir(folder, { withFileTypes: true }),
    repositoryOf(folder),
  ]);
  const names: string[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.name.startsWith('.')) return;
      if (
        entry.isDirectory() ||
        (entry.isSymbolicLink() && (await isFolder(join(folder, entry.name))))
      ) {
        names.push(entry.name);
      }
    }),
  );
  names.sort(byName);
  const listed = names.slice(0, limit);
  const folders = await Promise.all(
    listed.map(async (name) => {
      const at = join(folder, name);
      return { name, path: at, repository: await exists(join(at, '.git')) };
    }),
  );
  const parent = dirname(folder);
  return {
    path: folder,
    parent: parent === folder ? null : parent,
    repository,
    folders,
    more: names.length - listed.length,
  };
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The Folders tab's answer: `path`'s folders (null: the folder the newest running Symbiote is in,
 * else home) and the places.
 */
export async function folders(
  path: string | null,
  options: {
    home: string;
    /** The running Symbiotes' folders, newest first. */
    roots: readonly string[];
    drives: readonly Place[];
    repositoryOf?: (folder: string) => Promise<string | null>;
  },
): Promise<FoldersAnswer> {
  const newest = options.roots[0];
  const listing = await listFolder(path ?? (newest ? dirname(newest) : options.home), {
    ...(options.repositoryOf ? { repositoryOf: options.repositoryOf } : {}),
  });
  return { ...listing, places: places(options) };
}

/**
 * The root of the work tree `folder` is in, as `symbiote view` would serve it there (git's top
 * level); null outside one, in a `.git` folder, or when git cannot tell within a second.
 */
export function repositoryRoot(folder: string): Promise<string | null> {
  return new Promise((done) => {
    execFile(
      'git',
      ['rev-parse', '--path-format=absolute', '--show-toplevel'],
      { cwd: folder, timeout: 1000 },
      (error, stdout) => done(error ? null : stdout.trim() || null),
    );
  });
}

/**
 * Where the Folders tab starts from: home; the folders the running Symbiotes are in (`roots`,
 * newest first), three at most, home and the top aside; the top; the drives.
 */
export function places({
  home,
  roots,
  drives,
}: {
  home: string;
  roots: readonly string[];
  drives: readonly Place[];
}): Place[] {
  const theirs: Place[] = [];
  for (const root of roots) {
    const parent = dirname(root);
    if (parent === home || parent === root || theirs.some((place) => place.path === parent)) {
      continue;
    }
    theirs.push({ kind: 'symbiotes', name: basename(parent), path: parent });
    if (theirs.length === 3) break;
  }
  return [
    { kind: 'home', name: 'Home', path: home },
    ...theirs,
    { kind: 'top', name: '/', path: '/' },
    ...drives,
  ];
}

/** What `windowsDrives` reads: the kernel's version, `/mnt`'s names, whether a path is a folder. */
export interface DriveProbe {
  version: () => string;
  mnt: () => string[];
  isFolder: (path: string) => boolean;
}

const systemDrives: DriveProbe = {
  version: () => readFileSync('/proc/version', 'utf8'),
  mnt: () => readdirSync('/mnt'),
  isFolder: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
};

/** Windows' drives under WSL (`/mnt/c` as `C:`); none elsewhere. */
export function windowsDrives(probe: DriveProbe = systemDrives): Place[] {
  try {
    if (!/microsoft/i.test(probe.version())) return [];
    return probe
      .mnt()
      .filter((name) => /^[a-z]$/.test(name) && probe.isFolder(`/mnt/${name}`))
      .sort()
      .map((name) => ({ kind: 'drive', name: `${name.toUpperCase()}:`, path: `/mnt/${name}` }));
  } catch {
    return [];
  }
}
