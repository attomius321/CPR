import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { startNexusServer, type NexusServer } from '../src/server.js';
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
  { host, method = 'GET' }: { host?: string; method?: string } = {},
): Promise<{ status: number; type: string; cache: string; body: string }> {
  const url = new URL(path, server.url);
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers: host ? { host } : {} }, (res) => {
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
    req.end();
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

  it('answers only its own host, and reads only', async () => {
    const port = new URL(server.url).port;
    expect((await get('/', { host: `localhost:${port}` })).status).toBe(200);
    expect((await get('/', { host: `evil.example:${port}` })).status).toBe(421);
    expect((await get('/api/symbiotes', { host: 'evil.example' })).status).toBe(421);
    expect((await get('/api/symbiotes', { method: 'POST' })).status).toBe(405);
  });
});

describe('startNexusServer', () => {
  it('says to build the viewer when it is not built', async () => {
    await expect(
      startNexusServer({
        port: 0,
        symbiotes: () => Promise.resolve([]),
        pageDir,
        scriptsDir,
        viewerDir: join(dir, 'nowhere'),
      }),
    ).rejects.toThrow(`the viewer is not built (${join(dir, 'nowhere')}); run pnpm build`);
  });
});
