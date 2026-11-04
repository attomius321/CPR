// What the nexus remembers (NX5, decision 912): each Symbiote it saw running, for "Opened
// before". MC1's `<cache>/views/` records are removed when a view stops, so the nexus keeps its
// own, in its cache folder; a Symbiote that ran while no nexus ran is not in it.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

/** A Symbiote seen running: its folder, its name, the last time seen (ISO). */
export interface Opened {
  path: string;
  name: string;
  seen: string;
}

/** The Symbiotes seen, newest first, each folder once; none when the file is missing or broken. */
export async function readOpened(file: string): Promise<Opened[]> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
  const list = (value as { opened?: unknown } | null)?.opened;
  if (!Array.isArray(list)) return [];
  const seen = new Map<string, Opened>();
  for (const item of list as Partial<Opened>[]) {
    if (typeof item?.path !== 'string' || !isAbsolute(item.path)) continue;
    if (typeof item.name !== 'string' || typeof item.seen !== 'string') continue;
    const other = seen.get(item.path);
    if (!other || other.seen < item.seen)
      seen.set(item.path, { path: item.path, name: item.name, seen: item.seen });
  }
  return [...seen.values()].sort((a, b) => b.seen.localeCompare(a.seen));
}

export interface History {
  /** Notes the Symbiotes running now; written when one is new, or a minute after the last write. */
  note(running: readonly { root: string; name: string }[]): Promise<void>;
  /** The Symbiotes seen, newest first. */
  read(): Promise<Opened[]>;
}

/** The history in `file`: at most `limit`, written whole through a file renamed into place. */
export function history({
  file,
  limit = 50,
  every = 60_000,
  now = Date.now,
}: {
  file: string;
  limit?: number;
  /** Milliseconds before a Symbiote already noted is written again with its new time. */
  every?: number;
  now?: () => number;
}): History {
  let list: Opened[] | null = null;
  let wrote = 0;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Opened[]> {
    list ??= await readOpened(file);
    return list;
  }

  async function note(running: readonly { root: string; name: string }[]): Promise<void> {
    const current = await load();
    const time = now();
    const fresh = running.some((symbiote) => !current.some((o) => o.path === symbiote.root));
    if (running.length === 0 || (!fresh && time - wrote < every)) return;
    const seen = new Date(time).toISOString();
    const roots = new Set(running.map((symbiote) => symbiote.root));
    list = [
      ...running.map((symbiote) => ({ path: symbiote.root, name: symbiote.name, seen })),
      ...current.filter((o) => !roots.has(o.path)),
    ].slice(0, limit);
    wrote = time;
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify({ opened: list }, null, 2)}\n`);
    await rename(temp, file);
  }

  return {
    note: (running) => {
      const done = queue.then(() => note(running));
      queue = done.catch(() => undefined);
      return done;
    },
    read: async () => [...(await load())],
  };
}
