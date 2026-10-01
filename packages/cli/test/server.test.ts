import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import type { Graph } from '@cpr/core';
import type { Review } from '@cpr/forge';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import {
  parseReview,
  sourceFiles,
  startViewServer,
  type StateStore,
  type ViewServer,
} from '../src/server.js';
import { fileStateStore, stateDir } from '../src/state.js';

const graph = JSON.parse(
  readFileSync(
    new URL('../../core/test/__snapshots__/graph-callers.json', import.meta.url),
    'utf8',
  ),
) as Graph;

describe('startViewServer', () => {
  const viewer = tempDir();
  let server: ViewServer;
  const reads: string[] = [];

  beforeAll(async () => {
    mkdirSync(join(viewer, 'assets'));
    writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>');
    writeFileSync(join(viewer, 'assets', 'app.js'), 'console.log(1)');
    server = await startViewServer({
      graph,
      viewerDir: viewer,
      readSource: (side, path) => {
        reads.push(`${side}:${path}`);
        return Promise.resolve(`// ${side} ${path}`);
      },
    });
  });

  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
  });

  const get = async (path: string) => {
    const response = await fetch(new URL(path, server.url));
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      body: await response.text(),
    };
  };

  it('listens on localhost only', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('serves the viewer files', async () => {
    expect(await get('/')).toMatchObject({ status: 200, body: '<html>viewer</html>' });
    expect(await get('/assets/app.js')).toMatchObject({
      status: 200,
      type: 'text/javascript; charset=utf-8',
    });
    expect((await get('/missing.js')).status).toBe(404);
  });

  it('refuses paths outside the viewer folder', async () => {
    expect((await get('/../../package.json')).status).toBe(404);
    expect((await get('/%2e%2e/%2e%2e/package.json')).status).toBe(404);
  });

  it('serves the graph', async () => {
    const { status, body } = await get('/api/graph');
    expect(status).toBe(200);
    expect((JSON.parse(body) as Graph).nodes).toHaveLength(graph.nodes.length);
  });

  it('answers only requests addressed to itself (no DNS rebinding)', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(new URL('/api/graph', server.url), {
        headers: { host: 'attacker.example:80' },
      });
      req.on('response', (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(421);
  });

  it('says what it can do: sources, but no reviews outside cpr pr', async () => {
    expect(JSON.parse((await get('/api/capabilities')).body)).toEqual({
      sources: true,
      review: null,
      state: false,
    });
    const response = await fetch(new URL('/api/review', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cpr': '1' },
      body: '{}',
    });
    expect(response.status).toBe(404);
  });

  it('serves only sources the graph mentions', async () => {
    expect(await get('/api/source?side=head&file=src/math.ts')).toMatchObject({
      status: 200,
      body: '// head src/math.ts',
    });
    expect((await get('/api/source?side=head&file=../../etc/passwd')).status).toBe(404);
    expect((await get('/api/source?side=elsewhere&file=src/math.ts')).status).toBe(404);
    expect(reads).toEqual(['head:src/math.ts']);
  });
});

describe('POST /api/review', () => {
  const viewer = tempDir();
  const submitted: Review[] = [];
  let server: ViewServer;
  let fail = false;

  beforeAll(async () => {
    writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>');
    server = await startViewServer({
      graph,
      viewerDir: viewer,
      readSource: () => Promise.resolve(''),
      review: {
        forge: 'github',
        submit: (review) => {
          if (fail) return Promise.reject(new Error('Can not approve your own pull request'));
          submitted.push(review);
          return Promise.resolve({ url: 'https://github.com/acme/widgets/pull/7#review-1' });
        },
      },
    });
  });

  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
  });

  const review: Review = {
    event: 'approve',
    body: 'Nice',
    comments: [
      { side: 'head', path: 'src/math.ts', otherPath: 'src/math.ts', line: 2, body: 'ok' },
    ],
  };
  const post = (headers: Record<string, string>, body: unknown = review) =>
    fetch(new URL('/api/review', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cpr': '1', ...headers },
      body: JSON.stringify(body),
    });

  it('announces the forge', async () => {
    const response = await fetch(new URL('/api/capabilities', server.url));
    expect(await response.json()).toEqual({
      sources: true,
      review: { forge: 'github' },
      state: false,
    });
  });

  it('posts a review from the viewer', async () => {
    const response = await post({ origin: server.url.replace(/\/$/, '') });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://github.com/acme/widgets/pull/7#review-1',
    });
    expect(submitted).toEqual([review]);
  });

  it('refuses requests other sites could send', async () => {
    expect((await post({ origin: 'https://attacker.example' })).status).toBe(403);
    expect((await post({ 'x-cpr': '' })).status).toBe(403);
    expect((await post({ 'content-type': 'text/plain' })).status).toBe(403);
    expect((await fetch(new URL('/api/review', server.url))).status).toBe(405);
    expect(submitted).toHaveLength(1);
  });

  it('refuses comments outside the change and reports forge errors', async () => {
    const outside = { ...review, comments: [{ ...review.comments[0], path: '/etc/passwd' }] };
    const refused = await post({}, outside);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe('comment 1: /etc/passwd is not part of this change');

    fail = true;
    const failed = await post({});
    fail = false;
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'Can not approve your own pull request' });
  });
});

describe('/api/state', () => {
  const viewer = tempDir();
  const dir = tempDir();
  let server: ViewServer;
  let store: StateStore;

  beforeAll(async () => {
    writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>');
    store = fileStateStore(join(dir, 'nested'));
    server = await startViewServer({
      graph,
      viewerDir: viewer,
      readSource: () => Promise.resolve(''),
      state: store,
    });
  });

  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  const put = (name: string, value: unknown, headers: Record<string, string> = {}) =>
    fetch(new URL(`/api/state/${name}`, server.url), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-cpr': '1', ...headers },
      body: JSON.stringify(value),
    });
  const read = async (name: string) =>
    (await fetch(new URL(`/api/state/${name}`, server.url))).json();

  it('keeps reviewed marks and drafts on disk', async () => {
    expect(await read('review')).toBeNull();
    expect((await put('review', { 'src/math.ts#add': 'x|y' })).status).toBe(204);
    expect(await read('review')).toEqual({ 'src/math.ts#add': 'x|y' });
    expect(await store.read('review')).toEqual({ 'src/math.ts#add': 'x|y' });
    expect(JSON.parse((await get('/api/capabilities')).body)).toMatchObject({ state: true });
  });

  it('refuses unknown names and writes other sites could send', async () => {
    expect((await put('secrets', {})).status).toBe(404);
    expect((await put('drafts', {}, { origin: 'https://attacker.example' })).status).toBe(403);
    expect((await put('drafts', {}, { 'x-cpr': '' })).status).toBe(403);
    expect(await read('drafts')).toBeNull();
  });

  async function get(path: string) {
    const response = await fetch(new URL(path, server.url));
    return { status: response.status, body: await response.text() };
  }
});

describe('stateDir', () => {
  it('is per change request, else per pair of revisions', () => {
    const request = { ...graph, changeRequest: { url: 'https://github.com/a/b/pull/7' } } as Graph;
    const pushed = {
      ...request,
      revisions: { ...request.revisions, head: { ref: 'x', sha: 'other' } },
    } as Graph;
    expect(stateDir('/c', 'repo', request)).toBe(stateDir('/c', 'repo', pushed));
    expect(stateDir('/c', 'repo', graph)).not.toBe(stateDir('/c', 'repo', request));
    expect(stateDir('/c', 'repo', graph)).toMatch(/^\/c\/state\/repo\/[0-9a-f]{16}$/);
  });
});

describe('parseReview', () => {
  const allowed = { base: new Set(['old.ts']), head: new Set(['new.ts', 'a.ts']) };
  const comment = { side: 'base', path: 'old.ts', otherPath: 'new.ts', line: 3, body: 'x' };

  it('accepts comments on either side of a renamed file', () => {
    const text = JSON.stringify({ event: 'comment', body: '', comments: [comment] });
    expect(parseReview(text, allowed).comments).toEqual([comment]);
  });

  it.each([
    [{ event: 'merge', body: '', comments: [] }, "unknown event 'merge'"],
    [{ event: 'comment', body: 1, comments: [] }, 'body must be a string'],
    [{ event: 'comment', body: '', comments: [{ ...comment, line: 0 }] }, 'comment 1: line'],
    [{ event: 'comment', body: '', comments: [{ ...comment, body: ' ' }] }, 'comment 1: empty'],
    [
      { event: 'comment', body: '', comments: [{ ...comment, otherPath: 'x.ts' }] },
      'comment 1: otherPath',
    ],
  ])('rejects %j', (value, message) => {
    expect(() => parseReview(JSON.stringify(value), allowed)).toThrow(message);
  });
});

describe('sourceFiles', () => {
  it('lists files per side from nodes and changed files', () => {
    const files = sourceFiles(graph);
    // Context nodes carry only the head side.
    expect([...files.base].sort()).toEqual(['src/math.ts']);
    expect([...files.head].sort()).toEqual(['src/app.ts', 'src/math.ts']);
  });
});
