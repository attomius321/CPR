import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import {
  CheckoutRefused,
  UnknownCheckoutTarget,
  type BranchReviewInfo,
  type CheckoutTarget,
  type WorkspaceOptions,
  type WorkspaceChanges,
  type WorkspaceReply,
  type WorkspaceRequest,
  type WorkspaceSummary,
  type Graph,
  type MergeEntry,
  type MergeLogLine,
  type PromptChange,
  type PromptSettings,
  type SkillChange,
  type SkillsState,
  type UsageReport,
  SymbioteError,
} from '@symbiote/core';
import type { Review } from '@symbiote/forge';
import type { CodeMap } from '@symbiote/monitor';
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
import { WorkspaceRefused, type Workspaces } from '../src/workspaces.js';
import { MergeRefused, type Merger } from '../src/merges.js';
import { PromptRefused, type PromptSettingsService } from '../src/prompts.js';
import { SkillRefused, type SkillsService } from '../src/skills.js';
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

  it('says what it can do: sources, but no reviews outside symbiote pr', async () => {
    expect(JSON.parse((await get('/api/capabilities')).body)).toEqual({
      sources: true,
      review: null,
      state: false,
    });
    const response = await fetch(new URL('/api/review', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: '{}',
    });
    expect(response.status).toBe(404);
    const open = await fetch(new URL('/api/open', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
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
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', ...headers },
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
    expect((await post({ 'x-symbiote': '' })).status).toBe(403);
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
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', ...headers },
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
    expect((await put('drafts', {}, { 'x-symbiote': '' })).status).toBe(403);
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
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', ...headers },
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
    expect((await post(ok, { 'x-symbiote': '' })).status).toBe(403);
    expect((await post(ok, { origin: 'https://attacker.example' })).status).toBe(403);
    expect((await fetch(new URL('/api/open', server.url))).status).toBe(405);
    expect((await post(ok, {}, folders)).status).toBe(404);
    expect(requests).toHaveLength(before);
  });
});

describe('symbiote view: commits and diffs', () => {
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
        name: 'widgets',
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
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', ...headers },
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
      (await post('/api/checkout', { kind: 'branch', name: 'wip' }, { 'x-symbiote': '' })).status,
    ).toBe(403);
    expect(checkouts.length).toBe(before + 1);
  });

  it("says it lists commits, and the repository's name (V29a); the root has no graph", async () => {
    expect(JSON.parse((await get('/api/capabilities')).body)).toEqual({
      sources: false,
      review: null,
      state: false,
      commits: true,
      repo: 'widgets',
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
    expect((await post('/api/diffs', { base: A, head: B }, { 'x-symbiote': '' })).status).toBe(403);
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
      repo: 'widgets',
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
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
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
    runs[1]?.reject(new Error("symbiote: unknown revision 'x'"));
    await settle();
    const failed = await get(`/diff/${B}..${C}/api/graph`);
    expect(failed.status).toBe(502);
    expect(JSON.parse(failed.body)).toEqual({
      base: B,
      head: C,
      error: "symbiote: unknown revision 'x'",
    });
    await post('/api/diffs', { base: B, head: C });
    expect(runs).toHaveLength(3);
  });

  it('stops an analysis', async () => {
    expect((await post('/api/diffs/stop', { base: B, head: C }, { 'x-symbiote': '' })).status).toBe(
      403,
    );
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

describe('symbiote view: branch reviews', () => {
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
        // `topic` is checked out in a workspace's worktree (V18).
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
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', ...headers },
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
    expect((await send('POST', '/api/reviews', { ref: 'wip' }, { 'x-symbiote': '' })).status).toBe(
      403,
    );
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
    expect(
      (await send('POST', '/review/wip/api/review', review, { 'x-symbiote': '' })).status,
    ).toBe(403);
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
    // A branch checked out in a workspace's worktree opens there (V18b).
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

describe('symbiote view: workspaces (V18)', () => {
  const viewer = tempDir();
  const C = 'c'.repeat(40);
  const summary: WorkspaceSummary = {
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
  const options: WorkspaceOptions = {
    base: { from: 'main', sha: C },
    branches: [{ name: 'main', sha: C }],
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
    documents: {
      folder: '/work/app/symbiote/documents/<branch>',
      maxFiles: 20,
      maxBytes: 20 << 20,
      maxTotal: 100 << 20,
    },
  };
  const started: WorkspaceRequest[] = [];
  const uploads: { name: string; bytes: Buffer }[] = [];
  const drafts: Record<string, unknown>[] = [];
  const restarted: string[] = [];
  /** While set, a start waits for it. */
  let gate: Promise<void> | null = null;
  const workspaces: Workspaces = {
    options: () => Promise.resolve(options),
    list: () => Promise.resolve({ workspaces: [summary], place: 'repository' }),
    start: async (request) => {
      started.push(request);
      if (gate) await gate;
      if (request.branch === 'main') throw new WorkspaceRefused('a branch main exists', 409);
      return { workspace: summary, prompt: 'Build it.' };
    },
    startAgent: (branch) => {
      restarted.push(branch);
      if (branch === 'gone') return Promise.reject(new WorkspaceRefused('no workspace gone', 404));
      return Promise.resolve({ workspace: summary, prompt: 'Build it.' });
    },
    prompt: (branch) =>
      branch === 'feature/csv'
        ? Promise.resolve('Build it.')
        : Promise.reject(new WorkspaceRefused(`no workspace ${branch}`, 404)),
    saveDocument: (name, bytes) => {
      uploads.push({ name, bytes: Buffer.from(bytes) });
      return Promise.resolve({ id: 'd'.repeat(32), name: `${name}!`, size: bytes.length });
    },
    draft: () => Promise.resolve(drafts.at(-1) ?? {}),
    saveDraft: (value) => {
      drafts.push(value);
      return Promise.resolve();
    },
    check: (at) =>
      at === C
        ? Promise.resolve({ command: 'pnpm run check', source: 'package.json (scripts.check)' })
        : at === 'x'
          ? Promise.reject(new WorkspaceRefused('the commit must be a full SHA: x', 400))
          : Promise.resolve(null),
    stopAgent: (branch) => {
      stopped.push(branch);
      return branch === 'feature/csv'
        ? Promise.resolve({ workspace: summary, prompt: 'Build it.' })
        : Promise.reject(new WorkspaceRefused('its agent is not running', 409));
    },
    openWorktree: (branch) => {
      openedWorkspaces.push(branch);
      return Promise.resolve();
    },
    openDiff: (branch, file) => {
      openedDiffs.push(`${branch} ${JSON.stringify(file)}`);
      return Promise.resolve();
    },
    changes: (branch) =>
      branch === 'feature/csv'
        ? Promise.resolve(changes)
        : Promise.reject(new WorkspaceRefused(`no workspace ${branch}`, 404)),
    merge: () => Promise.resolve({ into: 'main', conflicts: ['src/a.ts'] }),
    thread: (branch) =>
      branch === 'feature/csv'
        ? Promise.resolve({
            entries: [{ at: C, session: 'x', kind: 'report', text: 'The plan' }],
            recorded: true,
          })
        : Promise.reject(new WorkspaceRefused(`no workspace ${branch}`, 404)),
    reply: (request) => {
      replies.push(request);
      if (request.text === 'busy') {
        return Promise.reject(
          new WorkspaceRefused('its agent is working: sending stops its turn', 409),
        );
      }
      return Promise.resolve({ workspace: summary });
    },
    clean: (request) => {
      cleaned.push(request);
      return Promise.resolve({ finished: C });
    },
    terminal: () => Promise.reject(new WorkspaceRefused('no terminals here', 409)),
    shell: () => Promise.reject(new WorkspaceRefused('no terminals here', 409)),
    shells: () => Promise.resolve({ shells: [] }),
  };
  const changes: WorkspaceChanges = {
    branch: 'feature/csv',
    base: C,
    since: 'main',
    tip: C,
    commits: { count: 0, listed: [] },
    files: { count: 0, added: 0, removed: 0, listed: [] },
    uncommitted: { count: 1, listed: [{ status: 'untracked', path: 'notes.md' }] },
  };
  const replies: WorkspaceReply[] = [];
  const cleaned: { branch: string; unmerged?: boolean }[] = [];
  const stopped: string[] = [];
  const openedWorkspaces: string[] = [];
  const openedDiffs: string[] = [];
  let server: ViewServer;
  let bare: ViewServer;
  const repository = (withWorkspaces: boolean) => ({
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
    ...(withWorkspaces ? { workspaces } : {}),
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
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', ...headers },
      body: JSON.stringify(body),
    });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const request = { brief: 'Export a review as CSV', branch: 'feature/csv', planFirst: true };

  it('lists workspaces and what the start dialog needs', async () => {
    expect(await (await get('/api/workspaces')).json()).toEqual({
      workspaces: [summary],
      place: 'repository',
    });
    expect(await (await get('/api/workspaces/options')).json()).toEqual(options);
    expect((await get('/api/workspaces', bare)).status).toBe(404);
  });

  it('starts a workspace as asked; refusals keep their status and words', async () => {
    const ok = await post('/api/workspaces', { ...request, base: C, permissionMode: 'auto' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ workspace: summary, prompt: 'Build it.' });
    expect(started.at(-1)).toEqual({ ...request, base: C, permissionMode: 'auto' });
    // The agent picked in the dialog (V20a).
    expect((await post('/api/workspaces', { ...request, agent: 'codex' })).status).toBe(200);
    expect(started.at(-1)).toEqual({ ...request, agent: 'codex' });
    // Its effort level (V30b), the workspaces' to check against the agent's.
    expect((await post('/api/workspaces', { ...request, effort: 'high' })).status).toBe(200);
    expect(started.at(-1)).toEqual({ ...request, effort: 'high' });
    // Its model (V47), the workspaces' to check against the agent's list.
    expect((await post('/api/workspaces', { ...request, model: 'sonnet' })).status).toBe(200);
    expect(started.at(-1)).toEqual({ ...request, model: 'sonnet' });
    // A branch to start from (V33), the workspaces' to find.
    expect((await post('/api/workspaces', { ...request, from: 'topic' })).status).toBe(200);
    expect(started.at(-1)).toEqual({ ...request, from: 'topic' });

    const taken = await post('/api/workspaces', { ...request, branch: 'main' });
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
      { ...request, from: 7 },
      { ...request, permissionMode: 7 },
      { ...request, agent: 7 },
      { ...request, effort: 7 },
      { ...request, model: 7 },
    ]) {
      expect((await post('/api/workspaces', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(started.length).toBe(before);
    expect((await get('/api/workspaces/start')).status).toBe(405);
  });

  it('passes a kind of work on as asked; its fields must be text (V24)', async () => {
    const work = {
      kind: 'fix',
      title: 'Dates sort as text',
      parts: { happens: 'They sort 1, 10, 2.', doneWhen: 'A test passes.' },
      branch: 'fix/dates',
      planFirst: false,
    };
    expect((await post('/api/workspaces', work)).status).toBe(200);
    expect(started.at(-1)).toEqual(work);
    // What the parts say is the workspaces' to check: an unknown part is passed on.
    expect((await post('/api/workspaces', { ...work, parts: { size: 'L' } })).status).toBe(200);
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
      expect((await post('/api/workspaces', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(started.length).toBe(before);
  });

  it('keeps a document for the start, as base64 under the write rule; at most 20 MB (V40)', async () => {
    const bytes = Buffer.from('%PDF-1.7 spec');
    const ok = await post('/api/workspaces/documents', {
      name: 'spec.pdf',
      data: bytes.toString('base64'),
    });
    expect(ok.status).toBe(200);
    // The workspaces' answer, with the name they made safe.
    expect(await ok.json()).toEqual({ id: 'd'.repeat(32), name: 'spec.pdf!', size: bytes.length });
    expect(uploads.at(-1)).toEqual({ name: 'spec.pdf', bytes });
    // An empty file is a file.
    expect((await post('/api/workspaces/documents', { name: 'empty.txt', data: '' })).status).toBe(
      200,
    );
    expect(uploads.at(-1)?.bytes.length).toBe(0);

    const before = uploads.length;
    for (const body of [{}, { name: 'a' }, { data: 'AA==' }, { name: 3, data: 'AA==' }, []]) {
      const refused = await post('/api/workspaces/documents', body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
    }
    // Over 20 MB: refused before it is read.
    const big = await post('/api/workspaces/documents', {
      name: 'big',
      data: 'A'.repeat(28 << 20),
    });
    expect(big.status).toBe(413);
    expect(await big.text()).toBe('a document of at most 20 MB');
    const data = bytes.toString('base64');
    const headers: Record<string, string>[] = [
      { 'x-symbiote': '' },
      { origin: 'https://attacker.example' },
    ];
    for (const header of headers) {
      expect((await post('/api/workspaces/documents', { name: 'a', data }, header)).status).toBe(
        403,
      );
    }
    expect((await get('/api/workspaces/documents')).status).toBe(405);
    expect(uploads.length).toBe(before);
  });

  it("passes a start's documents on: each an id and a name (V40)", async () => {
    const documents = [{ id: 'd'.repeat(32), name: 'spec.pdf' }];
    expect((await post('/api/workspaces', { ...request, documents })).status).toBe(200);
    expect(started.at(-1)).toEqual({ ...request, documents });
    const before = started.length;
    for (const bad of ['spec.pdf', [{ id: 3, name: 'a' }], [{ id: 'x' }], [null]]) {
      const refused = await post('/api/workspaces', { ...request, documents: bad });
      expect(refused.status, JSON.stringify(bad)).toBe(400);
    }
    expect(started.length).toBe(before);
  });

  it('starts an agent again', async () => {
    const ok = await post('/api/workspaces/start', { branch: 'feature/csv' });
    expect(ok.status).toBe(200);
    expect(restarted).toEqual(['feature/csv']);
    const gone = await post('/api/workspaces/start', { branch: 'gone' });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: 'no workspace gone' });
    expect((await post('/api/workspaces/start', { name: 'x' })).status).toBe(400);
  });

  it("keeps the start dialog's draft: an object, written only by the page itself (V24c)", async () => {
    expect(await (await get('/api/workspaces/draft')).json()).toEqual({});
    const draft = { kind: 'fix', title: 'Dates' };
    expect((await post('/api/workspaces/draft', draft)).status).toBe(200);
    expect(await (await get('/api/workspaces/draft')).json()).toEqual(draft);
    const before = drafts.length;
    expect((await post('/api/workspaces/draft', draft, { 'x-symbiote': '' })).status).toBe(403);
    for (const body of [null, [], 'text', 3]) {
      expect((await post('/api/workspaces/draft', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(drafts.length).toBe(before);
    expect((await get('/api/workspaces/draft', bare)).status).toBe(404);
  });

  it("guesses a commit's check command for the start dialog, or says none (V24b)", async () => {
    expect(await (await get(`/api/workspaces/check?at=${C}`)).json()).toEqual({
      command: 'pnpm run check',
      source: 'package.json (scripts.check)',
    });
    expect(await (await get(`/api/workspaces/check?at=${'d'.repeat(40)}`)).json()).toEqual({});
    expect((await get('/api/workspaces/check?at=x')).status).toBe(400);
    expect((await get('/api/workspaces/check')).status).toBe(400);
    expect((await get(`/api/workspaces/check?at=${C}`, bare)).status).toBe(404);
  });

  it('serves the workspaces view, a prompt, its merge check; stops an agent, opens a worktree (V18b)', async () => {
    const page = await get('/workspaces');
    expect(page.status).toBe(200);
    expect(await page.text()).toBe('<html>viewer</html>');
    expect((await get('/workspaces', bare)).status).toBe(404);
    // The view's old address, kept for bookmarks.
    expect((await get('/features')).status).toBe(200);
    expect((await get('/features', bare)).status).toBe(404);
    // Start a workspace, a page of its own since V30a: a reload there is the viewer too.
    expect(await (await get('/start')).text()).toBe('<html>viewer</html>');
    expect((await get('/start', bare)).status).toBe(404);

    expect(await (await get('/api/workspaces/prompt?branch=feature%2Fcsv')).json()).toEqual({
      prompt: 'Build it.',
    });
    expect((await get('/api/workspaces/prompt?branch=nope')).status).toBe(404);
    expect((await get('/api/workspaces/prompt')).status).toBe(400);
    expect(await (await get('/api/workspaces/merge?branch=feature%2Fcsv')).json()).toEqual({
      into: 'main',
      conflicts: ['src/a.ts'],
    });

    expect((await post('/api/workspaces/stop', { branch: 'feature/csv' })).status).toBe(200);
    const notRunning = await post('/api/workspaces/stop', { branch: 'other' });
    expect(notRunning.status).toBe(409);
    expect(await notRunning.json()).toEqual({ error: 'its agent is not running' });
    expect(stopped).toEqual(['feature/csv', 'other']);

    expect((await post('/api/workspaces/open', { branch: 'feature/csv' })).status).toBe(200);
    expect(openedWorkspaces).toEqual(['feature/csv']);
    for (const path of ['/api/workspaces/stop', '/api/workspaces/open']) {
      expect((await post(path, { branch: 'x' }, { 'x-symbiote': '' })).status, path).toBe(403);
      expect((await get(path)).status, path).toBe(405);
    }
    expect(stopped.length).toBe(2);
    expect(openedWorkspaces.length).toBe(1);
  });

  it("gives a workspace's changes and opens one of its files as its diff (V29d, V43)", async () => {
    const answer = await get('/api/workspaces/changes?branch=feature%2Fcsv');
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual(changes);
    expect((await get('/api/workspaces/changes?branch=nope')).status).toBe(404);
    expect((await get('/api/workspaces/changes')).status).toBe(400);
    expect((await post('/api/workspaces/changes', { branch: 'feature/csv' })).status).toBe(405);

    // A file as its diff (V43): the branch's change, or the worktree's.
    openedDiffs.length = 0;
    const file = { branch: 'feature/csv', file: 'src/new.ts', previousPath: 'src/old.ts' };
    const opened = await post('/api/workspaces/diff', file);
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({});
    expect((await post('/api/workspaces/diff', { ...file, uncommitted: true })).status).toBe(200);
    expect(openedDiffs).toEqual([
      'feature/csv {"path":"src/new.ts","previousPath":"src/old.ts"}',
      'feature/csv {"path":"src/new.ts","previousPath":"src/old.ts","uncommitted":true}',
    ]);
    for (const bad of [
      { file: 'src/a.ts' },
      { branch: 'feature/csv' },
      { branch: 'feature/csv', file: 3 },
      { branch: 'feature/csv', file: '' },
      { branch: 'feature/csv', file: 'src/a.ts', previousPath: 3 },
      { branch: 'feature/csv', file: 'src/a.ts', uncommitted: 'yes' },
    ]) {
      expect((await post('/api/workspaces/diff', bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(openedDiffs).toHaveLength(2);
    expect((await get('/api/workspaces/diff')).status).toBe(405);
    expect((await post('/api/workspaces/diff', file, { 'x-symbiote': '' })).status).toBe(403);
    // Its folder only, now: the panel opens a file's diff.
    openedWorkspaces.length = 0;
    expect((await post('/api/workspaces/open', file)).status).toBe(200);
    expect(openedWorkspaces).toEqual(['feature/csv']);
  });

  it('starts one workspace at a time, and only for the page itself', async () => {
    let open = () => {};
    gate = new Promise((resolve) => (open = resolve));
    const first = post('/api/workspaces', request);
    await settle();
    const second = await post('/api/workspaces', request);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'a workspace is being started' });
    open();
    gate = null;
    expect((await first).status).toBe(200);

    const before = started.length;
    expect(
      (await post('/api/workspaces', request, { origin: 'https://attacker.example' })).status,
    ).toBe(403);
    expect((await post('/api/workspaces', request, { 'x-symbiote': '' })).status).toBe(403);
    expect(
      (await post('/api/workspaces/start', { branch: 'x' }, { 'x-symbiote': '' })).status,
    ).toBe(403);
    expect(started.length).toBe(before);
  });

  it("gives a workspace's thread, sends a message to its agent, cleans it up (V18c)", async () => {
    expect(await (await get('/api/workspaces/thread?branch=feature%2Fcsv')).json()).toEqual({
      entries: [{ at: C, session: 'x', kind: 'report', text: 'The plan' }],
      recorded: true,
    });
    expect((await get('/api/workspaces/thread?branch=nope')).status).toBe(404);
    expect((await get('/api/workspaces/thread')).status).toBe(400);

    const sent = await post('/api/workspaces/reply', { branch: 'feature/csv', text: 'OK' });
    expect(sent.status).toBe(200);
    expect(await sent.json()).toEqual({ workspace: summary });
    await post('/api/workspaces/reply', { branch: 'feature/csv', text: 'Now', stop: true });
    const busy = await post('/api/workspaces/reply', { branch: 'feature/csv', text: 'busy' });
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
      expect((await post('/api/workspaces/reply', body)).status, JSON.stringify(body)).toBe(400);
    }

    expect((await post('/api/workspaces/clean', { branch: 'feature/csv' })).status).toBe(200);
    await post('/api/workspaces/clean', { branch: 'feature/csv', unmerged: true });
    expect(cleaned).toEqual([{ branch: 'feature/csv' }, { branch: 'feature/csv', unmerged: true }]);
    expect((await post('/api/workspaces/clean', { branch: 'x', unmerged: 'yes' })).status).toBe(
      400,
    );

    for (const path of ['/api/workspaces/reply', '/api/workspaces/clean']) {
      expect(
        (await post(path, { branch: 'x', text: 'y' }, { 'x-symbiote': '' })).status,
        path,
      ).toBe(403);
      expect((await get(path)).status, path).toBe(405);
    }
    expect(replies).toHaveLength(3);
    expect(cleaned).toHaveLength(2);
  });
});

describe('symbiote view: merges (V26a)', () => {
  const viewer = tempDir();
  const C = 'c'.repeat(40);
  const entry: MergeEntry = {
    id: 'm1',
    branch: 'feature/csv',
    head: C,
    into: 'main',
    title: 'Merge feature/csv: CSV',
    state: 'queued',
    queued: '2026-10-19T12:00:00.000Z',
    updated: '2026-10-19T12:00:00.000Z',
  };
  const asked: string[] = [];
  const merges: Merger = {
    list: () => Promise.resolve({ merges: [entry] }),
    targets: (branch) =>
      Promise.resolve({
        branches: ['develop', 'main'],
        into: 'main',
        head: C,
        ...(branch === 'x' ? { blocked: 'x is not approved' } : {}),
      }),
    enqueue: (request) => {
      asked.push(`enqueue ${request.branch} ${request.into}`);
      return request.branch === 'x'
        ? Promise.reject(new MergeRefused('x is not approved', 409))
        : Promise.resolve(entry);
    },
    land: (id) => {
      asked.push(`land ${id}`);
      return Promise.resolve({ ...entry, state: 'landed' });
    },
    retry: (id) => {
      asked.push(`retry ${id}`);
      return Promise.resolve(entry);
    },
    approve: (id) => {
      asked.push(`approve ${id}`);
      return Promise.resolve({ ...entry, state: 'landed' });
    },
    requestChanges: (id, comments) => {
      asked.push(`change ${id} ${comments}`);
      return Promise.resolve(entry);
    },
    recheck: (id) => {
      asked.push(`recheck ${id}`);
      return Promise.resolve({ ...entry, recheck: true });
    },
    remove: (id) => {
      asked.push(`remove ${id}`);
      return id === 'm1'
        ? Promise.resolve()
        : Promise.reject(new MergeRefused(`no merge ${id}`, 404));
    },
    idle: () => Promise.resolve(),
    // The merger's effort (V46d): its agent's levels, and a level set or refused.
    efforts: () =>
      Promise.resolve({
        agents: [{ kind: 'claude', efforts: { levels: ['low', 'high'] } }],
        effort: 'high',
        file: 'symbiote/config.json',
      }),
    setEffort: ({ effort }) => {
      asked.push(`effort ${String(effort)}`);
      return effort === 'ultra'
        ? Promise.reject(new MergeRefused('Claude Code takes low or high: ultra', 400))
        : Promise.resolve({ agents: [], file: 'symbiote/config.json' });
    },
    // A log whose offsets are its lines' indexes; `logGone` once its entry is removed (V46a).
    log: (id, from = 0) =>
      Promise.resolve(
        id === 'm1' && !logGone ? { lines: logLines.slice(from), next: logLines.length } : null,
      ),
  };
  const logLines: MergeLogLine[] = [];
  let logGone = false;
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
        merges,
      },
    });
  });
  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
  });
  const get = (path: string) => fetch(new URL(path, server.url));
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(new URL(path, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', ...headers },
      body: JSON.stringify(body),
    });

  it("lists the queue and a branch's targets; queues, lands, retries and removes", async () => {
    expect(await (await get('/api/merges')).json()).toEqual({ merges: [entry] });
    expect(await (await get('/api/merges/targets?branch=feature%2Fcsv')).json()).toEqual({
      branches: ['develop', 'main'],
      into: 'main',
      head: C,
    });
    expect((await get('/api/merges/targets')).status).toBe(400);

    expect(
      await (await post('/api/merges', { branch: 'feature/csv', into: 'main' })).json(),
    ).toEqual(entry);
    const refused = await post('/api/merges', { branch: 'x', into: 'main' });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'x is not approved' });
    for (const body of [null, { branch: 'a' }, { into: 'main' }, { branch: 3, into: 'main' }]) {
      expect((await post('/api/merges', body)).status, JSON.stringify(body)).toBe(400);
    }

    expect(
      (await (await post('/api/merges/land', { id: 'm1' })).json()) as MergeEntry,
    ).toMatchObject({ state: 'landed' });
    expect((await post('/api/merges/retry', { id: 'm1' })).status).toBe(200);
    expect((await post('/api/merges/remove', { id: 'm1' })).status).toBe(200);
    expect((await post('/api/merges/remove', { id: 'm2' })).status).toBe(404);
    expect((await post('/api/merges/land', {})).status).toBe(400);
    for (const path of [
      '/api/merges',
      '/api/merges/land',
      '/api/merges/retry',
      '/api/merges/remove',
    ]) {
      expect(
        (await post(path, { id: 'm1', branch: 'a', into: 'b' }, { 'x-symbiote': '' })).status,
        path,
      ).toBe(403);
    }
    expect((await get('/api/merges/land')).status).toBe(405);
    // A resolution (V26c): approved, or asked again with the person's words.
    expect((await post('/api/merges/approve', { id: 'm1' })).status).toBe(200);
    expect(
      (await post('/api/merges/request-changes', { id: 'm1', comments: 'Keep both.' })).status,
    ).toBe(200);
    expect((await post('/api/merges/request-changes', { id: 'm1' })).status).toBe(400);
    // Its failed check run again (fix/fix-merger).
    expect((await post('/api/merges/recheck', { id: 'm1' })).status).toBe(200);
    expect((await post('/api/merges/recheck', { id: 'm1' }, { 'x-symbiote': '' })).status).toBe(
      403,
    );
    expect(asked.slice(-3)).toEqual(['approve m1', 'change m1 Keep both.', 'recheck m1']);
    asked.splice(-3);
    expect(asked).toEqual([
      'enqueue feature/csv main',
      'enqueue x main',
      'land m1',
      'retry m1',
      'remove m1',
      'remove m2',
    ]);
  });

  it("reads the merger's effort levels, and sets or removes merge.effort (V46d)", async () => {
    expect(await (await get('/api/merges/efforts')).json()).toEqual({
      agents: [{ kind: 'claude', efforts: { levels: ['low', 'high'] } }],
      effort: 'high',
      file: 'symbiote/config.json',
    });
    expect((await post('/api/merges/effort', { effort: 'high' })).status).toBe(200);
    expect((await post('/api/merges/effort', { effort: null })).status).toBe(200);
    const refused = await post('/api/merges/effort', { effort: 'ultra' });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'Claude Code takes low or high: ultra' });
    expect((await post('/api/merges/effort', { effort: 3 })).status).toBe(400);
    expect((await post('/api/merges/effort', { effort: 'low' }, { 'x-symbiote': '' })).status).toBe(
      403,
    );
    expect((await post('/api/merges/efforts', {})).status).toBe(405);
    expect(asked.splice(-3)).toEqual(['effort high', 'effort null', 'effort ultra']);
  });

  it("streams a merge's log: its lines so far, then each line appended, until its entry goes (V46a)", async () => {
    logLines.push({ at: 1, step: 'check', title: 'pnpm check' }, { at: 2, out: 'one\n' });
    const response = await get('/api/merges/log?id=m1');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    /** The next event: its name and data. */
    const next = async (): Promise<{ event: string; data: unknown }> => {
      for (;;) {
        const end = text.indexOf('\n\n');
        if (end >= 0) {
          const block = text.slice(0, end);
          text = text.slice(end + 2);
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (data === undefined) continue;
          return {
            event: /^event: (.*)$/m.exec(block)?.[1] ?? 'message',
            data: JSON.parse(data) as unknown,
          };
        }
        const { done, value } = await reader.read();
        if (done) return { event: 'end', data: null };
        text += decoder.decode(value, { stream: true });
      }
    };
    expect(await next()).toEqual({
      event: 'lines',
      data: { lines: logLines.slice(0, 2), next: 2 },
    });
    logLines.push({ at: 3, out: 'two\n' }, { at: 4, end: { ok: true, ms: 3 } });
    expect(await next()).toEqual({ event: 'lines', data: { lines: logLines.slice(2), next: 4 } });
    logGone = true;
    expect(await next()).toEqual({ event: 'gone', data: {} });
    expect(await next()).toEqual({ event: 'end', data: null });
    logGone = false;

    // From an offset: a page that reconnects reads on from where it was.
    const again = await get('/api/merges/log?id=m1&from=3');
    const first = decoder.decode(
      (await (again.body as ReadableStream<Uint8Array>).getReader().read()).value,
    );
    expect(first).toBe(
      `event: lines\ndata: ${JSON.stringify({ lines: logLines.slice(3), next: 4 })}\n\n`,
    );
    await again.body?.cancel().catch(() => undefined);
    expect((await get('/api/merges/log?id=m2')).status).toBe(404);
    expect((await get('/api/merges/log')).status).toBe(400);
    expect((await get('/api/merges/log?id=m1&from=-1')).status).toBe(400);
    expect((await post('/api/merges/log?id=m1', {})).status).toBe(405);
  });
});

describe('symbiote view: settings (V28)', () => {
  const viewer = tempDir();
  const C = 'c'.repeat(40);
  const answer: PromptSettings = {
    file: 'symbiote/config.json',
    version: 'v1',
    git: 'none',
    prompts: [],
  };
  const asked: PromptChange[] = [];
  const settings: PromptSettingsService = {
    prompts: () => Promise.resolve(answer),
    setPrompt: (change) => {
      asked.push(change);
      return change.version === 'v1'
        ? Promise.resolve({ ...answer, version: 'v2' })
        : Promise.reject(
            new PromptRefused('symbiote/config.json changed since you opened it', 409),
          );
    },
  };
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
        settings,
      },
    });
  });
  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
  });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(new URL('/api/settings/prompts', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', ...headers },
      body: JSON.stringify(body),
    });

  it('reads the prompts, saves a change, and refuses a stale or a wrong one', async () => {
    expect(await (await fetch(new URL('/api/settings/prompts', server.url))).json()).toEqual(
      answer,
    );
    const saved = await post({ key: 'start.fix', text: 'Fix it: {brief}', version: 'v1' });
    expect(await saved.json()).toMatchObject({ version: 'v2' });
    expect((await post({ key: 'merger', text: null, version: 'v1' })).status).toBe(200);
    const stale = await post({ key: 'merger', text: 'Keep both.', version: 'v0' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: 'symbiote/config.json changed since you opened it',
    });
    for (const body of [
      null,
      { key: 'start.bug', text: 'x', version: 'v1' },
      { key: 'merger', text: 3, version: 'v1' },
      { key: 'merger', text: 'x' },
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(
      (await post({ key: 'merger', text: 'x', version: 'v1' }, { 'x-symbiote': '' })).status,
    ).toBe(403);
    expect(asked).toEqual([
      { key: 'start.fix', text: 'Fix it: {brief}', version: 'v1' },
      { key: 'merger', text: null, version: 'v1' },
      { key: 'merger', text: 'Keep both.', version: 'v0' },
    ]);
  });
});

describe('symbiote view: skills (V41)', () => {
  const viewer = tempDir();
  const C = 'c'.repeat(40);
  const answer: SkillsState = {
    checkout: '/repo',
    skills: [],
    codex: { installed: false, link: 'none', canLink: true },
  };
  const asked: SkillChange[] = [];
  const skills: SkillsService = {
    state: () => Promise.resolve(answer),
    change: (change) => {
      asked.push(change);
      return change.action === 'delete'
        ? Promise.reject(
            new SkillRefused('.claude/skills/a/SKILL.md changed since you opened it', 409),
          )
        : Promise.resolve(answer);
    },
  };
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
        skills,
      },
    });
  });
  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
  });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(new URL('/api/skills', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', ...headers },
      body: JSON.stringify(body),
    });

  it('serves the page, reads the skills, makes a change, and refuses a stale or a wrong one', async () => {
    expect(await (await fetch(new URL('/skills', server.url))).text()).toContain('viewer');
    expect(await (await fetch(new URL('/api/skills', server.url))).json()).toEqual(answer);
    const saved = await post({ action: 'new', name: 'a', description: 'Does a.' });
    expect(saved.status).toBe(200);
    const stale = await post({
      action: 'delete',
      path: '.claude/skills/a/SKILL.md',
      version: 'v0',
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: '.claude/skills/a/SKILL.md changed since you opened it',
    });
    expect((await post({ action: 'move' })).status).toBe(400);
    expect((await post({ action: 'link' }, { 'x-symbiote': '' })).status).toBe(403);
    expect(asked).toEqual([
      { action: 'new', name: 'a', description: 'Does a.' },
      { action: 'delete', path: '.claude/skills/a/SKILL.md', version: 'v0' },
    ]);
  });
});

describe('symbiote view: the Monitor page (RM1)', () => {
  const viewer = tempDir();
  const C = 'c'.repeat(40);
  const map: CodeMap = {
    version: 1,
    commit: C,
    branch: 'main',
    files: [
      {
        path: 'src/a.ts',
        kind: 'source',
        language: 'TypeScript',
        lines: 3,
        code: 2,
        comments: 0,
        blank: 1,
      },
    ],
  };
  let read: () => Promise<CodeMap> = () => Promise.resolve(map);
  const opened: OpenRequest[] = [];
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
        monitor: { map: () => read() },
      },
      open: (request) => {
        opened.push(request);
        return Promise.resolve({ opened: true, line: 1, how: 'exact', moved: false });
      },
    });
  });
  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
  });
  const open = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(new URL('/api/monitor/open', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', ...headers },
      body: JSON.stringify(body),
    });

  it("serves the page and the checkout's map", async () => {
    expect(await (await fetch(new URL('/monitor', server.url))).text()).toContain('viewer');
    const response = await fetch(new URL('/api/monitor', server.url));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(map);
    const post = await fetch(new URL('/api/monitor', server.url), {
      method: 'POST',
      headers: { 'x-symbiote': '1' },
    });
    expect(post.status).toBe(405);
  });

  it('says why there is no map, in its words', async () => {
    read = () =>
      Promise.reject(new SymbioteError('no commit to read at HEAD: commit something first'));
    try {
      const response = await fetch(new URL('/api/monitor', server.url));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'no commit to read at HEAD: commit something first',
      });
    } finally {
      read = () => Promise.resolve(map);
    }
  });

  it('opens a file of the map at the commit read, and nothing else', async () => {
    expect((await open({ path: 'src/a.ts' })).status).toBe(200);
    expect(opened).toEqual([{ sha: C, file: 'src/a.ts', line: 1, column: 1 }]);
    expect((await open({ path: '../etc/passwd' })).status).toBe(400);
    expect((await open({ path: 'src/b.ts' })).status).toBe(400);
    expect((await open({ path: 'src/a.ts' }, { 'x-symbiote': '' })).status).toBe(403);
    expect(opened).toHaveLength(1);
  });
});

describe('symbiote view: usage (V29c)', () => {
  const viewer = tempDir();
  const C = 'c'.repeat(40);
  const report: UsageReport = {
    subscriptions: [
      {
        agent: 'claude',
        plan: 'Pro',
        windows: [{ minutes: 300, usedPercent: 59 }],
        at: '2026-10-20T16:15:00.000Z',
        source: 'live',
      },
    ],
  };
  let asked = 0;
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
        usage: {
          report: () => {
            asked += 1;
            return Promise.resolve(report);
          },
          settled: () => Promise.resolve(),
        },
      },
    });
  });
  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
  });

  it('answers GET /api/usage, never kept by the browser, and nothing else', async () => {
    const response = await fetch(new URL('/api/usage', server.url));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(report);
    const post = await fetch(new URL('/api/usage', server.url), {
      method: 'POST',
      headers: { 'x-symbiote': '1' },
    });
    expect(post.status).toBe(405);
    expect(asked).toBe(1);
  });
});

describe('/api/intro (V39)', () => {
  const viewer = tempDir();
  const C = 'c'.repeat(40);
  const servers: ViewServer[] = [];
  let seen = false;
  const intro = {
    seen: () => Promise.resolve(seen),
    markSeen: () => {
      seen = true;
      return Promise.resolve();
    },
  };
  const repository = {
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
  };
  beforeAll(() => writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>'));
  afterAll(async () => {
    for (const server of servers) await server.close();
    rmSync(viewer, { recursive: true, force: true });
  });
  const start = async (options: Partial<Parameters<typeof startViewServer>[0]>) => {
    const server = await startViewServer({ viewerDir: viewer, ...options });
    servers.push(server);
    return server;
  };
  const mark = (server: ViewServer, headers: Record<string, string> = {}) =>
    fetch(new URL('/api/intro', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', ...headers },
      body: '{}',
    });

  for (const mode of ['symbiote view', 'symbiote pr'] as const) {
    it(`${mode}: answers whether to show it, and records it seen`, async () => {
      seen = false;
      const server = await start(
        mode === 'symbiote view'
          ? { repository, intro }
          : { graph, readSource: () => Promise.resolve(''), intro },
      );
      const first = await fetch(new URL('/api/intro', server.url));
      expect(first.status).toBe(200);
      expect(first.headers.get('cache-control')).toBe('no-store');
      expect(await first.json()).toEqual({ show: true });
      expect((await mark(server)).status).toBe(204);
      expect(seen).toBe(true);
      expect(await (await fetch(new URL('/api/intro', server.url))).json()).toEqual({
        show: false,
      });
    });
  }

  it('refuses writes other sites could send, and other methods', async () => {
    seen = false;
    const server = await start({ repository, intro });
    expect((await mark(server, { origin: 'https://attacker.example' })).status).toBe(403);
    expect((await mark(server, { 'x-symbiote': '' })).status).toBe(403);
    expect((await mark(server, { 'content-type': 'text/plain' })).status).toBe(403);
    const put = await fetch(new URL('/api/intro', server.url), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
    });
    expect(put.status).toBe(405);
    expect(seen).toBe(false);
  });

  it('a record it cannot write: 500, and still unseen', async () => {
    const server = await start({
      repository,
      intro: {
        seen: () => Promise.resolve(false),
        markSeen: () => Promise.reject(new Error('EACCES')),
      },
    });
    expect((await mark(server)).status).toBe(500);
  });

  it('is not there without a record', async () => {
    const server = await start({ repository });
    expect((await fetch(new URL('/api/intro', server.url))).status).toBe(404);
  });

  it('serves WebP images as images', async () => {
    mkdirSync(join(viewer, 'assets'), { recursive: true });
    writeFileSync(join(viewer, 'assets', 'koi.webp'), 'RIFF');
    const server = await start({ repository });
    const response = await fetch(new URL('/assets/koi.webp', server.url));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
  });
});

describe('symbiote view: terminals (V21)', () => {
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
  const images = join(viewer, 'images');
  // A worktree with a file, for the paths its agent prints (V38).
  const work = join(viewer, 'work');
  mkdirSync(join(work, 'src'), { recursive: true });
  writeFileSync(join(work, 'src', 'a.ts'), 'export {};\n');
  const editor: { opened: [string, unknown][]; fails: string | null } = { opened: [], fails: null };
  const terminals = makeTerminals({
    pty: () => Promise.resolve({ spawn }),
    images,
    openFolder: (folder, at) => {
      editor.opened.push([folder, at]);
      return Promise.resolve(
        editor.fails === null ? { opened: true } : { opened: false, message: editor.fails },
      );
    },
  });
  const asked: { branch: string; cols: number; rows: number }[] = [];
  const cwds: Record<string, string> = { 'feature/csv': '/w', 'feature/files': work };
  /** The shells opened (V45), by branch. */
  const shells: Record<string, string[]> = {};
  const workspaces = {
    terminal: (request: { branch: string; cols: number; rows: number }) => {
      asked.push(request);
      const cwd = cwds[request.branch];
      if (!cwd) {
        return Promise.reject(new WorkspaceRefused('its agent has no session to open', 409));
      }
      return terminals
        .open({ command: 'claude', args: ['attach', 's1'], cwd, env: {}, ...request })
        .then((id) => ({ id }));
    },
    shell: async ({ branch, ...size }: { branch: string; cols: number; rows: number }) => {
      asked.push({ branch, ...size });
      const cwd = cwds[branch];
      if (!cwd) throw new WorkspaceRefused('no workspace feature/x', 404);
      const id = await terminals.open({
        command: '/bin/sh',
        args: [],
        cwd,
        env: {},
        kept: true,
        ...size,
      });
      (shells[branch] ??= []).push(id);
      return { id, number: shells[branch].length };
    },
    shells: (branch: string) => {
      if (!cwds[branch]) return Promise.reject(new WorkspaceRefused('no workspace feature/x', 404));
      return Promise.resolve({
        shells: (shells[branch] ?? []).map((id, i) => ({ id, number: i + 1 })),
      });
    },
  } as unknown as Workspaces;
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
        workspaces,
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
      headers: { 'content-type': 'application/json', 'x-symbiote': '1', ...headers },
      body: JSON.stringify(body),
    });
  const open = async (branch = 'feature/csv') => {
    const response = await post('/api/workspaces/terminal', { branch, cols: 100, rows: 30 });
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

  it("opens a terminal on a workspace's agent session; refusals keep their status and words", async () => {
    const id = await open();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(asked.at(-1)).toEqual({ branch: 'feature/csv', cols: 100, rows: 30 });
    expect(made.at(-1)?.args).toEqual(['attach', 's1']);

    const none = await post('/api/workspaces/terminal', { branch: 'x', cols: 80, rows: 24 });
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
      expect((await post('/api/workspaces/terminal', body)).status, JSON.stringify(body)).toBe(400);
    }
    // Only the page itself starts a process.
    const body = { branch: 'feature/csv', cols: 80, rows: 24 };
    expect((await post('/api/workspaces/terminal', body, { 'x-symbiote': '' })).status).toBe(403);
    const attacker = { origin: 'https://attacker.example' };
    expect((await post('/api/workspaces/terminal', body, attacker)).status).toBe(403);
    expect(asked.length).toBe(before);
  });

  it('opens a shell in a workspace and lists its shells, for the page only (V45)', async () => {
    const opened = await post('/api/workspaces/shell', {
      branch: 'feature/files',
      cols: 100,
      rows: 30,
    });
    expect(opened.status).toBe(200);
    const { id, number } = (await opened.json()) as { id: string; number: number };
    expect(number).toBe(1);
    expect(asked.at(-1)).toEqual({ branch: 'feature/files', cols: 100, rows: 30 });
    // Its terminal is one as any other: keys in.
    expect((await post(`/api/terminals/${id}/in`, { data: 'ls\r' })).status).toBe(204);
    expect(made.at(-1)?.written).toEqual(['ls\r']);

    const list = (query: string, headers: Record<string, string> = {}) =>
      fetch(new URL(`/api/workspaces/shells${query}`, server.url), {
        headers: { 'x-symbiote': '1', ...headers },
      });
    const listed = await list('?branch=feature/files');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ shells: [{ id, number: 1 }] });
    // It hands out terminals' IDs, which read and drive them: not to another site, nor to a
    // read without the page's header.
    expect((await list('?branch=feature/files', { 'x-symbiote': '' })).status).toBe(403);
    const attacker = { origin: 'https://attacker.example' };
    expect((await list('?branch=feature/files', attacker)).status).toBe(403);
    expect((await list('')).status).toBe(400);
    expect((await list('?branch=nope')).status).toBe(404);

    const before = asked.length;
    for (const body of [
      { branch: 'feature/files' },
      { branch: 'feature/files', cols: 0, rows: 24 },
      { cols: 80, rows: 24 },
    ]) {
      expect((await post('/api/workspaces/shell', body)).status, JSON.stringify(body)).toBe(400);
    }
    const body = { branch: 'feature/files', cols: 80, rows: 24 };
    expect((await post('/api/workspaces/shell', body, { 'x-symbiote': '' })).status).toBe(403);
    expect((await post('/api/workspaces/shell', body, attacker)).status).toBe(403);
    expect(asked.length).toBe(before);
    const gone = await post('/api/workspaces/shell', { ...body, branch: 'nope' });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: 'no workspace feature/x' });
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
    expect(
      (await post(`/api/terminals/${id}/in`, { data: 'x' }, { 'x-symbiote': '' })).status,
    ).toBe(403);
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

  it('saves an image for the agent to attach, and answers with its path to paste (V36)', async () => {
    const id = await open();
    const pty = made.at(-1)!;
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('pixels')]);
    const data = png.toString('base64');
    const response = await post(`/api/terminals/${id}/image`, { data });
    expect(response.status).toBe(200);
    const saved = (await response.json()) as { path: string; text: string };
    expect(saved.path.startsWith(join(images, ''))).toBe(true);
    expect(saved.path).toMatch(/[0-9a-f]{32}\.png$/);
    expect(saved.text).toBe(saved.path);
    expect(readFileSync(saved.path)).toEqual(png);
    // Nothing typed: the page pastes the path, bracketed as the agent asked.
    expect(pty.written).toEqual([]);

    for (const body of [{}, { data: 3 }, { data: '' }, { data: btoa('<svg></svg>') }]) {
      const refused = await post(`/api/terminals/${id}/image`, body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
    }
    // Over 20 MB: refused before it is read.
    const big = await post(`/api/terminals/${id}/image`, { data: 'A'.repeat(28 << 20) });
    expect(big.status).toBe(413);
    expect(await big.text()).toBe('an image of at most 20 MB');
    expect((await post(`/api/terminals/${id}/image`, { data }, { 'x-symbiote': '' })).status).toBe(
      403,
    );
    const attacker = { origin: 'https://attacker.example' };
    expect((await post(`/api/terminals/${id}/image`, { data }, attacker)).status).toBe(403);
    expect((await post('/api/terminals/nope/image', { data })).status).toBe(404);
    expect((await fetch(new URL(`/api/terminals/${id}/image`, server.url))).status).toBe(405);
    expect(readdirSync(images)).toHaveLength(1);
  });

  it('answers which printed paths are files in its folder, and opens one in the editor (V38)', async () => {
    const id = await open('feature/files');
    const asked = await post(`/api/terminals/${id}/paths`, {
      paths: ['src/a.ts', 'missing.ts', '../x.ts', 'src'],
    });
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual({ files: ['src/a.ts'] });
    const opened = await post(`/api/terminals/${id}/open`, {
      path: 'src/a.ts',
      line: 3,
      column: 2,
    });
    expect(opened.status).toBe(204);
    expect(editor.opened).toEqual([[work, { file: 'src/a.ts', line: 3, column: 2 }]]);

    for (const [path, body] of [
      ['paths', {}],
      ['paths', { paths: 'src/a.ts' }],
      ['paths', { paths: [3] }],
      ['paths', { paths: Array<string>(51).fill('a') }],
      ['paths', { paths: ['x'.repeat(1025)] }],
      ['open', {}],
      ['open', { path: '' }],
      ['open', { path: 'src/a.ts', line: 0 }],
      ['open', { path: 'src/a.ts', column: 1.5 }],
    ] as const) {
      expect((await post(`/api/terminals/${id}/${path}`, body)).status, JSON.stringify(body)).toBe(
        400,
      );
    }
    const outside = await post(`/api/terminals/${id}/open`, { path: '../x.ts' });
    expect([outside.status, await outside.text()]).toEqual([400, `../x.ts is not in ${work}`]);
    const missing = await post(`/api/terminals/${id}/open`, { path: 'src' });
    expect([missing.status, await missing.text()]).toEqual([409, 'src is not a file']);
    editor.fails = 'code exited with 1';
    const failed = await post(`/api/terminals/${id}/open`, { path: 'src/a.ts' });
    expect([failed.status, await failed.text()]).toEqual([502, 'code exited with 1']);
    editor.fails = null;
    expect(editor.opened).toHaveLength(2);

    const attacker = { origin: 'https://attacker.example' };
    for (const path of ['paths', 'open']) {
      const body = { paths: ['src/a.ts'], path: 'src/a.ts' };
      expect((await post(`/api/terminals/${id}/${path}`, body, { 'x-symbiote': '' })).status).toBe(
        403,
      );
      expect((await post(`/api/terminals/${id}/${path}`, body, attacker)).status).toBe(403);
      expect((await post(`/api/terminals/nope/${path}`, body)).status).toBe(404);
      expect((await fetch(new URL(`/api/terminals/${id}/${path}`, server.url))).status).toBe(405);
    }
    expect(editor.opened).toHaveLength(2);
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
        workspaces,
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
