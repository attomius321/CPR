import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { hiveRecord, withHive } from '../src/hive.js';

// Hive mode (V82, decision 611): per person on this machine, in Symbiote's config folder.
describe('hiveRecord', () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is off until turned on, then on with the date, its folder made; off again', async () => {
    const file = join(dir, 'config', 'symbiote', 'hive.json');
    const record = hiveRecord(file, { now: () => new Date('2026-10-30T18:00:00Z') });
    expect(await record.on()).toBe(false);
    await record.set(true);
    expect(await record.on()).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      on: true,
      since: '2026-10-30T18:00:00.000Z',
    });
    expect(await hiveRecord(file).on()).toBe(true);
    await record.set(false);
    expect(await record.on()).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ on: false });
  });

  it('reads a broken or foreign file as off', async () => {
    const file = join(dir, 'hive.json');
    for (const text of ['{', '[]', 'null', '{"on":"yes"}', '{"on":1}', '{}']) {
      writeFileSync(file, text);
      expect(await hiveRecord(file).on()).toBe(false);
    }
  });

  it('a folder it cannot write fails the change, not the reading', async () => {
    const blocked = join(dir, 'blocked');
    writeFileSync(blocked, 'a file where the folder would be');
    const record = hiveRecord(join(blocked, 'hive.json'));
    expect(await record.on()).toBe(false);
    await expect(record.set(true)).rejects.toThrow();
  });
});

describe('withHive', () => {
  it("marks the page's <html> for the first paint", () => {
    expect(withHive('<!doctype html>\n<html lang="en">\n<head></head>')).toBe(
      '<!doctype html>\n<html data-hive="on" lang="en">\n<head></head>',
    );
    expect(withHive('<html>viewer</html>')).toBe('<html data-hive="on">viewer</html>');
  });

  it('leaves a page without <html> as it is', () => {
    expect(withHive('<p>no root</p>')).toBe('<p>no root</p>');
  });
});
