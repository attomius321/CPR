// Where running Symbiotes say they are (NX1, decision 520): one record per `symbiote view` server,
// `<cache>/running/<pid>.json`, written when it serves and removed when it stops. `symbiote view`
// writes it through this module and the nexus reads it, so the two share one format. Node's
// modules only: the CLI imports it, and nothing else of the nexus.
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';

type Env = Readonly<Record<string, string | undefined>>;

/** A running `symbiote view`: where it serves, which process, which folder. */
export interface Running {
  /** `http://127.0.0.1:<port>/`. */
  url: string;
  pid: number;
  /** The folder it serves: the repository's, or a worktree's. */
  root: string;
  /** The root's folder name, as the viewer names the repository. */
  name: string;
  /** When it started serving (ISO). */
  started: string;
}

/**
 * Symbiote's cache folder by `@symbiote/core`'s `defaultCacheDir` rules (`SYMBIOTE_CACHE_DIR`,
 * `XDG_CACHE_HOME`, macOS's Caches, `~/.cache`). Not imported from core, which loads the engine
 * (decision 527); a test keeps the two equal.
 */
export function cacheDir(env: Env, platform: NodeJS.Platform, home: string): string {
  if (env.SYMBIOTE_CACHE_DIR) return env.SYMBIOTE_CACHE_DIR;
  if (env.XDG_CACHE_HOME) return join(env.XDG_CACHE_HOME, 'symbiote');
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'symbiote');
  return join(home, '.cache', 'symbiote');
}

const runningDir = (cache: string) => join(cache, 'running');

/** Whether a process lives: one of another user's counts. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Says that a server runs: its record, written whole (a reader may read at any time). The records
 * of servers whose process is gone (a killed one leaves its own) are removed on the way.
 */
export async function announce(
  cache: string,
  record: Running,
  alive: (pid: number) => boolean = isRunning,
): Promise<void> {
  const dir = runningDir(cache);
  await mkdir(dir, { recursive: true });
  for (const name of await readdir(dir)) {
    const pid = Number(/^(\d+)\.json$/.exec(name)?.[1]);
    if (Number.isInteger(pid) && pid !== record.pid && !alive(pid)) {
      await rm(join(dir, name), { force: true });
    }
  }
  const file = join(dir, `${record.pid}.json`);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temp, file);
}

/** Says that a server stopped: its record removed. */
export async function withdraw(cache: string, pid: number): Promise<void> {
  await rm(join(runningDir(cache), `${pid}.json`), { force: true });
}

/**
 * The records of the servers that said they run: each one's own (`running/`), then MC1's, one per
 * repository (`views/`, decision 358), for servers built before NX1. A server in both is one.
 * Whether each still runs is for the reader to ask.
 */
export function readRecords(cache: string): Running[] {
  const own = readFolder(runningDir(cache));
  const urls = new Set(own.map((record) => record.url));
  const views = readFolder(join(cache, 'views')).filter((record) => !urls.has(record.url));
  return [...own, ...views];
}

/** The record of the server `pid`, if it says it runs. */
export function readRecord(cache: string, pid: number): Running | null {
  return parseRecord(readJson(join(runningDir(cache), `${pid}.json`)));
}

function readFolder(dir: string): Running[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const records: Running[] = [];
  for (const name of names.sort(byNumber)) {
    const record = parseRecord(readJson(join(dir, name)));
    if (record) records.push(record);
  }
  return records;
}

/** Records by their pid when named by one, so a folder reads in a fixed order. */
const byNumber = (a: string, b: string) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b);

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** A record, or null when the value is not one: a local address, a process, an absolute root. */
export function parseRecord(value: unknown): Running | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.url !== 'string' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(v.url)) {
    return null;
  }
  if (typeof v.pid !== 'number' || !Number.isInteger(v.pid) || v.pid <= 0) return null;
  if (typeof v.root !== 'string' || !isAbsolute(v.root)) return null;
  return {
    url: v.url,
    pid: v.pid,
    root: v.root,
    name: typeof v.name === 'string' && v.name !== '' ? v.name : basename(v.root),
    started: typeof v.started === 'string' ? v.started : '',
  };
}
