// The scan for repositories (NX5, decision 911): only the folder the person chose, never more.
// Breadth first and bounded, read only: folder names and each repository's `HEAD`, nothing
// written, nothing started (decision 543). Its last result is kept in the cache, so a new nexus
// shows it at once and scans again.
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
}

export interface ScanOptions {
  /** Levels under the folder: 5 finds 41 repositories in this PC's home, depth 3 already 31. */
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
 * error when `folder` itself cannot be read. Measured: `~/projects` on this PC, 256 folders and 21
 * repositories in 3–6 ms.
 */
export async function scanFolder(folder: string, options: ScanOptions = {}): Promise<ScanResult> {
  const { depth = 5, maxFolders = 5000, maxMs = 2000, leaveOut = [], now = Date.now } = options;
  const root = resolve(folder);
  const start = now();
  let read = 0;
  let short = false;
  const found: string[] = [];
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
    level = next;
  }
  found.sort();
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
  };
}

export interface Scanner {
  /** The last scan of the chosen folder (kept from the last nexus too); null when none chosen. */
  current(): Promise<ScanResult | null>;
  /** Scans the chosen folder again; null when none is chosen, or it cannot be read. */
  scan(): Promise<ScanResult | null>;
}

/**
 * The chosen folder's scans: one at a time (asked again while one runs, that one answers), the
 * last kept in `file` (the cache), written whole. A result for another folder than the one chosen
 * now is none.
 */
export function scanner({
  folder,
  file,
  options = {},
}: {
  /** The folder the person chose, read anew each time (decision 911). */
  folder: () => Promise<string | null>;
  file: string;
  options?: ScanOptions;
}): Scanner {
  let last: ScanResult | null | undefined;
  let running: Promise<ScanResult | null> | null = null;

  async function kept(): Promise<ScanResult | null> {
    if (last !== undefined) return last;
    try {
      const value = JSON.parse(await readFile(file, 'utf8')) as ScanResult | null;
      last =
        value && typeof value.folder === 'string' && Array.isArray(value.repositories)
          ? value
          : null;
    } catch {
      last = null;
    }
    return last;
  }

  async function run(): Promise<ScanResult | null> {
    const chosen = await folder();
    if (chosen === null) return null;
    let result: ScanResult | null;
    try {
      result = await scanFolder(chosen, options);
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
    current: async () => {
      const [chosen, result] = await Promise.all([folder(), kept()]);
      return chosen !== null && result?.folder === resolve(chosen) ? result : null;
    },
    scan: () => {
      running ??= run().finally(() => (running = null));
      return running;
    },
  };
}
