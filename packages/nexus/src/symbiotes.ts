import type { Running } from './registry.js';

/** What a Symbiote's `GET /api/status` says of its checkout, as the nexus shows it. */
export interface Status {
  /** The branch checked out; null when HEAD is detached. */
  branch: string | null;
  /** HEAD's commit; null in a repository without commits. */
  head: string | null;
  /** Tracked files with local changes. */
  changed: number;
}

/** A running Symbiote: its record and its checkout. */
export type Symbiote = Running & Status;

/** How the nexus asks whether a recorded server is alive. */
export interface Probe {
  alive: (pid: number) => boolean;
  status: (url: string) => Promise<Status | null>;
}

/**
 * The Symbiotes that run (decision 520): records whose process lives and whose server answers its
 * status, the rest left out. One per folder, the newest, since a folder is one tab; by name.
 */
export async function liveSymbiotes(
  records: readonly Running[],
  probe: Probe,
): Promise<Symbiote[]> {
  const checked = await Promise.all(
    records.map(async (record) => {
      if (!probe.alive(record.pid)) return null;
      const status = await probe.status(record.url);
      return status ? { ...record, ...status } : null;
    }),
  );
  const byRoot = new Map<string, Symbiote>();
  for (const symbiote of checked) {
    if (!symbiote) continue;
    const other = byRoot.get(symbiote.root);
    if (!other || other.started < symbiote.started) byRoot.set(symbiote.root, symbiote);
  }
  return [...byRoot.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root),
  );
}

/** A Symbiote's status, or null when nothing answers as one within `timeout` ms. */
export async function readStatus(url: string, timeout = 1000): Promise<Status | null> {
  try {
    const res = await fetch(new URL('api/status', url), { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;
    const value = (await res.json()) as Record<string, unknown> | null;
    const { branch, head, changed } = value ?? {};
    if (typeof changed !== 'number' || typeof value?.version !== 'string') return null;
    return {
      branch: typeof branch === 'string' ? branch : null,
      head: typeof head === 'string' ? head : null,
      changed,
    };
  } catch {
    return null;
  }
}
