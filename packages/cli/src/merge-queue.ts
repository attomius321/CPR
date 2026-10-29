// The merger's queue (V26a): a repository's merges in Symbiote's cache (`merges.json`), changed
// one write at a time in a process, and the pid lock by which one Symbiote process merges.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MergeEntry } from '@symbiote/core';
import { writeFileWhole } from './file-write.js';

/** The queue of merges kept in `stateDir`, and its lock. */
export function mergeQueue(stateDir: string) {
  const queueFile = join(stateDir, 'merges.json');
  const lockFile = join(stateDir, 'merges.lock');

  async function read(): Promise<MergeEntry[]> {
    try {
      const value = JSON.parse(await readFile(queueFile, 'utf8')) as { merges?: unknown };
      return Array.isArray(value.merges) ? (value.merges as MergeEntry[]) : [];
    } catch {
      return [];
    }
  }

  /** One change to the queue file at a time in this process. */
  let writing: Promise<unknown> = Promise.resolve();
  function change<T>(task: (merges: MergeEntry[]) => T | Promise<T>): Promise<T> {
    const next = writing.then(async () => {
      const merges = await read();
      const result = await task(merges);
      await writeFileWhole(queueFile, `${JSON.stringify({ merges }, null, 2)}\n`);
      return result;
    });
    writing = next.catch(() => undefined);
    return next;
  }

  /** A pid lock: one Symbiote process merges in a repository; null when another holds it. */
  async function lock(): Promise<(() => Promise<void>) | null> {
    await mkdir(stateDir, { recursive: true });
    try {
      await writeFile(lockFile, `${process.pid}\n`, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await lockedElsewhere()) return null;
      await rm(lockFile, { force: true });
      return lock();
    }
    return () => rm(lockFile, { force: true });
  }

  /** Whether a live process other than this one holds the lock. */
  async function lockedElsewhere(): Promise<boolean> {
    const pid = Number((await readFile(lockFile, 'utf8').catch(() => '')).trim());
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  /** Resolves once the changes asked for so far are written. */
  const written = () => writing;

  return { lockFile, read, change, written, lock, lockedElsewhere };
}
