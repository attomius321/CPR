import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openRepo } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import type { HiveRecord } from '../src/hive.js';
import { nucleusStart, repositoryNucleusStart } from '../src/nucleus-start.js';

// Nucleus's start without a Confirm (NU3, decisions 782, 783): the person's setting, kept as Hive
// mode is, and on whatever it says while Hive is on.
describe('repositoryNucleusStart', () => {
  let repos: TestRepo[];
  let cache: string;
  const repository = () => {
    const repo = createRepo();
    repo.git('config', 'user.email', 'nucleus@example.com');
    repo.write({ 'a.ts': 'export const a = 1;\n' });
    repo.commit('one');
    repos.push(repo);
    return repo;
  };
  beforeEach(() => {
    repos = [];
    cache = tempDir();
  });
  afterEach(() => {
    for (const repo of repos) repo.cleanup();
    rmSync(cache, { recursive: true, force: true });
  });

  it("is off until the person turns it on, in the repository's symbiote/, out of git", async () => {
    const one = repository();
    const setting = repositoryNucleusStart(await openRepo(one.root), cache, {
      now: () => new Date('2026-11-02T08:00:00Z'),
    });
    expect(await setting.on()).toBe(false);
    await setting.set(true);
    expect(await setting.on()).toBe(true);
    expect(
      JSON.parse(readFileSync(join(one.root, 'symbiote', 'nucleus-start.json'), 'utf8')),
    ).toEqual({ on: true, since: '2026-11-02T08:00:00.000Z' });
    expect(one.git('status', '--porcelain', '--untracked-files=all')).toBe('');
    expect(existsSync(join(one.root, 'symbiote', 'hive.json'))).toBe(false);
    await setting.set(false);
    expect(await setting.on()).toBe(false);
  });

  it('a record git tracks reads as off: a commit never turns it on', async () => {
    const one = repository();
    one.write({ 'symbiote/nucleus-start.json': '{"on":true}\n' });
    one.git('add', '--force', 'symbiote/nucleus-start.json');
    one.git('commit', '--quiet', '--message', 'No Confirms for everyone');
    expect(await repositoryNucleusStart(await openRepo(one.root), cache).on()).toBe(false);
  });
});

describe('nucleusStart', () => {
  const record = (on: boolean): HiveRecord & { sets: boolean[] } => {
    const sets: boolean[] = [];
    return {
      sets,
      on: () => Promise.resolve(on),
      set: (value) => {
        sets.push(value);
        on = value;
        return Promise.resolve();
      },
    };
  };

  it('says why a start goes without a Confirm: Hive first, then the setting, else none', async () => {
    expect(await nucleusStart(record(false), record(false)).why()).toBeUndefined();
    expect(await nucleusStart(record(true), record(false)).why()).toBe('setting');
    expect(await nucleusStart(record(false), record(true)).why()).toBe('hive');
    expect(await nucleusStart(record(true), record(true)).why()).toBe('hive');
    expect(await nucleusStart(record(true)).why()).toBe('setting');
  });

  it("answers Settings: what holds, the person's own choice, Hive", async () => {
    expect(await nucleusStart(record(false), record(true)).read()).toEqual({
      withoutConfirm: true,
      own: false,
      hive: true,
    });
    expect(await nucleusStart(record(true), record(false)).read()).toEqual({
      withoutConfirm: true,
      own: true,
      hive: false,
    });
  });

  it('is not changed while Hive is on: the choice stays for when Hive is off', async () => {
    const own = record(false);
    const hive = record(true);
    const start = nucleusStart(own, hive);
    await expect(start.set(true)).rejects.toThrow(/Hive mode is on/);
    expect(own.sets).toEqual([]);
    await hive.set(false);
    await start.set(true);
    expect(await start.read()).toEqual({ withoutConfirm: true, own: true, hive: false });
  });

  it('reads a failing record as off', async () => {
    const failing: HiveRecord = {
      on: () => Promise.reject(new Error('EIO')),
      set: () => Promise.resolve(),
    };
    expect(await nucleusStart(failing, failing).why()).toBeUndefined();
  });
});
