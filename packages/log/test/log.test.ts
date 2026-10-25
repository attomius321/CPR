import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openLog, silentLog } from '../src/index.js';

const folder = () => mkdtempSync(join(tmpdir(), 'symbiote-log-'));

/** The lines of the only file in `dir`, parsed. */
function lines(dir: string): Record<string, unknown>[] {
  const files = readdirSync(dir);
  expect(files).toHaveLength(1);
  return readFileSync(join(dir, files[0] ?? ''), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('openLog', () => {
  it("writes a JSON line to the day's file, on disk when the call returns", () => {
    const dir = folder();
    const now = () => new Date(2026, 9, 25, 14, 2, 11, 348);
    const { log, file } = openLog({ process: 'view', env: { SYMBIOTE_LOG_DIR: dir }, now });
    log.info({ method: 'GET', path: '/api/workspaces', status: 200 }, 'request');
    expect(file).toBe(join(dir, '2026-10-25.jsonl'));
    const [line] = lines(dir);
    expect(line).toMatchObject({
      level: 'info',
      pid: process.pid,
      process: 'view',
      method: 'GET',
      path: '/api/workspaces',
      status: 200,
      msg: 'request',
    });
    // The time as ISO text, the level as a word: read as they are by Loki, lnav and a person.
    expect(line?.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(line).not.toHaveProperty('hostname');
  });

  it('writes info and above by default; SYMBIOTE_LOG_LEVEL changes it', () => {
    const dir = folder();
    const { log } = openLog({ process: 'view', env: { SYMBIOTE_LOG_DIR: dir } });
    log.debug('hidden');
    log.info('shown');
    log.warn('shown too');
    expect(lines(dir).map((line) => line.msg)).toEqual(['shown', 'shown too']);

    const verbose = folder();
    openLog({
      process: 'view',
      env: { SYMBIOTE_LOG_DIR: verbose, SYMBIOTE_LOG_LEVEL: 'debug' },
    }).log.debug('kept');
    expect(lines(verbose).map((line) => line.level)).toEqual(['debug']);

    const unknown = folder();
    const { log: odd } = openLog({
      process: 'view',
      env: { SYMBIOTE_LOG_DIR: unknown, SYMBIOTE_LOG_LEVEL: 'loud' },
    });
    odd.debug('hidden');
    odd.info('shown');
    expect(lines(unknown).map((line) => line.msg)).toEqual(['shown']);
  });

  it('writes nothing and makes no folder with SYMBIOTE_LOG=off', () => {
    const dir = join(folder(), 'logs');
    const { log, file } = openLog({
      process: 'view',
      env: { SYMBIOTE_LOG_DIR: dir, SYMBIOTE_LOG: 'off' },
    });
    log.error('nowhere');
    expect(file).toBeNull();
    expect(existsSync(dir)).toBe(false);
  });

  it('writes an error with its type, message, stack and causes', () => {
    const dir = folder();
    const { log } = openLog({ process: 'view', env: { SYMBIOTE_LOG_DIR: dir } });
    const err = new TypeError('outer', { cause: new Error('inner') });
    log.error({ err }, 'request failed');
    const [line] = lines(dir);
    const written = line?.err as { type: string; message: string; stack: string };
    expect(written.type).toBe('TypeError');
    expect(written.message).toBe('outer: inner');
    expect(written.stack).toContain('TypeError: outer');
    expect(written.stack).toContain('caused by: Error: inner');
  });

  it("moves to the next day's file at local midnight", () => {
    const dir = folder();
    let at = new Date(2026, 9, 25, 23, 59, 59, 900);
    const { log } = openLog({ process: 'view', env: { SYMBIOTE_LOG_DIR: dir }, now: () => at });
    log.info('before');
    at = new Date(2026, 9, 26, 0, 0, 0, 100);
    log.info('after');
    expect(readdirSync(dir).sort()).toEqual(['2026-10-25.jsonl', '2026-10-26.jsonl']);
    const read = (name: string) => readFileSync(join(dir, name), 'utf8');
    expect(read('2026-10-25.jsonl')).toContain('"msg":"before"');
    expect(read('2026-10-26.jsonl')).toContain('"msg":"after"');
  });

  it('never stops the program when its folder cannot be made', () => {
    const blocked = join(folder(), 'a-file');
    writeFileSync(blocked, '');
    const { log, file } = openLog({
      process: 'view',
      env: { SYMBIOTE_LOG_DIR: join(blocked, 'logs') },
    });
    expect(file).toBeNull();
    expect(() => log.error('nowhere')).not.toThrow();
  });

  it('blanks tokens and authorization headers', () => {
    const dir = folder();
    const { log } = openLog({ process: 'view', env: { SYMBIOTE_LOG_DIR: dir } });
    log.info({ token: 'ghp_secret', headers: { authorization: 'Bearer secret' } }, 'forge');
    const text = readFileSync(join(dir, readdirSync(dir)[0] ?? ''), 'utf8');
    expect(text).not.toContain('secret');
    expect(text).toContain('[redacted]');
  });

  it("writes another program's lines into the same file with as()", () => {
    const dir = folder();
    const opened = openLog({ process: 'view', env: { SYMBIOTE_LOG_DIR: dir } });
    opened.log.info('own');
    opened.as('viewer').error({ page: '/history' }, 'page error');
    const [own, page] = lines(dir);
    expect(own).toMatchObject({ process: 'view', msg: 'own' });
    expect(page).toMatchObject({ process: 'viewer', page: '/history', msg: 'page error' });
    // One `process` key: the line has no other program's name in it.
    expect(readFileSync(join(dir, readdirSync(dir)[0] ?? ''), 'utf8').split('\n')[1]).not.toContain(
      '"view"',
    );
    expect(() => silentLog().as('viewer').error('nowhere')).not.toThrow();
  });
});
