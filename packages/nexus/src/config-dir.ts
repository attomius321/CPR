// Symbiote's folder for settings on this system, as the CLI's and the app's: the nexus does not
// import the CLI (its modules load the engine).
import { posix, win32 } from 'node:path';

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
