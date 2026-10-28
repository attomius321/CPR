import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import type { FoldersAnswer } from '../src/folders.js';
import { startNexusServer, type NexusServer } from '../src/server.js';
import type { StartAnswer, Starter } from '../src/start.js';
import type { Symbiote } from '../src/symbiotes.js';

const dir = tempDir();
const viewerDir = join(dir, 'viewer');
const pageDir = join(dir, 'page');
const scriptsDir = join(dir, 'scripts');

const ky: Symbiote = {
  url: 'http://127.0.0.1:4100/',
  pid: 100,
  root: '/home/me/ky',
  name: 'ky',
  started: '2026-10-28T10:00:00.000Z',
  branch: 'main',
  head: 'a1b2c3d',
  changed: 1,
};

let listed: () => Promise<Symbiote[]> = () => Promise.resolve([ky]);
let server: NexusServer;

const projects: FoldersAnswer = {
  path: '/home/me/projects',
  parent: '/home/me',
  repository: null,
  folders: [{ name: 'ky', path: '/home/me/projects/ky', repository: true }],
  more: 0,
  places: [{ name: 'Home', path: '/home/me' }],
};
/** What the server asked of the folders and the starter. */
const asked: string[] = [];
let folders: (path: string | null) => Promise<FoldersAnswer> = (path) => {
  asked.push(`list ${path}`);
  return Promise.resolve(projects);
};
let startAnswer: StartAnswer = { symbiote: ky };
let stopAnswer = true;
const starter: Starter = {
  start: (folder) => {
    asked.push(`start ${folder}`);
    return Promise.resolve(startAnswer);
  },
  stop: (root) => {
    asked.push(`stop ${root}`);
    return Promise.resolve(stopAnswer);
  },
};

beforeAll(async () => {
  mkdirSync(join(viewerDir, 'assets'), { recursive: true });
  writeFileSync(
    join(viewerDir, 'index.html'),
    '<link rel="icon" href="./assets/favicon-1.png" />\n' +
      '<link rel="stylesheet" crossorigin href="./assets/index-Dd9q.css">\n',
  );
  writeFileSync(join(viewerDir, 'assets', 'index-Dd9q.css'), ':root { --bg: #090b0e; }');
  writeFileSync(join(viewerDir, 'assets', 'geist-latin-wght-normal-BgDa.woff2'), 'font');
  mkdirSync(pageDir);
  writeFileSync(
    join(pageDir, 'index.html'),
    '<link rel="preload" href="%GEIST%" /><link rel="stylesheet" href="%VIEWER_CSS%" />',
  );
  writeFileSync(join(pageDir, 'nexus.css'), '.nexus {}');
  writeFileSync(join(pageDir, 'mark.png'), 'png');
  mkdirSync(scriptsDir);
  writeFileSync(join(scriptsDir, 'main.js'), 'export {};');
  server = await startNexusServer({
    port: 0,
    symbiotes: () => listed(),
    folders: (path) => folders(path),
    starter,
    pageDir,
    scriptsDir,
    viewerDir,
  });
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A request with the headers a test chooses (fetch keeps its own Host). */
function get(
  path: string,
  {
    host,
    method = 'GET',
    headers = {},
    body,
  }: { host?: string; method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; type: string; cache: string; body: string }> {
  const url = new URL(path, server.url);
  return new Promise((resolve, reject) => {
    const all = { ...headers, ...(host ? { host } : {}) };
    const req = request(url, { method, headers: all }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          type: res.headers['content-type'] ?? '',
          cache: res.headers['cache-control'] ?? '',
          body,
        }),
      );
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** A write as the page sends it: JSON, the custom header, its own origin; '' leaves one out. */
function post(path: string, value: unknown, headers: Record<string, string> = {}) {
  const all: Record<string, string> = {
    'content-type': 'application/json',
    'x-symbiote': '1',
    origin: server.url.replace(/\/$/, ''),
    ...headers,
  };
  return get(path, {
    method: 'POST',
    headers: Object.fromEntries(Object.entries(all).filter(([, v]) => v !== '')),
    body: typeof value === 'string' ? value : JSON.stringify(value),
  });
}

describe('the nexus server', () => {
  it('serves on 127.0.0.1, at an address of its own', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it("serves the page with the viewer's own stylesheet and font", async () => {
    const page = await get('/');
    expect(page).toMatchObject({
      status: 200,
      type: 'text/html; charset=utf-8',
      cache: 'no-store',
    });
    expect(page.body).toBe(
      '<link rel="preload" href="/viewer/assets/geist-latin-wght-normal-BgDa.woff2" />' +
        '<link rel="stylesheet" href="/viewer/assets/index-Dd9q.css" />',
    );
  });

  it("serves the viewer's assets, its scripts and its own files, nothing beside them", async () => {
    expect(await get('/viewer/assets/index-Dd9q.css')).toMatchObject({
      status: 200,
      type: 'text/css; charset=utf-8',
      body: ':root { --bg: #090b0e; }',
    });
    expect(await get('/viewer/assets/geist-latin-wght-normal-BgDa.woff2')).toMatchObject({
      status: 200,
      type: 'font/woff2',
    });
    expect(await get('/page/main.js')).toMatchObject({
      status: 200,
      type: 'text/javascript; charset=utf-8',
    });
    expect(await get('/nexus.css')).toMatchObject({ status: 200, type: 'text/css; charset=utf-8' });
    expect(await get('/mark.png')).toMatchObject({ status: 200, type: 'image/png' });
    for (const path of [
      '/viewer/assets/missing.css',
      '/viewer/assets/..%2Findex.html',
      '/viewer/index.html',
      '/page/..%2F..%2Fviewer%2Findex.html',
      '/index.html',
      '/elsewhere',
    ]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it('lists the live Symbiotes, read anew each time', async () => {
    const answer = await get('/api/symbiotes');
    expect(answer).toMatchObject({ status: 200, cache: 'no-store' });
    expect(answer.type).toContain('application/json');
    expect(JSON.parse(answer.body)).toEqual({ symbiotes: [ky] });
    listed = () => Promise.resolve([]);
    expect(JSON.parse((await get('/api/symbiotes')).body)).toEqual({ symbiotes: [] });
  });

  it('says why when the list cannot be read, and serves on', async () => {
    listed = () => Promise.reject(new Error('the disk is gone'));
    expect(await get('/api/symbiotes')).toMatchObject({ status: 500, body: 'the disk is gone' });
    listed = () => Promise.resolve([ky]);
    expect((await get('/api/symbiotes')).status).toBe(200);
  });

  it('answers only its own host, and writes only where it starts or stops a Symbiote', async () => {
    const port = new URL(server.url).port;
    expect((await get('/', { host: `localhost:${port}` })).status).toBe(200);
    expect((await get('/', { host: `evil.example:${port}` })).status).toBe(421);
    expect((await get('/api/symbiotes', { host: 'evil.example' })).status).toBe(421);
    expect((await post('/api/folders', {})).status).toBe(405);
    expect((await post('/', {})).status).toBe(405);
    expect((await get('/api/symbiotes', { method: 'PUT' })).status).toBe(405);
    expect((await get('/api/symbiotes/stop')).status).toBe(405);
  });
});

describe("the nexus server: this PC's folders (NX2)", () => {
  it('lists a folder, or where the Folders tab opens', async () => {
    asked.length = 0;
    const answer = await get(`/api/folders?path=${encodeURIComponent('/home/me/projects')}`);
    expect(answer).toMatchObject({ status: 200, cache: 'no-store' });
    expect(JSON.parse(answer.body)).toEqual(projects);
    expect(JSON.parse((await get('/api/folders')).body)).toEqual(projects);
    expect(asked).toEqual(['list /home/me/projects', 'list null']);
  });

  it('says what is wrong with a folder: missing, not readable, not a folder, not absolute', async () => {
    const failing = (code: string) => () =>
      Promise.reject(Object.assign(new Error(`${code}: no`), { code }));
    folders = failing('ENOENT');
    expect(await get('/api/folders?path=%2Fgone')).toMatchObject({
      status: 404,
      body: JSON.stringify({ error: 'No such folder: /gone' }),
    });
    folders = failing('EACCES');
    expect(await get('/api/folders?path=%2Froot')).toMatchObject({
      status: 403,
      body: JSON.stringify({ error: 'Permission denied: /root' }),
    });
    folders = failing('ENOTDIR');
    expect(await get('/api/folders?path=%2Fa.txt')).toMatchObject({
      status: 400,
      body: JSON.stringify({ error: 'Not a folder: /a.txt' }),
    });
    folders = () => Promise.resolve(projects);
    expect(await get('/api/folders?path=projects')).toMatchObject({
      status: 400,
      body: JSON.stringify({ error: 'Not an absolute path: projects' }),
    });
  });
});

describe('the nexus server: starting and stopping a Symbiote (NX2)', () => {
  it('starts one in a folder, and answers with it', async () => {
    asked.length = 0;
    startAnswer = { symbiote: ky };
    const answer = await post('/api/symbiotes', { folder: '/home/me/ky' });
    expect(answer).toMatchObject({ status: 200, cache: 'no-store' });
    expect(JSON.parse(answer.body)).toEqual({ symbiote: ky });
    expect(asked).toEqual(['start /home/me/ky']);
  });

  it('says why one did not start', async () => {
    startAnswer = { error: 'symbiote: not inside a git working tree: /home/me' };
    expect(await post('/api/symbiotes', { folder: '/home/me' })).toMatchObject({
      status: 422,
      body: JSON.stringify(startAnswer),
    });
    startAnswer = { symbiote: ky };
  });

  it('stops one, or says none runs there', async () => {
    asked.length = 0;
    stopAnswer = true;
    expect((await post('/api/symbiotes/stop', { root: '/home/me/ky' })).status).toBe(204);
    stopAnswer = false;
    expect(await post('/api/symbiotes/stop', { root: '/home/me/ky' })).toMatchObject({
      status: 404,
      body: JSON.stringify({ error: 'No Symbiote runs in /home/me/ky' }),
    });
    expect(asked).toEqual(['stop /home/me/ky', 'stop /home/me/ky']);
  });

  it('takes writes only from its own page: JSON, the custom header, its own origin', async () => {
    asked.length = 0;
    const port = new URL(server.url).port;
    const forbidden: Record<string, string>[] = [
      { origin: 'http://evil.example' },
      { origin: `http://127.0.0.1:${Number(port) + 1}` },
      { 'x-symbiote': '' },
      { 'content-type': 'text/plain' },
    ];
    for (const headers of forbidden) {
      expect((await post('/api/symbiotes', { folder: '/x' }, headers)).status).toBe(403);
      expect((await post('/api/symbiotes/stop', { root: '/x' }, headers)).status).toBe(403);
    }
    // No origin at all: a page's own request may send none.
    expect((await post('/api/symbiotes', { folder: '/x' }, { origin: '' })).status).toBe(200);
    expect(asked).toEqual(['start /x']);
  });

  it('refuses a body that is not what it asks for', async () => {
    asked.length = 0;
    expect((await post('/api/symbiotes', '{not json')).status).toBe(400);
    expect((await post('/api/symbiotes', { folder: 7 })).status).toBe(400);
    expect((await post('/api/symbiotes', ['/x'])).status).toBe(400);
    expect((await post('/api/symbiotes/stop', {})).status).toBe(400);
    expect((await post('/api/symbiotes', { folder: 'x'.repeat(70_000) })).status).toBe(413);
    expect(asked).toEqual([]);
  });
});

describe('startNexusServer', () => {
  it('says to build the viewer when it is not built', async () => {
    await expect(
      startNexusServer({
        port: 0,
        symbiotes: () => Promise.resolve([]),
        folders: () => Promise.resolve(projects),
        starter,
        pageDir,
        scriptsDir,
        viewerDir: join(dir, 'nowhere'),
      }),
    ).rejects.toThrow(`the viewer is not built (${join(dir, 'nowhere')}); run pnpm build`);
  });
});
