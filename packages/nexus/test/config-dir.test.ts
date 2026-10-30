import { describe, expect, it } from 'vitest';
import { configDir as appConfigDir } from '../../desktop/src/state.js';
import { configDir } from '../src/config-dir.js';

describe('configDir', () => {
  it("is the app's folder on each system", () => {
    for (const [env, platform, home] of [
      [{}, 'linux', '/home/a'],
      [{ XDG_CONFIG_HOME: '/x' }, 'linux', '/home/a'],
      [{}, 'darwin', '/Users/a'],
      [{ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a'],
      [{}, 'win32', 'C:\\Users\\a'],
    ] as const) {
      expect(configDir(env, platform, home)).toBe(appConfigDir(env, platform, home));
    }
  });
});
