// The first-time intro (V39): two koi form the S over the first page a person opens. Seen once
// per person, whichever repository or window: recorded in Symbiote's config folder, since browser
// storage is per origin and each `symbiote view` has a port of its own (decision 17).
import { readFile } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { writeFileWhole } from './file-write.js';

type Env = Readonly<Record<string, string | undefined>>;

/** Whether the intro was seen, and recording that it was (`/api/intro`). */
export interface IntroRecord {
  seen(): Promise<boolean>;
  markSeen(): Promise<void>;
}

/**
 * Symbiote's folder for settings on this system: the app's too (`configDir`,
 * packages/desktop/src/state.ts).
 */
export function symbioteConfigDir(env: Env, platform: NodeJS.Platform, home: string): string {
  if (platform === 'win32') {
    return win32.join(env.APPDATA ?? win32.join(home, 'AppData', 'Roaming'), 'symbiote');
  }
  if (platform === 'darwin') return posix.join(home, 'Library', 'Application Support', 'symbiote');
  return posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, '.config'), 'symbiote');
}

/**
 * The intro's record in `file` (`{ "seen": "<ISO date>" }`); a missing, broken or foreign file
 * reads as unseen. `off` (`SYMBIOTE_INTRO=off`): seen, and nothing written.
 */
export function introRecord(
  file: string,
  { off = false, now = () => new Date() }: { off?: boolean; now?: () => Date } = {},
): IntroRecord {
  return {
    async seen() {
      if (off) return true;
      try {
        const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
        return (
          typeof value === 'object' &&
          value !== null &&
          typeof (value as { seen?: unknown }).seen === 'string'
        );
      } catch {
        return false;
      }
    },
    async markSeen() {
      if (off) return;
      await writeFileWhole(file, `${JSON.stringify({ seen: now().toISOString() }, null, 2)}\n`);
    },
  };
}
