import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { configDir as appConfigDir } from '../../desktop/src/state.js';
import { configDir, hiveOn } from '../src/hive.js';

const dir = mkdtempSync(join(tmpdir(), 'symbiote-nexus-hive-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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

describe('hiveOn', () => {
  it('is on only when the record says so', async () => {
    mkdirSync(join(dir, 'symbiote'));
    const folder = join(dir, 'symbiote');
    expect(await hiveOn(folder)).toBe(false);
    writeFileSync(join(folder, 'hive.json'), '{"on":true,"since":"2026-10-30T18:00:00.000Z"}');
    expect(await hiveOn(folder)).toBe(true);
    for (const text of ['{"on":false}', '{', '{"on":"yes"}', 'null']) {
      writeFileSync(join(folder, 'hive.json'), text);
      expect(await hiveOn(folder)).toBe(false);
    }
  });
});
