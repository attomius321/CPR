// Hive mode (V82, decision 611): the nexus's page takes its look too, from the record each
// `symbiote view` keeps in Symbiote's config folder (`packages/cli/src/hive.ts`).
import { readFile } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Symbiote's folder for settings on this system, as the CLI's and the app's (`configDir`,
 * packages/desktop/src/state.ts); a test keeps them equal.
 */
export function configDir(env: Env, platform: NodeJS.Platform, home: string): string {
  if (platform === 'win32') {
    return win32.join(env.APPDATA ?? win32.join(home, 'AppData', 'Roaming'), 'symbiote');
  }
  if (platform === 'darwin') return posix.join(home, 'Library', 'Application Support', 'symbiote');
  return posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, '.config'), 'symbiote');
}

/** Whether Hive mode is on, by `hive.json` in `folder`; a missing or broken record is off. */
export async function hiveOn(folder: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(join(folder, 'hive.json'), 'utf8')) as unknown;
    return typeof value === 'object' && value !== null && (value as { on?: unknown }).on === true;
  } catch {
    return false;
  }
}
