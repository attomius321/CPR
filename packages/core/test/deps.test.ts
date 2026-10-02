import { mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { linkNodeModules } from '../src/deps.js';

describe('linkNodeModules', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('links node_modules folders, and links to them, into the same place', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cpr-deps-'));
    const origin = join(dir, 'origin');
    const target = join(dir, 'target');
    const shared = join(dir, 'shared-install');
    for (const folder of [
      join(origin, 'node_modules'),
      join(origin, 'app'),
      join(origin, 'docs'),
      join(target, 'app'),
      join(target, 'docs'),
      shared,
    ]) {
      mkdirSync(folder, { recursive: true });
    }
    // `app/node_modules` links to an install elsewhere; `docs/node_modules` to a file.
    symlinkSync(shared, join(origin, 'app', 'node_modules'), 'dir');
    writeFileSync(join(dir, 'file'), '');
    symlinkSync(join(dir, 'file'), join(origin, 'docs', 'node_modules'));

    expect(await linkNodeModules(origin, target)).toBe(2);
    expect(readlinkSync(join(target, 'node_modules'))).toBe(join(origin, 'node_modules'));
    expect(readlinkSync(join(target, 'app', 'node_modules'))).toBe(
      join(origin, 'app', 'node_modules'),
    );
  });
});
