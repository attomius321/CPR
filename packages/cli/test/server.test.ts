import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import {
  CheckoutRefused,
  UnknownCheckoutTarget,
  type BranchReviewInfo,
  type CheckoutTarget,
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
          Promise.resolve({ branches: [{ name: 'main', sha: C }], remotes: [], tags: [] }),
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
      remotes: [],
      tags: [],
    });
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
      return Promise.resolve({ into: 'main', conflicts: ['src/math.ts'] });
    },
  };
  const merges: string[] = [];
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
      conflicts: ['src/math.ts'],
    });
    expect(merges).toEqual([C]);
    expect((await send('POST', '/review/wip/api/merge', {})).status).toBe(405);
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
