// The scan of the person's home (NX6, decision 925; NX5's decision 911 scanned one folder they
// chose): every folder in it and the repositories among them, for the list's tree. Breadth first
// and bounded, read only: folder names and each repository's `HEAD`, nothing written, nothing
// started. Its last result is kept in the cache, so a new nexus shows it at once and scans again.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { checkoutOf, within, type Folder } from './folders.js';

/** A repository the scan found: its folder's name and path, what it has checked out. */
export interface Found extends Pick<Folder, 'branch' | 'detached'> {
  name: string;
  path: string;
}

/** A scan's answer. */
export interface ScanResult {
  /** The folder scanned. */
  folder: string;
  /** When it ended (ISO). */
  at: string;
  /** The folders read. */
  folders: number;
  ms: number;
  /** It stopped at a limit: folders were left unread. */
  short: boolean;
  /** By path. */
  repositories: Found[];
  /**
   * Every folder under `folder` it read or found, the repositories among them, by path: the list's
   * tree (decision 926). Inside a repository, nothing.
   */
  tree: string[];
  /** The folders of `tree` it found but did not read (it stopped short): read when opened. */
  unread: string[];
}

export interface ScanOptions {
  /**
   * Levels under the folder; every one by default (decision 925): this PC's home is 15 levels,
   * 2,780 folders, 73–195 ms.
   */
  depth?: number;
  /** Folders read at most. */
  maxFolders?: number;
  /** Milliseconds at most. */
  maxMs?: number;
  /** Folders never read, and nothing under them: Symbiote's cache, its worktrees. */
  leaveOut?: readonly string[];
  /** The clock, in milliseconds. */
  now?: () => number;
}

/** Folders that hold builds, packages or environments, never a repository of the person's. */
export const SKIPPED = new Set([
  'node_modules',
  'vendor',
  'target',
  'dist',
  'build',
  '__pycache__',
  'venv',
]);

/** Folders read at once. */
const AT_ONCE = 16;

/**
 * The repositories in `folder`: breadth first, `depth` levels under it, hidden and skipped folders
 * left out, links never followed. A folder holding `.git` (a folder, or a worktree's file) is a
 * repository, and the end of the way down (decision 554); the folder scanned never is one (a home
 * kept in git). Stops after `maxFolders` folders or `maxMs`, saying so. Rejects with the system's
 * error when `folder` itself cannot be read. Measured on this PC: home, 2,780 folders and 42
 * repositories in 73–195 ms (NX6); C: under WSL over 30 s, never scanned.
 */
export async function scanFolder(folder: string, options: ScanOptions = {}): Promise<ScanResult> {
  const {
    depth = Infinity,
    maxFolders = 20_000,
    maxMs = 5000,
    leaveOut = [],
    now = Date.now,
  } = options;
  const root = resolve(folder);
  const start = now();
  let read = 0;
  let short = false;
  const found: string[] = [];
  const seen: string[] = [];
  const unread: string[] = [];
  const left = (path: string) => leaveOut.some((out) => within(path, out));

  /** The folders to read next under `path`, or null when it is a repository. */
  async function look(path: string, level: number): Promise<string[] | null> {
    const entries = await readdir(path, { withFileTypes: true }).catch((error: unknown) => {
      // The folder scanned must be read; one under it that cannot be is passed over.
      if (level === 0) throw error;
      return [];
    });
    if (level > 0 && entries.some((entry) => entry.name === '.git')) return null;
    if (level === depth) return [];
    return entries
      .filter(
        (entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED.has(entry.name),
      )
      .map((entry) => join(path, entry.name))
      .filter((path) => !left(path));
  }

  let level: string[] = [root];
  for (let at = 0; level.length > 0 && !short; at++) {
    const next: string[] = [];
    for (let i = 0; i < level.length && !short; i += AT_ONCE) {
      const batch: string[] = [];
      for (const path of level.slice(i, i + AT_ONCE)) {
        if (read >= maxFolders || now() - start > maxMs) {
          short = true;
          break;
        }
        read++;
        batch.push(path);
      }
      const looked = await Promise.all(batch.map((path) => look(path, at)));
      looked.forEach((children, n) => {
        if (children === null) found.push(batch[n] ?? '');
        else next.push(...children);
      });
    }
    seen.push(...next);
    level = next;
  }
  // Folders are read in the order they were found, the folder scanned first: past the first
  // `read - 1`, found and not read (it stopped short).
  unread.push(...seen.slice(read - 1));
  found.sort();
  seen.sort();
  unread.sort();
  const repositories = await Promise.all(
    found.map(async (path): Promise<Found> => ({
      name: basename(path),
      path,
      ...(await checkoutOf(path)),
    })),
  );
  return {
    folder: root,
    at: new Date().toISOString(),
    folders: read,
    ms: Math.round(now() - start),
    short,
    repositories,
    tree: seen,
    unread,
  };
}

export interface Scanner {
  /** The last scan of the folder (kept from the last nexus too); null before the first. */
  current(): Promise<ScanResult | null>;
  /** Scans the folder again; null when it cannot be read. */
  scan(): Promise<ScanResult | null>;
}

/**
 * The scans of `folder`, home (decision 925): one at a time (asked again while one runs, that one
 * answers), the last kept in `file` (the cache), written whole. A result kept for another folder
 * (NX5's chosen one), or without its tree, is none.
 */
export function scanner({
  folder,
  file,
  options = {},
}: {
  folder: string;
  file: string;
  options?: ScanOptions;
}): Scanner {
  const root = resolve(folder);
  let last: ScanResult | null | undefined;
  let running: Promise<ScanResult | null> | null = null;

  async function kept(): Promise<ScanResult | null> {
    if (last !== undefined) return last;
    try {
      const value = JSON.parse(await readFile(file, 'utf8')) as ScanResult | null;
      last =
        value &&
        value.folder === root &&
        Array.isArray(value.repositories) &&
        Array.isArray(value.tree) &&
        Array.isArray(value.unread)
          ? value
          : null;
    } catch {
      last = null;
    }
    return last;
  }

  async function run(): Promise<ScanResult | null> {
    let result: ScanResult | null;
    try {
      result = await scanFolder(root, options);
    } catch {
      result = null;
    }
    last = result;
    if (result) {
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(result)}\n`);
      await rename(temp, file);
    }
    return result;
  }

  return {
    current: kept,
    scan: () => {
      running ??= run().finally(() => (running = null));
      return running;
    },
  };
}
