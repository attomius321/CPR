// The repositories the nexus knows besides the running ones and the pins (NX5, decision 912; NX6,
// decision 925): the ones it saw running, and the ones the scan found in home. What
// `GET /api/repositories` answers; the page merges the running Symbiotes and the pins in.
import { stat } from 'node:fs/promises';
import { checkoutOf, type Folder } from './folders.js';
import type { Opened } from './opened.js';
import type { Pin } from './pins.js';
import type { ScanResult } from './scan.js';

/** A repository the nexus knows: seen running before (`opened`), found by the scan, or both. */
export interface Known extends Pick<Folder, 'branch' | 'detached'> {
  name: string;
  path: string;
  /** The last time the nexus saw its Symbiote run (ISO). */
  opened?: string;
  /** The scan found it in home. */
  found?: true;
}

/** A scan's facts, for the list's foot. */
export interface ScanSummary {
  folder: string;
  at: string;
  folders: number;
  ms: number;
  short: boolean;
  repositories: number;
}

/** What `GET /api/repositories` answers. */
export interface RepositoriesAnswer {
  /** The home folder: `~` in the paths shown, where a first run looks. */
  home: string;
  /** Windows' drives under WSL (`/mnt/c`): never made a repository, a folder on one may be. */
  drives: string[];
  /** By path. */
  repositories: Known[];
  pins: Pin[];
  /** Home's last scan (decision 925); null while it runs for the first time. */
  scan: ScanSummary | null;
}

/** What `GET /api/tree` answers: every folder the last scan of home read or found (decision 926). */
export interface TreeAnswer {
  /** The folder scanned: home. */
  folder: string;
  /** When the scan ended (ISO): the page reads the tree again when it changes. */
  at: string;
  /** By path; the repositories among them. */
  tree: string[];
  /** The folders found but not read (it stopped short): read when opened. */
  unread: string[];
}

/** What the page may ask of the scan: home scanned again, the button's (decision 925). */
export interface Scanning {
  again(): Promise<ScanSummary | null>;
  /** The last scan's tree; null before the first. */
  tree(): Promise<TreeAnswer | null>;
}

/** A scan's facts without its repositories and its tree. */
export function scanSummary(scan: ScanResult | null): ScanSummary | null {
  if (!scan) return null;
  const { folder, at, folders, ms, short, repositories } = scan;
  return { folder, at, folders, ms, short, repositories: repositories.length };
}

/** A scan's tree, as `GET /api/tree` answers it. */
export function scanTree(scan: ScanResult | null): TreeAnswer | null {
  if (!scan) return null;
  const { folder, at, tree, unread } = scan;
  return { folder, at, tree, unread };
}

/**
 * The history and the scan merged by path. A repository opened before is read again (its folder
 * may be gone, or no repository now: then it is left out), with what it has checked out.
 */
export async function knownRepositories({
  opened,
  scan,
}: {
  opened: readonly Opened[];
  scan: ScanResult | null;
}): Promise<Known[]> {
  const byPath = new Map<string, Known>();
  for (const found of scan?.repositories ?? []) byPath.set(found.path, { ...found, found: true });
  await Promise.all(
    opened.map(async (o) => {
      const scanned = byPath.get(o.path);
      if (scanned) {
        byPath.set(o.path, { ...scanned, opened: o.seen });
        return;
      }
      const folder = await stat(o.path).then(
        (stats) => stats.isDirectory(),
        () => false,
      );
      const checkout = folder ? await checkoutOf(o.path) : null;
      if (checkout) byPath.set(o.path, { name: o.name, path: o.path, ...checkout, opened: o.seen });
    }),
  );
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
