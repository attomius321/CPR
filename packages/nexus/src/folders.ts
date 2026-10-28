// This PC's folders, for the nexus's Folders tab (NX2, decision 540): a folder's folders, its
// repositories marked with what they have checked out (NX3), and the places to start from. Folders
// only, no files; hidden ones left out. A repository is the end of the way down (decision 554).
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/** A folder of a listing. */
export interface Folder {
  name: string;
  /** Its absolute path, through the folder listed (a link's own, not its target's). */
  path: string;
  /** It holds a `.git` folder or file: a repository's root, or a worktree's. */
  repository: boolean;
  /** A repository's checked-out branch, from its `HEAD` (decision 555). */
  branch?: string;
  /** A repository's commit, when its `HEAD` is detached. */
  detached?: string;
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
  /** By name, the first `limit`. */
  folders: Folder[];
  /** The folders beyond `limit`, not listed. */
  more: number;
}

/** What `GET /api/folders` answers: a listing and the places. */
export interface FoldersAnswer extends Listing {
  places: Place[];
  /**
   * The repository the folder asked for is, or is in: the listing is then the folder holding it
   * (decision 554). Null when the folder asked for is the one listed.
   */
  picked: string | null;
}

/** File managers' order: case aside, numbers by value (item9 before item10). */
const byName = new Intl.Collator('en', { numeric: true }).compare;

/**
 * The folders in `path`, by name; the system's error (its `code`: ENOENT, EACCES, ENOTDIR) when
 * it cannot be listed. Measured: 2–6 ms for a home folder, 38 ms for 4,950 entries (NX2 spike);
 * each repository's `HEAD` read with it, 3–4 ms for 46 folders and 16 repositories (NX3 spike).
 */
export async function listFolder(
  path: string,
  { limit = 1000 }: { limit?: number } = {},
): Promise<Listing> {
  const folder = resolve(path);
  const entries = await readdir(folder, { withFileTypes: true });
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
    listed.map(async (name): Promise<Folder> => {
      const at = join(folder, name);
      const checkout = await checkoutOf(at);
      return { name, path: at, repository: checkout !== null, ...checkout };
    }),
  );
  const parent = dirname(folder);
  return {
    path: folder,
    parent: parent === folder ? null : parent,
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

/**
 * What the repository in `folder` has checked out, read from its `HEAD` as git keeps it, with no
 * git process: its branch, or its commit when detached; nothing for anything else (reftable's
 * stub, a file that cannot be read). Null when the folder holds no `.git`: no repository.
 */
async function checkoutOf(folder: string): Promise<Pick<Folder, 'branch' | 'detached'> | null> {
  const dotGit = join(folder, '.git');
  let gitDir = dotGit;
  try {
    if (!(await stat(dotGit)).isDirectory()) {
      // A worktree's `.git` file names its folder, absolute or relative to the worktree.
      const named = /^gitdir:\s*(.+)$/m.exec(await readFile(dotGit, 'utf8'))?.[1]?.trim();
      if (!named) return {};
      gitDir = resolve(folder, named);
    }
  } catch {
    return null;
  }
  try {
    const head = (await readFile(join(gitDir, 'HEAD'), 'utf8')).trim();
    const branch = /^ref: refs\/heads\/(.+)$/.exec(head)?.[1];
    if (branch !== undefined && branch !== '.invalid') return { branch };
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head) ? { detached: head } : {};
  } catch {
    return {};
  }
}

/**
 * The Folders tab's answer: `path`'s folders (null: the folder the newest running Symbiote is in,
 * else home) and the places. A repository is the end of the way down (decision 554): for a
 * folder in one (git's top level, the root and its `.git` included) the answer is the folder
 * holding it, the repository `picked`; for one in another's folders, the outermost. A repository
 * holding home (a home kept in git) is no end: else every folder would be in it.
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
  const repositoryOf = options.repositoryOf ?? repositoryRoot;
  const newest = options.roots[0];
  // In a `.git` folder git names no top level: asked from the folder holding it.
  let at = resolve(path ?? (newest ? dirname(newest) : options.home)).replace(
    /\/\.git(?:\/.*)?$/,
    '',
  );
  let picked: string | null = null;
  for (;;) {
    // Listed while git is asked: a folder outside any repository is the usual answer.
    const [listing, root] = await Promise.all([
      listFolder(at).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      ),
      repositoryOf(at),
    ]);
    if (root === null || within(options.home, root)) {
      if ('error' in listing) throw listing.error;
      return { ...listing.value, picked, places: places(options) };
    }
    picked = root;
    at = dirname(root);
  }
}

/** `path` is `folder` or inside it. */
function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
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
