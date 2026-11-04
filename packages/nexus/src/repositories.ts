// The repositories the nexus knows besides the running ones and the pins (NX5, decisions 911,
// 912): the ones it saw running, and the ones the scan found in the folder the person chose.
// What `GET /api/repositories` answers; the page merges the running Symbiotes and the pins in.
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
  /** The scan found it in the folder chosen. */
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
  /** By path. */
  repositories: Known[];
  pins: Pin[];
  /** Null while no folder is chosen. */
  scan: ScanSummary | null;
}

/** What the page may ask of the scan. */
export interface Scanning {
  /** Chooses the folder to scan (null: none), scans it, answers the scan; or why not. */
  choose(
    path: string | null,
  ): Promise<{ scan: ScanSummary | null } | { status: 400 | 404 | 422; error: string }>;
  /** Scans the chosen folder again. */
  again(): Promise<ScanSummary | null>;
}

/** A scan's facts without its repositories. */
export function scanSummary(scan: ScanResult | null): ScanSummary | null {
  if (!scan) return null;
  const { repositories, ...facts } = scan;
  return { ...facts, repositories: repositories.length };
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
