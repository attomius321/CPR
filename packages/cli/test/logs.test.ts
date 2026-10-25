import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultCacheDir, type Graph } from '@symbiote/core';
import { logsDir, openLog } from '@symbiote/log';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { logProcess, run } from '../src/main.js';
import { startViewServer, type ViewServer } from '../src/server.js';
import { fileStateStore } from '../src/state.js';

const graph = JSON.parse(
  readFileSync(
    new URL('../../core/test/__snapshots__/graph-callers.json', import.meta.url),
    'utf8',
  ),
) as Graph;

const folder = () => mkdtempSync(join(tmpdir(), 'symbiote-cli-log-'));

/** Every line written in `dir`, parsed. */
function lines(dir: string): Record<string, unknown>[] {
  return readdirSync(dir).flatMap((name) =>
    readFileSync(join(dir, name), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  );
}

const WRITE = { 'content-type': 'application/json', 'x-symbiote': '1' };

describe("the logs' folder", () => {
  it("is logs in the CLI's cache folder", () => {
    const cases: [Record<string, string>, NodeJS.Platform][] = [
      [{}, 'linux'],
      [{}, 'darwin'],
      [{}, 'win32'],
      [{ XDG_CACHE_HOME: '/xdg' }, 'linux'],
      [{ SYMBIOTE_CACHE_DIR: '/c' }, 'darwin'],
    ];
    for (const [env, platform] of cases) {
      expect(logsDir(env, platform, '/home/someone')).toBe(
        join(defaultCacheDir(env, platform, '/home/someone'), 'logs'),
      );
    }
  });
});

describe('logProcess', () => {
  it('names the program by its command; an analysis symbiote view started is analysis', () => {
    expect(logProcess('view', false)).toBe('view');
    expect(logProcess('diff', false)).toBe('diff');
    expect(logProcess('diff', true)).toBe('analysis');
    expect(logProcess('mr', false)).toBe('pr');
    expect(logProcess('merge', false)).toBe('merge');
    expect(logProcess(undefined, false)).toBe('cli');
    expect(logProcess('--version', false)).toBe('cli');
  });
});

describe("the view server's lines", () => {
  const viewer = tempDir();
  const dir = folder();
  const state = folder();
  let server: ViewServer;
  let introBroken = false;

  beforeAll(async () => {
    mkdirSync(join(viewer, 'assets'));
    writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>');
    server = await startViewServer({
      graph,
      viewerDir: viewer,
      readSource: () => Promise.resolve('// source'),
      state: fileStateStore(state),
      intro: {
        seen: () =>
          introBroken ? Promise.reject(new Error('the intro record broke')) : Promise.resolve(true),
        markSeen: () => Promise.resolve(),
      },
      log: openLog({
        process: 'view',
        env: { SYMBIOTE_LOG_DIR: dir, SYMBIOTE_LOG_LEVEL: 'debug' },
      }),
    });
  });

  afterAll(async () => {
    await server.close();
    for (const path of [viewer, dir, state]) rmSync(path, { recursive: true, force: true });
  });

  const url = (path: string) => new URL(path, server.url);
  /** Lines answer the request once it has ended: wait for the one asked for. */
  async function lineFor(test: (line: Record<string, unknown>) => boolean) {
    for (let i = 0; i < 50; i++) {
      const found = lines(dir).find(test);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('no such line');
  }

  it('writes a request that throws as an error, with its method, path and stack', async () => {
    introBroken = true;
    const response = await fetch(url('/api/intro'));
    introBroken = false;
    expect(response.status).toBe(500);
    const line = await lineFor((l) => l.path === '/api/intro' && l.status === 500);
    expect(line).toMatchObject({
      level: 'error',
      process: 'view',
      method: 'GET',
      msg: 'request failed',
    });
    expect((line.err as { stack: string }).stack).toContain('the intro record broke');
  });

  it('writes reads at debug, writes at info, saved state at debug', async () => {
    await fetch(url('/api/graph'));
    await fetch(url('/api/intro'), { method: 'POST', headers: WRITE, body: '{}' });
    await fetch(url('/api/state/drafts'), { method: 'PUT', headers: WRITE, body: '{}' });
    const read = await lineFor((l) => l.path === '/api/graph');
    expect(read).toMatchObject({ level: 'debug', method: 'GET', status: 200 });
    expect(read.ms).toEqual(expect.any(Number));
    expect(await lineFor((l) => l.path === '/api/intro' && l.method === 'POST')).toMatchObject({
      level: 'info',
      status: 204,
    });
    expect(await lineFor((l) => l.path === '/api/state/drafts')).toMatchObject({
      level: 'debug',
    });
  });

  it('never writes what a request carried', async () => {
    const body = JSON.stringify({ drafts: [{ body: 'BODY-SECRET-123' }] });
    await fetch(url('/api/state/drafts'), { method: 'PUT', headers: WRITE, body });
    await lineFor((l) => l.path === '/api/state/drafts' && l.method === 'PUT');
    expect(
      readdirSync(dir)
        .map((name) => readFileSync(join(dir, name), 'utf8'))
        .join(''),
    ).not.toContain('BODY-SECRET-123');
  });

  it("writes no terminal's whole ID: it keeps other sites out of the terminal", async () => {
    const id = '0123456789abcdef0123456789abcdef';
    await fetch(url(`/api/terminals/${id}`));
    const line = await lineFor((l) => String(l.path).startsWith('/api/terminals/'));
    expect(line.path).toBe('/api/terminals/01234567…');
    expect(JSON.stringify(lines(dir))).not.toContain(id);
  });

  it("writes a page's error as a viewer line", async () => {
    const error = {
      level: 'error',
      msg: 'Cannot read properties of undefined',
      page: '/history',
      err: {
        name: 'TypeError',
        message: 'x is undefined',
        stack: 'TypeError: x\n    at f (a.js:1:1)',
      },
      componentStack: '\n    at HistoryPage',
    };
    const response = await fetch(url('/api/logs'), {
      method: 'POST',
      headers: WRITE,
      body: JSON.stringify(error),
    });
    expect(response.status).toBe(204);
    const line = await lineFor((l) => l.process === 'viewer');
    expect(line).toMatchObject({
      level: 'error',
      msg: 'Cannot read properties of undefined',
      page: '/history',
      componentStack: '\n    at HistoryPage',
      err: {
        type: 'TypeError',
        message: 'x is undefined',
        stack: 'TypeError: x\n    at f (a.js:1:1)',
      },
    });
    // The post itself is not a request line.
    expect(lines(dir).some((l) => l.path === '/api/logs')).toBe(false);
  });

  it("refuses a page's error from another site, without the header, too large or odd", async () => {
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(url('/api/logs'), {
        method: 'POST',
        headers: { ...WRITE, ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    const fine = { level: 'warn', msg: 'odd', page: '/' };
    expect((await post(fine, { origin: 'https://attacker.example' })).status).toBe(403);
    expect((await post(fine, { 'x-symbiote': '' })).status).toBe(403);
    expect((await post({ ...fine, msg: 'x'.repeat(40 * 1024) })).status).toBe(413);
    expect((await post({ ...fine, level: 'fatal' })).status).toBe(400);
    expect((await post({ level: 'error', page: '/' })).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect((await fetch(url('/api/logs'))).status).toBe(405);
  });
});

describe("the pages' errors, at most 60 a minute", () => {
  it('refuses the 61st', async () => {
    const viewer = tempDir();
    writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>');
    const dir = folder();
    const server = await startViewServer({
      graph,
      viewerDir: viewer,
      readSource: () => Promise.resolve(''),
      log: openLog({ process: 'view', env: { SYMBIOTE_LOG_DIR: dir } }),
    });
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const response = await fetch(new URL('/api/logs', server.url), {
        method: 'POST',
        headers: WRITE,
        body: JSON.stringify({ level: 'error', msg: `error ${i}`, page: '/' }),
      });
      statuses.push(response.status);
    }
    await server.close();
    expect(statuses.slice(0, 60).every((status) => status === 204)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect(lines(dir).filter((line) => line.process === 'viewer')).toHaveLength(60);
    rmSync(viewer, { recursive: true, force: true });
  });
});

describe("a command's refusal", () => {
  it('is a warn line with the command and its words', async () => {
    const dir = folder();
    const outside = folder();
    const code = await run(['diff', 'main'], {
      cwd: outside,
      stdout: () => undefined,
      stderr: () => undefined,
      openUrl: () => undefined,
      waitForExit: () => Promise.resolve(),
      env: process.env,
      log: openLog({ process: 'diff', env: { SYMBIOTE_LOG_DIR: dir } }),
    });
    expect(code).toBe(1);
    const [line] = lines(dir);
    expect(line).toMatchObject({ level: 'warn', process: 'diff', command: 'diff', msg: 'refused' });
    expect((line?.err as { message: string }).message).toEqual(expect.any(String));
  });
});
