import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

type Env = Readonly<Record<string, string | undefined>>;

/** Days of files kept (LG1, decision 351): today and the 13 before it. */
export const KEEP_DAYS = 14;

/**
 * The folder every Symbiote process writes its lines in: `SYMBIOTE_LOG_DIR`, else `logs` in the
 * cache folder by `@symbiote/core`'s `defaultCacheDir` rules (`SYMBIOTE_CACHE_DIR`,
 * `XDG_CACHE_HOME`, macOS's Caches, `~/.cache`). Not imported from core: the app reads no core.
 */
export function logsDir(env: Env, platform: NodeJS.Platform, home: string): string {
  if (env.SYMBIOTE_LOG_DIR) return env.SYMBIOTE_LOG_DIR;
  const cache = env.SYMBIOTE_CACHE_DIR
    ? env.SYMBIOTE_CACHE_DIR
    : env.XDG_CACHE_HOME
      ? join(env.XDG_CACHE_HOME, 'symbiote')
      : platform === 'darwin'
        ? join(home, 'Library', 'Caches', 'symbiote')
        : join(home, '.cache', 'symbiote');
  return join(cache, 'logs');
}

const two = (n: number) => String(n).padStart(2, '0');

/** A local day's name, `2026-10-25`: its lines are in `<day>.jsonl`. */
export function dayOf(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** The local midnight after `date`, in milliseconds: when a writer moves to the next file. */
export function nextDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

/** Removes the day files older than `keep` days (today is one); answers the names removed. */
export async function pruneLogs(dir: string, now: Date, keep = KEEP_DAYS): Promise<string[]> {
  const oldest = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (keep - 1)));
  const names = await readdir(dir).catch(() => [] as string[]);
  // `YYYY-MM-DD` names sort as their days do.
  const removed = names.filter((name) => DAY_FILE.test(name) && name.slice(0, 10) < oldest);
  await Promise.all(removed.map((name) => rm(join(dir, name), { force: true })));
  return removed;
}
