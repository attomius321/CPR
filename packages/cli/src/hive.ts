// Hive mode (V82): the planned graph loop's switch, kept per repository in its `symbiote/` beside
// the reviews (decision 621, which replaced 611's one switch for the machine): each repository's
// `symbiote view` has its own. Never committed: once Hive exists it gives an orchestrator full
// access to the machine, which a commit must not turn on for every clone. Not browser storage:
// each `symbiote view` is a port, so an origin, of its own (decision 17). For now it changes only
// the look.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mainWorktree, trackedFiles, type GitRepo } from '@symbiote/core';
import { writeFileWhole } from './file-write.js';
import { prepareSymbioteFolder, reviewPlace } from './reviews.js';

/** Whether Hive mode is on, and turning it on or off (`/api/hive`). */
export interface HiveRecord {
  on(): Promise<boolean>;
  set(on: boolean): Promise<void>;
}

/**
 * Hive mode's record in `file` (`{ "on": true, "since": "<ISO date>" }`); a missing, broken or
 * foreign file reads as off.
 */
export function hiveRecord(file: string, { now = () => new Date() } = {}): HiveRecord {
  return {
    async on() {
      try {
        const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
        return (
          typeof value === 'object' && value !== null && (value as { on?: unknown }).on === true
        );
      } catch {
        return false;
      }
    },
    async set(on) {
      const record = on ? { on, since: now().toISOString() } : { on };
      await writeFileWhole(file, `${JSON.stringify(record, null, 2)}\n`);
    },
  };
}

/**
 * Hive mode's record for `repo` (decision 621): `hive.json` in its `symbiote/` beside the reviews,
 * the main checkout's, so its worktrees share it; in Symbiote's cache where the reviews are kept
 * there (`reviewPlace`). Written after `symbiote/.gitignore`; a record git tracks reads as off, so
 * a commit never turns it on.
 */
export function repositoryHive(
  repo: GitRepo,
  cacheDir: string,
  { now = () => new Date() } = {},
): HiveRecord {
  const place = async () => {
    const where = await reviewPlace(repo, cacheDir);
    return { where, record: hiveRecord(join(dirname(where.dir), 'hive.json'), { now }) };
  };
  return {
    async on() {
      const { where, record } = await place();
      if (!(await record.on())) return false;
      if (where.place === 'cache') return true;
      const main = { ...repo, root: mainWorktree(repo) };
      return (await trackedFiles(main, 'symbiote/hive.json')).length === 0;
    },
    async set(on) {
      const { where, record } = await place();
      await prepareSymbioteFolder(where, { agents: false });
      await record.set(on);
    },
  };
}

/** The page marked for Hive's look from its first paint (decision 612): `data-hive` on `<html>`. */
export function withHive(page: string): string {
  return page.replace(/<html\b/, '<html data-hive="on"');
}
