// Hive mode (V82): the planned graph loop's switch, kept per person on this machine in Symbiote's
// config folder (decision 611): once Hive exists it gives an orchestrator full access to the
// machine, which a commit of `symbiote/config.json` must not turn on for every clone, and browser
// storage is per origin, each `symbiote view` a port of its own (decision 17). For now it changes
// only the look.
import { readFile } from 'node:fs/promises';
import { writeFileWhole } from './file-write.js';

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

/** The page marked for Hive's look from its first paint (decision 612): `data-hive` on `<html>`. */
export function withHive(page: string): string {
  return page.replace(/<html\b/, '<html data-hive="on"');
}
