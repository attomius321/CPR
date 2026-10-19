import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import {
  CheckoutRefused,
  UnknownCheckoutTarget,
  type BranchReviewInfo,
  type CheckoutTarget,
  type FeatureOptions,
  type FeatureReply,
  type FeatureRequest,
  type FeatureSummary,
  type Graph,
} from '@cpr/core';
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
import { Diffs, type Pair, type RunDiff } from '../src/diffs.js';
import { Histories } from '../src/history.js';
import type { OpenRequest, OpenResult } from '../src/editor.js';
import { ReviewRefused, type BranchReviews } from '../src/reviews.js';
import { FeatureRefused, type Features } from '../src/features.js';
import { terminals as makeTerminals, type Pty, type SpawnPty } from '../src/terminal.js';

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
    const open = await fetch(new URL('/api/open', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cpr': '1' },
      body: JSON.stringify({ side: 'head', file: 'src/math.ts', line: 1 }),
    });
    expect(open.status).toBe(404);
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

describe('POST /api/open', () => {
  const viewer = tempDir();
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const requests: OpenRequest[] = [];
  const open = (request: OpenRequest): Promise<OpenResult> => {
    requests.push(request);
    if (request.line === 99) {
      return Promise.resolve({
        opened: false,
        reason: 'missing',
        message: 'src/math.ts is not in your working copy',
      });
    }
    if (request.line === 98) {
      return Promise.resolve({ opened: false, reason: 'editor', message: 'code was not found' });
    }
    return Promise.resolve({ opened: true, line: request.line + 2, how: 'exact', moved: true });
  };
  let server: ViewServer;
  let folders: ViewServer;

  beforeAll(async () => {
    writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>');
    server = await startViewServer({
      graph: {
        ...graph,
        revisions: {
          base: { ref: 'main', sha: A, mergeBase: A },
          head: { ref: 'wip', sha: B },
          from: A,
        },
      },
      viewerDir: viewer,
      readSource: () => Promise.resolve(''),
      open,
    });
    // Two folders compared: no commit to map lines from.
    folders = await startViewServer({
      graph,
      viewerDir: viewer,
      readSource: () => Promise.resolve(''),
      open,
    });
  });

  afterAll(async () => {
    await server.close();
    await folders.close();
    rmSync(viewer, { recursive: true, force: true });
  });

  const post = (body: unknown, headers: Record<string, string> = {}, to = server) =>
    fetch(new URL('/api/open', to.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cpr': '1', ...headers },
      body: JSON.stringify(body),
    });

  it('says it can open files', async () => {
    const response = await fetch(new URL('/api/capabilities', server.url));
    expect(await response.json()).toEqual({
      sources: true,
      review: null,
      state: false,
      open: true,
    });
  });

  it('opens a file of either side at that side’s commit', async () => {
    const opened = await post({ side: 'head', file: 'src/math.ts', line: 5, column: 3 });
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({ line: 7, how: 'exact', moved: true });
    expect((await post({ side: 'base', file: 'src/math.ts', line: 1 })).status).toBe(200);
    expect(requests.slice(-2)).toEqual([
      { sha: B, file: 'src/math.ts', line: 5, column: 3 },
      { sha: A, file: 'src/math.ts', line: 1, column: 1 },
    ]);
  });

  it('says when the working copy lacks the file, or VS Code could not open it', async () => {
    const missing = await post({ side: 'head', file: 'src/math.ts', line: 99 });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'src/math.ts is not in your working copy' });
    const failed = await post({ side: 'head', file: 'src/math.ts', line: 98 });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'code was not found' });
  });

  it('refuses files outside the change, bad lines, and requests other sites could send', async () => {
    const before = requests.length;
    const ok = { side: 'head', file: 'src/math.ts', line: 1 };
    expect((await post({ ...ok, file: '../../etc/passwd' })).status).toBe(400);
    expect((await post({ ...ok, side: 'elsewhere' })).status).toBe(400);
    for (const line of [0, -1, 1.5, '3', null]) {
      expect((await post({ ...ok, line })).status).toBe(400);
    }
    expect((await post({ ...ok, column: 0 })).status).toBe(400);
    expect((await post(ok, { 'x-cpr': '' })).status).toBe(403);
    expect((await post(ok, { origin: 'https://attacker.example' })).status).toBe(403);
    expect((await fetch(new URL('/api/open', server.url))).status).toBe(405);
    expect((await post(ok, {}, folders)).status).toBe(404);
    expect(requests).toHaveLength(before);
  });
});

describe('cpr view: commits and diffs', () => {
  const viewer = tempDir();
  const dir = tempDir();
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const C = 'c'.repeat(40);
  const commits = [A, B, C];
  const runs: {
    pair: Pair;
    onPhase: (phase: string) => void;
    signal: AbortSignal;
    resolve: (graph: Graph) => void;
    reject: (error: Error) => void;
  }[] = [];
  const run: RunDiff = (pair, { onPhase, signal }) =>
    new Promise((resolve, reject) => {
      runs.push({ pair, onPhase, signal, resolve, reject });
      signal.addEventListener('abort', () => reject(new Error('stopped')));
    });
  const diffs = new Diffs(run);
  const reads: string[] = [];
  const opens: OpenRequest[] = [];
  const checkouts: CheckoutTarget[] = [];
  /** While set, a checkout waits for it. */
  let checkoutGate: Promise<void> | null = null;
  // C ← B ← A, listed as git would; `version` moves when a test says so.
  let version = 'v1';
  const streams: string[] = [];
  const history = new Histories({
    state: () => Promise.resolve({ branch: 'main', head: C, version }),
    stream: (scope, onRows) => {
      streams.push(scope);
      onRows([
        { sha: C, parents: [B] },
        { sha: B, parents: [A] },
        { sha: A, parents: [] },
      ]);
      return Promise.resolve();
    },
    details: (shas) =>
      Promise.resolve(
        shas.map((sha) => ({
          sha,
          parents: [],
          author: 'Ada',
          date: '2026-10-13T08:00:00Z',
          subject: `commit ${sha[0] ?? ''}`,
          refs: [],
        })),
      ),
  });
  /** The graph of a pair: the fixture's, with that pair's SHAs. */
  const graphOf = ({ base, head }: Pair): Graph => ({
    ...graph,
    revisions: {
      base: { ref: base, sha: base, mergeBase: null },
      head: { ref: head, sha: head },
      from: base,
    },
  });
  let server: ViewServer;

  beforeAll(async () => {
    mkdirSync(join(viewer, 'assets'));
    writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>');
    writeFileSync(join(viewer, 'assets', 'app.js'), 'console.log(1)');
    server = await startViewServer({
      viewerDir: viewer,
      repository: {
        history,
        status: () =>
          Promise.resolve({ version, branch: 'main', head: C, changed: 2, operation: null }),
        refs: () =>
          Promise.resolve({
            branches: [{ name: 'main', sha: C }],
            // Its history is not listed (never fetched).
            remotes: [
              { name: 'origin/gone', remote: 'origin', branch: 'gone', sha: 'f'.repeat(40) },
            ],
            tags: [],
          }),
        checkout: async (target) => {
          checkouts.push(target);
          if (checkoutGate) await checkoutGate;
          if (target.kind === 'branch' && target.name === 'nope') {
            throw new UnknownCheckoutTarget('no branch nope');
          }
          if (target.kind === 'branch' && target.name === 'busy') {
            throw new CheckoutRefused('error: Your local changes would be overwritten');
          }
          return { branch: target.kind === 'branch' ? target.name : null, head: C };
        },
        isCommit: (sha) => Promise.resolve(commits.includes(sha)),
        diffs,
        readFile: (sha, path) => {
          reads.push(`${sha[0] ?? ''}:${path}`);
          return Promise.resolve(`// ${path} at ${sha.slice(0, 7)}`);
        },
        state: (g) => fileStateStore(join(dir, g.revisions.head.sha ?? 'none')),
      },
      open: (request) => {
        opens.push(request);
        return Promise.resolve({ opened: true, line: request.line, how: 'exact', moved: false });
      },
    });
  });

  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  const get = async (path: string) => {
    const response = await fetch(new URL(path, server.url), { redirect: 'manual' });
    return {
      status: response.status,
      location: response.headers.get('location'),
      body: await response.text(),
    };
  };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(new URL(path, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cpr': '1', ...headers },
      body: JSON.stringify(body),
    });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('serves the history page at /history, the viewer as at / (V25)', async () => {
    const page = await get('/history');
    expect(page.status).toBe(200);
    expect(page.body).toBe('<html>viewer</html>');
  });

  it('lists rows of the history with their details, then its shape', async () => {
    const first = await get('/api/history?scope=all&from=0&to=2');
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body)).toMatchObject({
      version: 'v1',
      branch: 'main',
      head: C,
      from: 0,
      listed: 3,
      done: true,
    });
    expect(
      (JSON.parse(first.body) as { commits: { sha: string }[] }).commits.map((c) => c.sha),
    ).toEqual([C, B]);
    // No scope: every branch; no range: the first 200 rows.
    expect(JSON.parse((await get('/api/history')).body)).toMatchObject({ from: 0, listed: 3 });
    expect(JSON.parse((await get('/api/history?from=2&version=v1')).body)).toMatchObject({
      from: 2,
      commits: [{ sha: A }],
    });
    expect(JSON.parse((await get('/api/history/shape?scope=all&version=v1')).body)).toEqual({
      version: 'v1',
      rows: 3,
      head: 0,
      parents: [[1], [2], []],
    });
    await get('/api/history?scope=current');
    expect(streams).toEqual(['all', 'current']);
  });

  it('refuses unknown scopes and bad ranges; says when a version is stale', async () => {
    for (const query of [
      'scope=tags',
      'from=-1',
      'from=x',
      'from=3&to=2',
      'from=0&to=501',
      'from=1.5',
    ]) {
      expect((await get(`/api/history?${query}`)).status, query).toBe(400);
    }
    expect((await get('/api/history/shape')).status).toBe(400);
    expect((await get('/api/history/shape?scope=all&version=old')).status).toBe(409);
    expect((await get('/api/history?version=old')).status).toBe(409);
    version = 'v2';
    expect(JSON.parse((await get('/api/history')).body)).toMatchObject({ version: 'v2' });
    expect((await get('/api/history?version=v1')).status).toBe(409);
    expect((await post('/api/history', {})).status).toBe(405);
    expect((await get('/api/commits')).status).toBe(404);
  });

  it("reports the repository's status and refs", async () => {
    expect(JSON.parse((await get('/api/status')).body)).toEqual({
      version,
      branch: 'main',
      head: C,
      changed: 2,
      operation: null,
    });
    expect(JSON.parse((await get('/api/refs')).body)).toEqual({
      branches: [{ name: 'main', sha: C }],
      remotes: [{ name: 'origin/gone', remote: 'origin', branch: 'gone', sha: 'f'.repeat(40) }],
      tags: [],
    });
  });

  it("lists the branches with their tips' rows in a listing (V10b)", async () => {
    const listed = JSON.parse((await get('/api/history')).body) as { version: string };
    const answer = await get(`/api/history/refs?scope=all&version=${listed.version}`);
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({
      version: listed.version,
      branches: [{ name: 'main', sha: C, row: 0 }],
      remotes: [
        { name: 'origin/gone', remote: 'origin', branch: 'gone', sha: 'f'.repeat(40), row: null },
      ],
    });
    expect((await get('/api/history/refs')).status).toBe(400);
    expect((await get('/api/history/refs?scope=all&version=old')).status).toBe(409);
    expect((await post('/api/history/refs', {})).status).toBe(405);
  });

  it("checks out what the page asks for; git's refusals are 409, unknown targets 400", async () => {
    const ok = await post('/api/checkout', { kind: 'branch', name: 'wip' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ branch: 'wip', head: C });
    expect((await post('/api/checkout', { kind: 'commit', sha: A })).status).toBe(200);
    expect(checkouts).toEqual([
      { kind: 'branch', name: 'wip' },
      { kind: 'commit', sha: A },
    ]);

    const refused = await post('/api/checkout', { kind: 'branch', name: 'busy' });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: 'error: Your local changes would be overwritten',
    });
    expect((await post('/api/checkout', { kind: 'branch', name: 'nope' })).status).toBe(400);
    for (const body of [
      { kind: 'stash', name: 'x' },
      { kind: 'branch' },
      { kind: 'branch', name: '' },
      { kind: 'commit', sha: 'abc' },
      { kind: 'tag', name: 'x'.repeat(300) },
    ]) {
      expect((await post('/api/checkout', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await get('/api/checkout')).status).toBe(405);
  });

  it('checks out one at a time, and only for the page itself', async () => {
    const before = checkouts.length;
    let open = () => {};
    checkoutGate = new Promise((resolve) => (open = resolve));
    const first = post('/api/checkout', { kind: 'branch', name: 'wip' });
    await settle();
    const second = await post('/api/checkout', { kind: 'branch', name: 'main' });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'a checkout is running' });
    open();
    checkoutGate = null;
    expect((await first).status).toBe(200);

    expect(
      (
        await post(
          '/api/checkout',
          { kind: 'branch', name: 'wip' },
          { origin: 'https://attacker.example' },
        )
      ).status,
    ).toBe(403);
    expect(
      (await post('/api/checkout', { kind: 'branch', name: 'wip' }, { 'x-cpr': '' })).status,
    ).toBe(403);
    expect(checkouts.length).toBe(before + 1);
  });

  it('says it lists commits; the root has no graph', async () => {
    expect(JSON.parse((await get('/api/capabilities')).body)).toEqual({
      sources: false,
      review: null,
      state: false,
      commits: true,
    });
    expect((await get('/api/graph')).status).toBe(404);
    expect((await get('/')).body).toBe('<html>viewer</html>');
  });

  it('refuses pairs that are not two commits, and requests other sites could send', async () => {
    expect((await post('/api/diffs', { base: 'HEAD', head: B })).status).toBe(400);
    expect((await post('/api/diffs', { base: A.slice(0, 7), head: B })).status).toBe(400);
    expect((await post('/api/diffs', { base: 'd'.repeat(40), head: B })).status).toBe(400);
    expect((await post('/api/diffs', { base: A, head: A })).status).toBe(400);
    expect((await post('/api/diffs', { base: A })).status).toBe(400);
    expect((await post('/api/diffs', { base: A, head: B }, { 'x-cpr': '' })).status).toBe(403);
    expect(
      (await post('/api/diffs', { base: A, head: B }, { origin: 'https://attacker.example' }))
        .status,
    ).toBe(403);
    expect((await get('/api/diffs')).status).toBe(405);
    expect(runs).toHaveLength(0);
  });

  it('analyzes a pair on demand under /diff/<base>..<head>/', async () => {
    const started = await post('/api/diffs', { base: A, head: B });
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ url: `/diff/${A}..${B}/` });
    expect(runs.map((r) => r.pair)).toEqual([{ base: A, head: B }]);

    // The viewer's files and API live under the diff's own path.
    expect(await get(`/diff/${A}..${B}`)).toMatchObject({
      status: 308,
      location: `/diff/${A}..${B}/`,
    });
    expect((await get(`/diff/${A}..${B}/`)).body).toBe('<html>viewer</html>');
    expect((await get(`/diff/${A}..${B}/assets/app.js`)).body).toBe('console.log(1)');
    expect(JSON.parse((await get(`/diff/${A}..${B}/api/capabilities`)).body)).toEqual({
      sources: true,
      review: null,
      state: true,
      open: true,
      commits: true,
    });

    // While it runs: its phase; sources and state wait for the graph.
    const running = await get(`/diff/${A}..${B}/api/graph`);
    expect(running.status).toBe(202);
    expect(JSON.parse(running.body)).toMatchObject({ status: 'running', phase: null });
    runs[0]?.onPhase('loadHead');
    expect(JSON.parse((await get(`/diff/${A}..${B}/api/graph`)).body)).toMatchObject({
      phase: 'loadHead',
    });
    expect((await get(`/diff/${A}..${B}/api/source?side=head&file=src/math.ts`)).status).toBe(404);

    runs[0]?.resolve(graphOf({ base: A, head: B }));
    await settle();
    const done = await get(`/diff/${A}..${B}/api/graph`);
    expect(done.status).toBe(200);
    expect((JSON.parse(done.body) as Graph).revisions.head.sha).toBe(B);

    // Sources at the pair's commits, only files the graph mentions.
    expect(await get(`/diff/${A}..${B}/api/source?side=base&file=src/math.ts`)).toMatchObject({
      status: 200,
      body: `// src/math.ts at ${A.slice(0, 7)}`,
    });
    expect((await get(`/diff/${A}..${B}/api/source?side=head&file=../x`)).status).toBe(404);
    expect(reads).toEqual(['a:src/math.ts']);

    // Files open at the pair's commits.
    const opened = await post(`/diff/${A}..${B}/api/open`, {
      side: 'head',
      file: 'src/math.ts',
      line: 2,
    });
    expect(opened.status).toBe(200);
    expect(opens).toEqual([{ sha: B, file: 'src/math.ts', line: 2, column: 1 }]);

    // Asking again is instant: nothing runs.
    await post('/api/diffs', { base: A, head: B });
    expect(runs).toHaveLength(1);
  });

  it('keeps review state per diff', async () => {
    const put = await fetch(new URL(`/diff/${A}..${B}/api/state/review`, server.url), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-cpr': '1' },
      body: JSON.stringify({ 'src/math.ts#add': 'x' }),
    });
    expect(put.status).toBe(204);
    expect(JSON.parse((await get(`/diff/${A}..${B}/api/state/review`)).body)).toEqual({
      'src/math.ts#add': 'x',
    });
    expect(await fileStateStore(join(dir, B)).read('review')).toEqual({ 'src/math.ts#add': 'x' });
    expect(await fileStateStore(join(dir, C)).read('review')).toBeNull();
  });

  it('reports a failed analysis, runs it again when asked', async () => {
    await post('/api/diffs', { base: B, head: C });
    runs[1]?.reject(new Error("cpr: unknown revision 'x'"));
    await settle();
    const failed = await get(`/diff/${B}..${C}/api/graph`);
    expect(failed.status).toBe(502);
    expect(JSON.parse(failed.body)).toEqual({
      base: B,
      head: C,
      error: "cpr: unknown revision 'x'",
    });
    await post('/api/diffs', { base: B, head: C });
    expect(runs).toHaveLength(3);
  });

  it('stops an analysis', async () => {
    expect((await post('/api/diffs/stop', { base: B, head: C }, { 'x-cpr': '' })).status).toBe(403);
    expect(runs[2]?.signal.aborted).toBe(false);
    expect((await post('/api/diffs/stop', { base: B, head: C })).status).toBe(204);
    expect(runs[2]?.signal.aborted).toBe(true);
    expect((await get(`/diff/${B}..${C}/api/graph`)).status).toBe(404);
    expect((await post('/api/diffs/stop', { base: B, head: C })).status).toBe(404);
  });

  it('answers 404 for a pair never asked for', async () => {
    expect(await get(`/diff/${C}..${A}/api/graph`)).toMatchObject({
      status: 404,
      body: JSON.stringify({ base: C, head: A, error: 'not analyzed' }),
    });
    expect((await get(`/diff/${C}..${A}/`)).body).toBe('<html>viewer</html>');
  });
});

describe('cpr view: branch reviews', () => {
  const viewer = tempDir();
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const C = 'c'.repeat(40);
  const runs: { pair: Pair; resolve: (graph: Graph) => void }[] = [];
  const diffs = new Diffs((pair) => new Promise((resolve) => runs.push({ pair, resolve })));
  const resolved: string[] = [];
  /** Where each branch's tip is: a test moves one to see it re-resolved. */
  const tips: Record<string, string> = { wip: B, topic: C, 'milestone/v15': C };
  const saved = new Map<string, unknown>();
  const reviews: BranchReviews = {
    list: () =>
      Promise.resolve({
        defaultBranch: 'main',
        reviewer: 'ada@example.com',
        place: 'repository',
        reviews: [],
      }),
    resolve: (ref) => {
      resolved.push(ref);
      const branch = ref.replace(/^origin\//, '');
      const head = tips[branch];
      if (branch === 'main') return Promise.reject(new ReviewRefused('main is the default branch'));
      if (!head) return Promise.reject(new ReviewRefused(`no branch ${ref}`));
      const info: BranchReviewInfo = { branch, ref, base: A, head, reviewed: null, since: null };
      return Promise.resolve({ info, pair: { base: A, head } });
    },
    state: (info) => ({
      read: (name) => Promise.resolve(saved.get(`${info.branch}@${info.head}:${name}`) ?? null),
      write: (name, value) => {
        saved.set(`${info.branch}@${info.head}:${name}`, value);
        return Promise.resolve();
      },
    }),
    finish: async (info, review, read) => {
      const code = await read('head', 'src/math.ts');
      finished.push({ branch: info.branch, review, code });
      const verdict = {
        at: 'now',
        comments: [],
        event: review.event,
        head: info.head,
        summary: '',
      };
      return { verdict, text: `finished ${info.branch}` };
    },
    merge: (info) => {
      merges.push(info.head);
      return Promise.resolve({ into: 'main', conflicts: ['docs/api.md'] });
    },
  };
  const merges: string[] = [];
  const opens: unknown[] = [];
  const finished: { branch: string; review: unknown; code: string }[] = [];
  const graphOf = ({ base, head }: Pair): Graph => ({
    ...graph,
    revisions: {
      base: { ref: base, sha: base, mergeBase: null },
      head: { ref: head, sha: head },
      from: base,
    },
  });
  let server: ViewServer;

  beforeAll(async () => {
    mkdirSync(join(viewer, 'assets'));
    writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>');
    server = await startViewServer({
      viewerDir: viewer,
      open: (request, worktree) => {
        opens.push(worktree ? { ...request, worktree } : request);
        return Promise.resolve({ opened: true, line: 1, how: 'exact', moved: false });
      },
      repository: {
        history: new Histories({
          state: () => Promise.resolve({ branch: 'main', head: C, version: 'v1' }),
          stream: () => Promise.resolve(),
          details: () => Promise.resolve([]),
        }),
        status: () =>
          Promise.resolve({ version: 'v1', branch: 'main', head: C, changed: 0, operation: null }),
        // `topic` is checked out in a feature's worktree (V18).
        refs: () =>
          Promise.resolve({
            branches: [{ name: 'topic', sha: C, worktree: '/work/app.worktrees/topic' }],
            remotes: [],
            tags: [],
          }),
        checkout: () => Promise.reject(new Error('no')),
        isCommit: () => Promise.resolve(true),
        diffs,
        readFile: (sha, path) => Promise.resolve(`// ${path} at ${sha.slice(0, 7)}`),
        state: () => ({
          read: () => Promise.resolve('pair state'),
          write: () => Promise.resolve(),
        }),
        reviews,
      },
    });
  });

  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
  });

  const get = async (path: string) => {
    const response = await fetch(new URL(path, server.url), { redirect: 'manual' });
    return {
      status: response.status,
      location: response.headers.get('location'),
      body: await response.text(),
    };
  };
  const send = (
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(new URL(path, server.url), {
      method,
      headers: { 'content-type': 'application/json', 'x-cpr': '1', ...headers },
      body: JSON.stringify(body),
    });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("lists the reviewer's reviews", async () => {
    expect(JSON.parse((await get('/api/reviews')).body)).toEqual({
      defaultBranch: 'main',
      reviewer: 'ada@example.com',
      place: 'repository',
      reviews: [],
    });
  });

  it('starts a review and answers where it is; refuses what cannot be reviewed', async () => {
    expect((await send('POST', '/api/reviews', { ref: 'wip' }, { 'x-cpr': '' })).status).toBe(403);
    expect((await send('POST', '/api/reviews', { ref: 5 })).status).toBe(400);
    const refused = await send('POST', '/api/reviews', { ref: 'main' });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe('main is the default branch');

    const started = await send('POST', '/api/reviews', { ref: 'wip' });
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ url: '/review/wip/' });
    expect(runs.map((r) => r.pair)).toEqual([{ base: A, head: B }]);
    // A branch's slashes stay in one path segment.
    expect(await (await send('POST', '/api/reviews', { ref: 'milestone/v15' })).json()).toEqual({
      url: '/review/milestone%2Fv15/',
    });
  });

  it("serves the review's page: its graph, what it is, and its own state", async () => {
    expect(await get('/review/wip')).toMatchObject({ status: 308, location: '/review/wip/' });
    expect((await get('/review/wip/')).body).toBe('<html>viewer</html>');
    expect(JSON.parse((await get('/review/wip/api/capabilities')).body)).toEqual({
      sources: true,
      review: { forge: 'local' },
      state: true,
      open: true,
      commits: true,
      branchReview: { branch: 'wip', ref: 'wip', base: A, head: B, reviewed: null, since: null },
    });
    expect((await get('/review/wip/api/graph')).status).toBe(202);
    runs[0]?.resolve(graphOf({ base: A, head: B }));
    await settle();
    expect((await get('/review/wip/api/graph')).status).toBe(200);

    expect(
      (await send('PUT', '/review/wip/api/state/review', { 'src/math.ts#add': 'x' })).status,
    ).toBe(204);
    expect(saved.get(`wip@${B}:review`)).toEqual({ 'src/math.ts#add': 'x' });
    expect(JSON.parse((await get('/review/wip/api/state/review')).body)).toEqual({
      'src/math.ts#add': 'x',
    });
    // The same pair picked in compare mode keeps its own state.
    expect(JSON.parse((await get(`/diff/${A}..${B}/api/state/review`)).body)).toBe('pair state');
  });

  it('resolves a review opened anew, and again when it is asked for again', async () => {
    const before = resolved.length;
    expect((await get('/review/topic/api/graph')).status).toBe(202);
    expect(resolved.slice(before)).toEqual(['topic']);
    await get('/review/topic/api/capabilities');
    expect(resolved.slice(before)).toEqual(['topic']);

    // The agent committed: asking again reviews the new tip.
    tips.wip = C;
    await send('POST', '/api/reviews', { ref: 'wip' });
    expect(JSON.parse((await get('/review/wip/api/capabilities')).body)).toMatchObject({
      branchReview: { head: C },
    });
  });

  it('finishes a review with a verdict, its comments checked against the change (V16)', async () => {
    const comment = {
      id: 'c1',
      symbol: 'src/math.ts#add',
      side: 'head',
      path: 'src/math.ts',
      otherPath: 'src/math.ts',
      line: 2,
      body: 'Why c = 0?',
    };
    const review = { event: 'request-changes', body: 'One thing.', comments: [comment] };
    // wip's tip moved to C (the test before): its analysis ends.
    runs.find((r) => r.pair.head === C)?.resolve(graphOf({ base: A, head: C }));
    await settle();
    expect((await send('POST', '/review/wip/api/review', review, { 'x-cpr': '' })).status).toBe(
      403,
    );
    for (const bad of [
      { ...comment, path: '../etc/passwd' },
      { ...comment, symbol: 'src/nope.ts#x' },
      { ...comment, body: ' ' },
      { ...comment, line: 0 },
    ]) {
      const refused = await send('POST', '/review/wip/api/review', { ...review, comments: [bad] });
      expect(refused.status).toBe(400);
    }
    const done = await send('POST', '/review/wip/api/review', {
      ...review,
      comments: [comment, { id: 'c2', symbol: 'src/math.ts#add', body: 'And the name?' }],
    });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({
      text: 'finished wip',
      verdict: { event: 'request-changes' },
    });
    expect(finished).toEqual([
      {
        branch: 'wip',
        review: {
          event: 'request-changes',
          body: 'One thing.',
          comments: [comment, { id: 'c2', symbol: 'src/math.ts#add', body: 'And the name?' }],
        },
        code: `// src/math.ts at ${C.slice(0, 7)}`,
      },
    ]);

    // Approve pushes nothing (V17): there is no push to retry.
    expect((await send('POST', '/review/wip/api/review/push', {})).status).toBe(405);
    // A pair picked in compare mode still has nowhere to send a review.
    expect((await send('POST', `/diff/${A}..${B}/api/review`, review)).status).toBe(404);
  });

  it('says whether the branch merges cleanly into the default branch (V17)', async () => {
    expect(JSON.parse((await get('/review/wip/api/merge')).body)).toEqual({
      into: 'main',
      conflicts: ['docs/api.md'],
    });
    expect(merges).toEqual([C]);
    // A conflicting file opens in VS Code though it is not part of the change; others do not.
    const open = (path: string, file: string) =>
      send('POST', path, { side: 'head', file, line: 1, column: 1 });
    expect((await open('/review/wip/api/open', 'docs/api.md')).status).toBe(200);
    expect(opens.at(-1)).toEqual({ sha: C, file: 'docs/api.md', line: 1, column: 1 });
    expect((await open('/review/wip/api/open', 'docs/other.md')).status).toBe(400);
    expect((await open(`/diff/${A}..${B}/api/open`, 'docs/api.md')).status).toBe(400);
    expect((await send('POST', '/review/wip/api/merge', {})).status).toBe(405);
    // A branch checked out in a feature's worktree opens there (V18b).
    expect((await open('/review/topic/api/open', 'docs/api.md')).status).toBe(200);
    expect(opens.at(-1)).toEqual({
      sha: C,
      file: 'docs/api.md',
      line: 1,
      column: 1,
      worktree: '/work/app.worktrees/topic',
    });
    // Compare mode has no branch to merge.
    expect((await get(`/diff/${A}..${B}/api/merge`)).status).toBe(404);
  });

  it('says why a review cannot be opened', async () => {
    expect(await get('/review/nope/api/graph')).toMatchObject({
      status: 404,
      body: JSON.stringify({ error: 'no branch nope' }),
    });
    expect((await get('/review/%E0%A4/api/graph')).status).toBe(400);
  });
});

describe('cpr view: features (V18)', () => {
  const viewer = tempDir();
  const C = 'c'.repeat(40);
  const summary: FeatureSummary = {
    branch: 'feature/csv',
    base: C,
    from: 'main',
    created: '2026-10-15T09:00:00.000Z',
    planFirst: true,
    brief: 'Export a review as CSV',
    worktree: { path: '/work/app.worktrees/feature-csv', exists: true },
    tip: C,
    ahead: 0,
    merged: false,
    agent: { state: 'working', kind: 'claude', id: 's1' },
  };
  const options: FeatureOptions = {
    base: { from: 'main', sha: C },
    branchPrefixes: {
      feature: 'feature/',
      fix: 'fix/',
      refactor: 'refactor/',
      chore: 'chore/',
      spike: 'spike/',
    },
    kinds: [
      {
        kind: 'fix',
        name: 'Fix',
        parts: [{ part: 'happens', heading: 'What happens', required: true }],
      },
    ],
    worktrees: '/work/app.worktrees/<branch>',
    agents: [{ kind: 'claude', command: '/usr/bin/claude', permissionMode: 'default' }],
    maxBrief: 20000,
  };
  const started: FeatureRequest[] = [];
  const drafts: Record<string, unknown>[] = [];
  const restarted: string[] = [];
  /** While set, a start waits for it. */
  let gate: Promise<void> | null = null;
  const features: Features = {
    options: () => Promise.resolve(options),
    list: () => Promise.resolve({ features: [summary], place: 'repository' }),
    start: async (request) => {
      started.push(request);
      if (gate) await gate;
      if (request.branch === 'main') throw new FeatureRefused('a branch main exists', 409);
      return { feature: summary, prompt: 'Build it.' };
    },
    startAgent: (branch) => {
      restarted.push(branch);
      if (branch === 'gone') return Promise.reject(new FeatureRefused('no workspace gone', 404));
      return Promise.resolve({ feature: summary, prompt: 'Build it.' });
    },
    prompt: (branch) =>
      branch === 'feature/csv'
        ? Promise.resolve('Build it.')
        : Promise.reject(new FeatureRefused(`no workspace ${branch}`, 404)),
    draft: () => Promise.resolve(drafts.at(-1) ?? {}),
    saveDraft: (value) => {
      drafts.push(value);
      return Promise.resolve();
    },
    check: (at) =>
      at === C
        ? Promise.resolve({ command: 'pnpm run check', source: 'package.json (scripts.check)' })
        : at === 'x'
          ? Promise.reject(new FeatureRefused('the commit must be a full SHA: x', 400))
          : Promise.resolve(null),
    stopAgent: (branch) => {
      stopped.push(branch);
      return branch === 'feature/csv'
        ? Promise.resolve({ feature: summary, prompt: 'Build it.' })
        : Promise.reject(new FeatureRefused('its agent is not running', 409));
    },
    openWorktree: (branch) => {
      openedFeatures.push(branch);
      return Promise.resolve();
    },
    merge: () => Promise.resolve({ into: 'main', conflicts: ['src/a.ts'] }),
    thread: (branch) =>
      branch === 'feature/csv'
        ? Promise.resolve({
            entries: [{ at: C, session: 'x', kind: 'report', text: 'The plan' }],
            recorded: true,
          })
        : Promise.reject(new FeatureRefused(`no workspace ${branch}`, 404)),
    reply: (request) => {
      replies.push(request);
      if (request.text === 'busy') {
        return Promise.reject(
          new FeatureRefused('its agent is working: sending stops its turn', 409),
        );
      }
      return Promise.resolve({ feature: summary });
    },
    clean: (request) => {
      cleaned.push(request);
      return Promise.resolve({ finished: C });
    },
    terminal: () => Promise.reject(new FeatureRefused('no terminals here', 409)),
  };
  const replies: FeatureReply[] = [];
  const cleaned: { branch: string; unmerged?: boolean }[] = [];
  const stopped: string[] = [];
  const openedFeatures: string[] = [];
  let server: ViewServer;
  let bare: ViewServer;
  const repository = (withFeatures: boolean) => ({
    history: new Histories({
      state: () => Promise.resolve({ branch: 'main', head: C, version: 'v1' }),
      stream: () => Promise.resolve(),
      details: () => Promise.resolve([]),
    }),
    status: () =>
      Promise.resolve({ version: 'v1', branch: 'main', head: C, changed: 0, operation: null }),
    refs: () => Promise.resolve({ branches: [], remotes: [], tags: [] }),
    checkout: () => Promise.reject(new Error('no')),
    isCommit: () => Promise.resolve(true),
    diffs: new Diffs(() => Promise.reject(new Error('no'))),
    readFile: () => Promise.resolve(''),
    ...(withFeatures ? { features } : {}),
  });

  beforeAll(async () => {
    writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>');
    server = await startViewServer({ viewerDir: viewer, repository: repository(true) });
    bare = await startViewServer({ viewerDir: viewer, repository: repository(false) });
  });
  afterAll(async () => {
    await server.close();
    await bare.close();
    rmSync(viewer, { recursive: true, force: true });
  });

  const get = (path: string, on = server) => fetch(new URL(path, on.url));
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(new URL(path, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cpr': '1', ...headers },
      body: JSON.stringify(body),
    });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const request = { brief: 'Export a review as CSV', branch: 'feature/csv', planFirst: true };

  it('lists features and what the start dialog needs', async () => {
    expect(await (await get('/api/features')).json()).toEqual({
      features: [summary],
      place: 'repository',
    });
    expect(await (await get('/api/features/options')).json()).toEqual(options);
    expect((await get('/api/features', bare)).status).toBe(404);
  });

  it('starts a feature as asked; refusals keep their status and words', async () => {
    const ok = await post('/api/features', { ...request, base: C, permissionMode: 'auto' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ feature: summary, prompt: 'Build it.' });
    expect(started.at(-1)).toEqual({ ...request, base: C, permissionMode: 'auto' });
    // The agent picked in the dialog (V20a).
    expect((await post('/api/features', { ...request, agent: 'codex' })).status).toBe(200);
    expect(started.at(-1)).toEqual({ ...request, agent: 'codex' });

    const taken = await post('/api/features', { ...request, branch: 'main' });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'a branch main exists' });

    const before = started.length;
    for (const body of [
      null,
      [],
      { ...request, brief: 3 },
      { ...request, branch: undefined },
      { ...request, planFirst: 'yes' },
      { ...request, base: 7 },
      { ...request, permissionMode: 7 },
      { ...request, agent: 7 },
    ]) {
      expect((await post('/api/features', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(started.length).toBe(before);
    expect((await get('/api/features/start')).status).toBe(405);
  });

  it('passes a kind of work on as asked; its fields must be text (V24)', async () => {
    const work = {
      kind: 'fix',
      title: 'Dates sort as text',
      parts: { happens: 'They sort 1, 10, 2.', doneWhen: 'A test passes.' },
      branch: 'fix/dates',
      planFirst: false,
    };
    expect((await post('/api/features', work)).status).toBe(200);
    expect(started.at(-1)).toEqual(work);
    // What the parts say is the features' to check: an unknown part is passed on.
    expect((await post('/api/features', { ...work, parts: { size: 'L' } })).status).toBe(200);
    expect(started.at(-1)?.parts).toEqual({ size: 'L' });

    const before = started.length;
    for (const body of [
      { ...work, kind: 3 },
      { ...work, title: ['T'] },
      { ...work, parts: 'H' },
      { ...work, parts: ['H'] },
      { ...work, parts: { happens: 3 } },
      // Neither a brief nor a kind.
      { branch: 'fix/dates', planFirst: false },
    ]) {
      expect((await post('/api/features', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(started.length).toBe(before);
  });

  it('starts an agent again', async () => {
    const ok = await post('/api/features/start', { branch: 'feature/csv' });
    expect(ok.status).toBe(200);
    expect(restarted).toEqual(['feature/csv']);
    const gone = await post('/api/features/start', { branch: 'gone' });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: 'no workspace gone' });
    expect((await post('/api/features/start', { name: 'x' })).status).toBe(400);
  });

  it("keeps the start dialog's draft: an object, written only by the page itself (V24c)", async () => {
    expect(await (await get('/api/features/draft')).json()).toEqual({});
    const draft = { kind: 'fix', title: 'Dates' };
    expect((await post('/api/features/draft', draft)).status).toBe(200);
    expect(await (await get('/api/features/draft')).json()).toEqual(draft);
    const before = drafts.length;
    expect((await post('/api/features/draft', draft, { 'x-cpr': '' })).status).toBe(403);
    for (const body of [null, [], 'text', 3]) {
      expect((await post('/api/features/draft', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(drafts.length).toBe(before);
    expect((await get('/api/features/draft', bare)).status).toBe(404);
  });

  it("guesses a commit's check command for the start dialog, or says none (V24b)", async () => {
    expect(await (await get(`/api/features/check?at=${C}`)).json()).toEqual({
      command: 'pnpm run check',
      source: 'package.json (scripts.check)',
    });
    expect(await (await get(`/api/features/check?at=${'d'.repeat(40)}`)).json()).toEqual({});
    expect((await get('/api/features/check?at=x')).status).toBe(400);
    expect((await get('/api/features/check')).status).toBe(400);
    expect((await get(`/api/features/check?at=${C}`, bare)).status).toBe(404);
  });

  it('serves the workspaces view, a prompt, its merge check; stops an agent, opens a worktree (V18b)', async () => {
    const page = await get('/workspaces');
    expect(page.status).toBe(200);
    expect(await page.text()).toBe('<html>viewer</html>');
    expect((await get('/workspaces', bare)).status).toBe(404);
    // The view's old address, kept for bookmarks.
    expect((await get('/features')).status).toBe(200);
    expect((await get('/features', bare)).status).toBe(404);

    expect(await (await get('/api/features/prompt?branch=feature%2Fcsv')).json()).toEqual({
      prompt: 'Build it.',
    });
    expect((await get('/api/features/prompt?branch=nope')).status).toBe(404);
    expect((await get('/api/features/prompt')).status).toBe(400);
    expect(await (await get('/api/features/merge?branch=feature%2Fcsv')).json()).toEqual({
      into: 'main',
      conflicts: ['src/a.ts'],
    });

    expect((await post('/api/features/stop', { branch: 'feature/csv' })).status).toBe(200);
    const notRunning = await post('/api/features/stop', { branch: 'other' });
    expect(notRunning.status).toBe(409);
    expect(await notRunning.json()).toEqual({ error: 'its agent is not running' });
    expect(stopped).toEqual(['feature/csv', 'other']);

    expect((await post('/api/features/open', { branch: 'feature/csv' })).status).toBe(200);
    expect(openedFeatures).toEqual(['feature/csv']);
    for (const path of ['/api/features/stop', '/api/features/open']) {
      expect((await post(path, { branch: 'x' }, { 'x-cpr': '' })).status, path).toBe(403);
      expect((await get(path)).status, path).toBe(405);
    }
    expect(stopped.length).toBe(2);
    expect(openedFeatures.length).toBe(1);
  });

  it('starts one feature at a time, and only for the page itself', async () => {
    let open = () => {};
    gate = new Promise((resolve) => (open = resolve));
    const first = post('/api/features', request);
    await settle();
    const second = await post('/api/features', request);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'a workspace is being started' });
    open();
    gate = null;
    expect((await first).status).toBe(200);

    const before = started.length;
    expect(
      (await post('/api/features', request, { origin: 'https://attacker.example' })).status,
    ).toBe(403);
    expect((await post('/api/features', request, { 'x-cpr': '' })).status).toBe(403);
    expect((await post('/api/features/start', { branch: 'x' }, { 'x-cpr': '' })).status).toBe(403);
    expect(started.length).toBe(before);
  });

  it("gives a feature's thread, sends a message to its agent, cleans it up (V18c)", async () => {
    expect(await (await get('/api/features/thread?branch=feature%2Fcsv')).json()).toEqual({
      entries: [{ at: C, session: 'x', kind: 'report', text: 'The plan' }],
      recorded: true,
    });
    expect((await get('/api/features/thread?branch=nope')).status).toBe(404);
    expect((await get('/api/features/thread')).status).toBe(400);

    const sent = await post('/api/features/reply', { branch: 'feature/csv', text: 'OK' });
    expect(sent.status).toBe(200);
    expect(await sent.json()).toEqual({ feature: summary });
    await post('/api/features/reply', { branch: 'feature/csv', text: 'Now', stop: true });
    const busy = await post('/api/features/reply', { branch: 'feature/csv', text: 'busy' });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ error: 'its agent is working: sending stops its turn' });
    expect(replies).toEqual([
      { branch: 'feature/csv', text: 'OK' },
      { branch: 'feature/csv', text: 'Now', stop: true },
      { branch: 'feature/csv', text: 'busy' },
    ]);
    for (const body of [
      { branch: 'feature/csv' },
      { text: 'x' },
      { branch: 'x', text: 'y', stop: 'yes' },
    ]) {
      expect((await post('/api/features/reply', body)).status, JSON.stringify(body)).toBe(400);
    }

    expect((await post('/api/features/clean', { branch: 'feature/csv' })).status).toBe(200);
    await post('/api/features/clean', { branch: 'feature/csv', unmerged: true });
    expect(cleaned).toEqual([{ branch: 'feature/csv' }, { branch: 'feature/csv', unmerged: true }]);
    expect((await post('/api/features/clean', { branch: 'x', unmerged: 'yes' })).status).toBe(400);

    for (const path of ['/api/features/reply', '/api/features/clean']) {
      expect((await post(path, { branch: 'x', text: 'y' }, { 'x-cpr': '' })).status, path).toBe(
        403,
      );
      expect((await get(path)).status, path).toBe(405);
    }
    expect(replies).toHaveLength(3);
    expect(cleaned).toHaveLength(2);
  });
});

describe('cpr view: terminals (V21)', () => {
  const viewer = tempDir();
  const C = 'c'.repeat(40);
  /** Fake pseudo-terminals behind the real terminals: what each was asked, and how to print. */
  const made: {
    args: string[];
    written: string[];
    sizes: [number, number][];
    signals: (string | undefined)[];
    print: (data: string) => void;
    exit: (code: number) => void;
  }[] = [];
  const spawn: SpawnPty = (_file, args) => {
    let onData: (data: string) => void = () => {};
    let onExit: (event: { exitCode: number }) => void = () => {};
    const record = {
      args,
      written: [] as string[],
      sizes: [] as [number, number][],
      signals: [] as (string | undefined)[],
      print: (data: string) => onData(data),
      exit: (code: number) => onExit({ exitCode: code }),
    };
    made.push(record);
    const pty: Pty = {
      onData: (listener) => (onData = listener),
      onExit: (listener) => (onExit = listener),
      write: (data) => record.written.push(data),
      resize: (cols, rows) => record.sizes.push([cols, rows]),
      kill: (signal) => {
        record.signals.push(signal);
        onExit({ exitCode: 129 });
      },
    };
    return pty;
  };
  const terminals = makeTerminals({ pty: () => Promise.resolve({ spawn }) });
  const asked: { branch: string; cols: number; rows: number }[] = [];
  const features = {
    terminal: (request: { branch: string; cols: number; rows: number }) => {
      asked.push(request);
      if (request.branch !== 'feature/csv') {
        return Promise.reject(new FeatureRefused('its agent has no session to open', 409));
      }
      return terminals
        .open({ command: 'claude', args: ['attach', 's1'], cwd: '/w', env: {}, ...request })
        .then((id) => ({ id }));
    },
  } as unknown as Features;
  let server: ViewServer;

  beforeAll(async () => {
    writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>');
    server = await startViewServer({
      viewerDir: viewer,
      repository: {
        history: new Histories({
          state: () => Promise.resolve({ branch: 'main', head: C, version: 'v1' }),
          stream: () => Promise.resolve(),
          details: () => Promise.resolve([]),
        }),
        status: () =>
          Promise.resolve({ version: 'v1', branch: 'main', head: C, changed: 0, operation: null }),
        refs: () => Promise.resolve({ branches: [], remotes: [], tags: [] }),
        checkout: () => Promise.reject(new Error('no')),
        isCommit: () => Promise.resolve(true),
        diffs: new Diffs(() => Promise.reject(new Error('no'))),
        readFile: () => Promise.resolve(''),
        features,
        terminals,
      },
    });
  });
  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
  });

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(new URL(path, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cpr': '1', ...headers },
      body: JSON.stringify(body),
    });
  const open = async (branch = 'feature/csv') => {
    const response = await post('/api/features/terminal', { branch, cols: 100, rows: 30 });
    expect(response.status).toBe(200);
    return ((await response.json()) as { id: string }).id;
  };
  /** Reads a terminal's events until `count` arrived (or its end). */
  async function events(id: string, count: number, headers: Record<string, string> = {}) {
    const response = await fetch(new URL(`/api/terminals/${id}`, server.url), { headers });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const got: { event: string; data: unknown }[] = [];
    let text = '';
    while (got.length < count) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = text.indexOf('\n\n')) >= 0) {
        const block = text.slice(0, end);
        text = text.slice(end + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (data !== undefined) got.push({ event, data: JSON.parse(data) as unknown });
      }
    }
    await reader.cancel();
    return got;
  }

  it("opens a terminal on a feature's agent session; refusals keep their status and words", async () => {
    const id = await open();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(asked.at(-1)).toEqual({ branch: 'feature/csv', cols: 100, rows: 30 });
    expect(made.at(-1)?.args).toEqual(['attach', 's1']);

    const none = await post('/api/features/terminal', { branch: 'x', cols: 80, rows: 24 });
    expect(none.status).toBe(409);
    expect(await none.json()).toEqual({ error: 'its agent has no session to open' });
    const before = asked.length;
    for (const body of [
      { branch: 'feature/csv' },
      { branch: 'feature/csv', cols: 0, rows: 24 },
      { branch: 'feature/csv', cols: 80.5, rows: 24 },
      { branch: 'feature/csv', cols: 80, rows: 5000 },
      { cols: 80, rows: 24 },
    ]) {
      expect((await post('/api/features/terminal', body)).status, JSON.stringify(body)).toBe(400);
    }
    // Only the page itself starts a process.
    const body = { branch: 'feature/csv', cols: 80, rows: 24 };
    expect((await post('/api/features/terminal', body, { 'x-cpr': '' })).status).toBe(403);
    const attacker = { origin: 'https://attacker.example' };
    expect((await post('/api/features/terminal', body, attacker)).status).toBe(403);
    expect(asked.length).toBe(before);
  });

  it('streams what it printed so far, then live, then its end', async () => {
    const id = await open();
    const pty = made.at(-1)!;
    pty.print('Claude Code\r\n> ');
    const reading = events(id, 3);
    // The stream is open before the next output.
    await new Promise((resolve) => setTimeout(resolve, 50));
    pty.print('hi');
    pty.exit(0);
    expect(await reading).toEqual([
      { event: 'out', data: 'Claude Code\r\n> ' },
      { event: 'out', data: 'hi' },
      { event: 'exit', data: { code: 0 } },
    ]);
    expect((await fetch(new URL(`/api/terminals/${id}`, server.url))).status).toBe(404);
  });

  it('writes keys and sizes, and hangs up; another site cannot read or write', async () => {
    const id = await open();
    const pty = made.at(-1)!;
    expect((await post(`/api/terminals/${id}/in`, { data: 'yes\r' })).status).toBe(204);
    expect((await post(`/api/terminals/${id}/resize`, { cols: 80, rows: 24 })).status).toBe(204);
    expect(pty.written).toEqual(['yes\r']);
    expect(pty.sizes).toEqual([[80, 24]]);

    for (const [path, body] of [
      ['in', { data: 3 }],
      ['in', { data: 'x'.repeat(65_537) }],
      ['resize', { cols: 80 }],
      ['resize', { cols: 0, rows: 24 }],
    ] as const) {
      expect((await post(`/api/terminals/${id}/${path}`, body)).status, path).toBe(400);
    }
    expect((await post(`/api/terminals/${id}/in`, { data: 'x' }, { 'x-cpr': '' })).status).toBe(
      403,
    );
    const attacker = { origin: 'https://attacker.example' };
    expect(
      (await fetch(new URL(`/api/terminals/${id}`, server.url), { headers: attacker })).status,
    ).toBe(403);
    expect(pty.written).toEqual(['yes\r']);
    expect((await fetch(new URL(`/api/terminals/${id}/in`, server.url))).status).toBe(405);

    expect((await post(`/api/terminals/${id}/close`, {})).status).toBe(204);
    expect(pty.signals).toEqual(['SIGHUP']);
    for (const path of ['in', 'resize', 'close']) {
      const response = await post(`/api/terminals/${id}/${path}`, { data: 'x', cols: 8, rows: 8 });
      expect(response.status, path).toBe(404);
    }
    expect((await fetch(new URL('/api/terminals/nope', server.url))).status).toBe(404);
  });

  it('hangs its terminals up and ends their streams when it closes', async () => {
    const other = await startViewServer({
      viewerDir: viewer,
      repository: {
        history: new Histories({
          state: () => Promise.resolve({ branch: 'main', head: C, version: 'v1' }),
          stream: () => Promise.resolve(),
          details: () => Promise.resolve([]),
        }),
        status: () =>
          Promise.resolve({ version: 'v1', branch: 'main', head: C, changed: 0, operation: null }),
        refs: () => Promise.resolve({ branches: [], remotes: [], tags: [] }),
        checkout: () => Promise.reject(new Error('no')),
        isCommit: () => Promise.resolve(true),
        diffs: new Diffs(() => Promise.reject(new Error('no'))),
        readFile: () => Promise.resolve(''),
        features,
        terminals,
      },
    });
    const id = await open();
    const response = await fetch(new URL(`/api/terminals/${id}`, other.url));
    const body = response.body as ReadableStream<Uint8Array>;
    await other.close();
    expect(made.at(-1)?.signals).toEqual(['SIGHUP']);
    // The stream ended: reading it to the end returns.
    const reader = body.getReader();
    while (!(await reader.read()).done);
  });
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
