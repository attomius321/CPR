import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { introRecord, symbioteConfigDir } from '../src/intro.js';

// The first-time intro (V39): seen once per person, recorded in Symbiote's config folder.
describe('symbioteConfigDir', () => {
  it("is the app's folder on each system", () => {
    expect(symbioteConfigDir({}, 'linux', '/home/a')).toBe('/home/a/.config/symbiote');
    expect(symbioteConfigDir({ XDG_CONFIG_HOME: '/x' }, 'linux', '/home/a')).toBe('/x/symbiote');
    expect(symbioteConfigDir({}, 'darwin', '/Users/a')).toBe(
      '/Users/a/Library/Application Support/symbiote',
    );
    expect(
      symbioteConfigDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a'),
    ).toBe('C:\\Users\\a\\AppData\\Roaming\\symbiote');
    expect(symbioteConfigDir({}, 'win32', 'C:\\Users\\a')).toBe(
      'C:\\Users\\a\\AppData\\Roaming\\symbiote',
    );
  });
});

describe('introRecord', () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is unseen until marked, then seen with the date, its folder made', async () => {
    const file = join(dir, 'config', 'symbiote', 'intro.json');
    const record = introRecord(file, { now: () => new Date('2026-10-23T10:00:00Z') });
    expect(await record.seen()).toBe(false);
    await record.markSeen();
    expect(await record.seen()).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ seen: '2026-10-23T10:00:00.000Z' });
    expect(await introRecord(file).seen()).toBe(true);
  });

  it('reads a broken or foreign file as unseen, and marking replaces it', async () => {
    const file = join(dir, 'intro.json');
    for (const text of ['{', '[]', 'null', '{"seen":1}']) {
      writeFileSync(file, text);
      expect(await introRecord(file).seen()).toBe(false);
    }
    await introRecord(file).markSeen();
    expect(await introRecord(file).seen()).toBe(true);
  });

  it('off (SYMBIOTE_INTRO=off): seen, and nothing written', async () => {
    const file = join(dir, 'intro.json');
    const record = introRecord(file, { off: true });
    expect(await record.seen()).toBe(true);
    await record.markSeen();
    expect(existsSync(file)).toBe(false);
  });

  it('a folder it cannot write fails the mark, not the reading', async () => {
    const blocked = join(dir, 'blocked');
    writeFileSync(blocked, 'a file where the folder would be');
    const record = introRecord(join(blocked, 'intro.json'));
    expect(await record.seen()).toBe(false);
    await expect(record.markSeen()).rejects.toThrow();
  });
});
