import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultCacheDir } from '@symbiote/core';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { viewFile, writeViewRecord } from '../../cli/src/mcp-bridge.js';
import {
  announce,
  cacheDir,
  isRunning,
  readRecords,
  withdraw,
  type Running,
} from '../src/registry.js';

let cache: string;
beforeEach(() => {
  cache = tempDir();
});
afterEach(() => rmSync(cache, { recursive: true, force: true }));

const record = (over: Partial<Running> = {}): Running => ({
  url: 'http://127.0.0.1:4100/',
  pid: process.pid,
  root: '/home/me/ky',
  name: 'ky',
  started: '2026-10-28T10:00:00.000Z',
  ...over,
});

describe('announce and withdraw', () => {
  it("writes a running server's record, one file per process, and removes it", async () => {
    await announce(cache, record());
    expect(readdirSync(join(cache, 'running'))).toEqual([`${process.pid}.json`]);
    expect(JSON.parse(readFileSync(join(cache, 'running', `${process.pid}.json`), 'utf8'))).toEqual(
      record(),
    );
    expect(readRecords(cache)).toEqual([record()]);

    await withdraw(cache, process.pid);
    expect(readdirSync(join(cache, 'running'))).toEqual([]);
    // Twice, or never written: nothing to do.
    await withdraw(cache, process.pid);
  });

  it('keeps two servers of one repository apart (MC1 keeps the last one only)', async () => {
    await announce(cache, record({ pid: 101, url: 'http://127.0.0.1:4101/' }), () => true);
    await announce(cache, record({ pid: 102, url: 'http://127.0.0.1:4102/' }), () => true);
    expect(readRecords(cache).map((r) => r.pid)).toEqual([101, 102]);
  });

  it('removes the records of servers whose process is gone (a killed one)', async () => {
    await announce(cache, record({ pid: 201, url: 'http://127.0.0.1:4201/' }), () => true);
    await announce(
      cache,
      record({ pid: 202, url: 'http://127.0.0.1:4202/' }),
      (pid) => pid !== 201,
    );
    expect(readdirSync(join(cache, 'running'))).toEqual(['202.json']);
  });
});

describe('readRecords', () => {
  it('reads nothing from a cache with no records', () => {
    expect(readRecords(cache)).toEqual([]);
  });

  it("reads MC1's per-repository records, as symbiote view writes them, for servers built before", async () => {
    await writeViewRecord(viewFile(cache, '/home/me/zod/.git'), {
      url: 'http://127.0.0.1:4300/',
      pid: 300,
      root: '/home/me/zod',
      started: '2026-10-28T09:00:00.000Z',
    });
    expect(readRecords(cache)).toEqual([
      {
        url: 'http://127.0.0.1:4300/',
        pid: 300,
        root: '/home/me/zod',
        name: 'zod',
        started: '2026-10-28T09:00:00.000Z',
      },
    ]);
  });

  it('counts a server in both folders once, by its own record', async () => {
    await announce(cache, record({ name: 'ky (its own)' }));
    await writeViewRecord(viewFile(cache, '/home/me/ky/.git'), {
      url: record().url,
      pid: process.pid,
      root: record().root,
      started: record().started,
    });
    expect(readRecords(cache)).toEqual([record({ name: 'ky (its own)' })]);
  });

  it('leaves out what is not a record: broken, foreign, another address, a relative root', () => {
    const running = join(cache, 'running');
    mkdirSync(running, { recursive: true });
    writeFileSync(join(running, '1.json'), '{ not json');
    writeFileSync(join(running, '2.json'), JSON.stringify([1, 2]));
    writeFileSync(join(running, '3.json'), JSON.stringify(record({ url: 'http://example.com/' })));
    writeFileSync(join(running, '4.json'), JSON.stringify(record({ root: 'ky' })));
    writeFileSync(join(running, '5.json'), JSON.stringify({ ...record(), pid: 'five' }));
    writeFileSync(join(running, '6.tmp'), JSON.stringify(record({ pid: 6 })));
    writeFileSync(join(running, '7.json'), JSON.stringify({ ...record({ pid: 7 }), name: 7 }));
    // A record without a name is named after its folder, as the viewer names a repository.
    expect(readRecords(cache)).toEqual([record({ pid: 7 })]);
  });
});

describe('cacheDir', () => {
  it("is symbiote view's cache folder, by core's rules", () => {
    const cases: [Record<string, string>, NodeJS.Platform][] = [
      [{ SYMBIOTE_CACHE_DIR: '/tmp/c' }, 'linux'],
      [{ XDG_CACHE_HOME: '/x' }, 'linux'],
      [{}, 'linux'],
      [{}, 'darwin'],
      [{ XDG_CACHE_HOME: '/x' }, 'darwin'],
    ];
    for (const [env, platform] of cases) {
      expect(cacheDir(env, platform, '/home/me')).toBe(defaultCacheDir(env, platform, '/home/me'));
    }
  });
});

describe('isRunning', () => {
  it('is this process, and not one that ended', async () => {
    expect(isRunning(process.pid)).toBe(true);
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e', '']);
    await new Promise((resolve) => child.once('exit', resolve));
    expect(isRunning(child.pid ?? -1)).toBe(false);
  });
});
