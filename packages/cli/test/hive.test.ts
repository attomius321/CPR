import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRepo } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { hiveRecord, repositoryHive, withHive } from '../src/hive.js';

// Hive mode's record in a file (V82).
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

// Per repository (decision 621): `symbiote/hive.json` beside the reviews, never committed.
describe('repositoryHive', () => {
  let repos: TestRepo[];
  let cache: string;
  /** A repository with a commit, its reviews in `symbiote/` (a git user of its own). */
  const repository = () => {
    const repo = createRepo();
    repo.git('config', 'user.email', 'hive@example.com');
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

  it("is kept in the repository's symbiote/, out of git; another repository stays off", async () => {
    const one = repository();
    const other = repository();
    const hive = repositoryHive(await openRepo(one.root), cache, {
      now: () => new Date('2026-10-30T20:00:00Z'),
    });
    expect(await hive.on()).toBe(false);
    await hive.set(true);
    expect(await hive.on()).toBe(true);
    expect(JSON.parse(readFileSync(join(one.root, 'symbiote', 'hive.json'), 'utf8'))).toEqual({
      on: true,
      since: '2026-10-30T20:00:00.000Z',
    });
    expect(one.git('status', '--porcelain', '--untracked-files=all')).toBe('');
    expect(await repositoryHive(await openRepo(other.root), cache).on()).toBe(false);
    expect(existsSync(join(other.root, 'symbiote'))).toBe(false);
    await hive.set(false);
    expect(await hive.on()).toBe(false);
  });

  it("is shared by the repository's worktrees", async () => {
    const one = repository();
    const linked = join(tempDir(), 'linked');
    one.git('worktree', 'add', '--quiet', '-b', 'topic', linked);
    try {
      await repositoryHive(await openRepo(linked), cache).set(true);
      expect(existsSync(join(one.root, 'symbiote', 'hive.json'))).toBe(true);
      expect(await repositoryHive(await openRepo(one.root), cache).on()).toBe(true);
    } finally {
      rmSync(linked, { recursive: true, force: true });
    }
  });

  it('a record git tracks reads as off: a commit never turns it on', async () => {
    const one = repository();
    one.write({ 'symbiote/hive.json': '{"on":true}\n' });
    one.git('add', '--force', 'symbiote/hive.json');
    one.git('commit', '--quiet', '--message', 'Hive on for everyone');
    expect(await repositoryHive(await openRepo(one.root), cache).on()).toBe(false);
  });

  it("is in Symbiote's cache where the reviews are, when symbiote/ is the project's", async () => {
    const one = repository();
    one.write({ 'symbiote/index.ts': 'export {};\n' });
    one.commit('a folder of the project named symbiote');
    const repo = await openRepo(one.root);
    const hive = repositoryHive(repo, cache);
    await hive.set(true);
    expect(await hive.on()).toBe(true);
    expect(existsSync(join(one.root, 'symbiote', 'hive.json'))).toBe(false);
    expect(existsSync(join(cache, 'state', repo.id, 'hive.json'))).toBe(true);
    expect(one.git('status', '--porcelain', '--untracked-files=all')).toBe('');
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
