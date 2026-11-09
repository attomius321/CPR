// The view server's routes as a table (refactor/cli-services): a GET and a page's POST for each
// address `startViewServer` answers, and some it does not, with every service a fake that answers
// with its method's name, and with none. Each answer's status and first words are kept in a file
// snapshot: a route lost or moved to another service in a refactor changes the table.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Graph } from '@symbiote/core';
import { afterAll, describe, expect, it } from 'vitest';
import type { HiveRecord } from '../src/hive.js';
import { startViewServer, type RepositoryOptions, type ViewServerOptions } from '../src/server.js';

const SHA = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const viewer = mkdtempSync(join(tmpdir(), 'symbiote-routes-'));
writeFileSync(join(viewer, 'index.html'), '<!doctype html><title>viewer</title>');
afterAll(() => rmSync(viewer, { recursive: true, force: true }));

/**
 * A service whose every method answers `{ fake: <its name> }`, except those `given`. Never a
 * promise itself, nor JSON's: `then` and `toJSON` are absent.
 */
function fake<T>(given: Record<string, unknown> = {}): T {
  return new Proxy(given, {
    get(target, key) {
      if (typeof key === 'symbol' || key === 'then' || key === 'toJSON') return undefined;
      if (key in target) return target[key];
      return () => Promise.resolve({ fake: key });
    },
  }) as T;
}

/** An activity taken out, as a file to save. */
const EXPORTED = { text: '# Activity', name: 'activity.md', type: 'text/markdown; charset=utf-8' };

const hive = (): HiveRecord => ({
  on: () => Promise.resolve(false),
  set: () => Promise.resolve(),
  since: () => Promise.resolve(undefined),
});

/** Every service `symbiote view` may be given; their answers only name the method called. */
function everything(): ViewServerOptions {
  const repository: RepositoryOptions = {
    name: 'routes',
    history: fake(),
    status: () => Promise.resolve(fake({ fake: 'status' })),
    refs: () => Promise.resolve({ branches: [], remotes: [], tags: [] }),
    checkout: () => Promise.resolve(fake({ fake: 'checkout' })),
    isCommit: () => Promise.resolve(true),
    diffs: fake({ status: () => undefined, start: () => undefined, findings: () => [] }),
    readFile: () => Promise.resolve('text'),
    files: fake({ diff: () => Promise.resolve('a diff') }),
    git: fake({
      hidden: () => Promise.resolve([]),
      commitFile: () => Promise.resolve('a diff'),
      changeFile: () => Promise.resolve('a diff'),
    }),
    state: () => fake(),
    reviews: fake({ resolve: () => Promise.reject(new Error('not resolved here')) }),
    workspaces: fake({
      list: () => Promise.resolve({ workspaces: [] }),
      exportActivity: () => Promise.resolve(EXPORTED),
    }),
    terminals: fake({
      listen: () => undefined,
      write: () => false,
      resize: () => false,
      close: () => false,
      closeAll: () => undefined,
      running: () => undefined,
      image: () => Promise.resolve(undefined),
      files: () => Promise.resolve(undefined),
    }),
    merges: fake({ log: () => Promise.resolve(null) }),
    hiveWorkspace: fake({ log: () => Promise.resolve(null) }),
    day: fake(),
    settings: fake(),
    checks: fake(),
    nucleus: fake({
      close: () => Promise.resolve(),
      exportActivity: () => Promise.resolve(EXPORTED),
    }),
    skills: fake(),
    scribe: fake({
      close: () => Promise.resolve(),
      exportActivity: () => Promise.resolve(EXPORTED),
    }),
    monitor: fake(),
    issues: fake(),
    usage: fake(),
  };
  return {
    viewerDir: viewer,
    repository,
    open: () => Promise.resolve({ opened: true, line: 1, how: 'diff', moved: false }) as never,
    intro: fake({ seen: () => Promise.resolve(false), markSeen: () => Promise.resolve() }),
    hive: hive(),
    hiveCheck: () => Promise.resolve(null),
    nucleusStart: hive(),
    hiveReviewer: fake(),
    hiveLanding: fake(),
    hivePacing: fake(),
    version: '0.0.0-routes',
  };
}

/** `symbiote view` with only what it must have. */
function bare(): ViewServerOptions {
  return {
    viewerDir: viewer,
    repository: {
      history: fake(),
      status: () => Promise.resolve(fake({ fake: 'status' })),
      refs: () => Promise.resolve({ branches: [], remotes: [], tags: [] }),
      checkout: () => Promise.resolve(fake({ fake: 'checkout' })),
      isCommit: () => Promise.resolve(true),
      diffs: fake({ status: () => undefined, start: () => undefined, findings: () => [] }),
      readFile: () => Promise.resolve('text'),
    },
  };
}

const graph = JSON.parse(
  readFileSync(
    new URL('../../core/test/__snapshots__/graph-callers.json', import.meta.url),
    'utf8',
  ),
) as Graph;
const changed = graph.files[0]?.path ?? '';

/** `symbiote pr`: one graph at `/`, its sources, a review to post, its state and files. */
function onePr(): ViewServerOptions {
  return {
    viewerDir: viewer,
    graph,
    readSource: () => Promise.resolve('text'),
    review: { forge: 'github', submit: () => Promise.resolve({ url: 'https://example.test/1' }) },
    state: fake(),
    files: fake({ diff: () => Promise.resolve('a diff') }),
    open: () => Promise.resolve({ opened: true, line: 1, how: 'diff', moved: false }) as never,
  };
}

const GIT = [
  'commit',
  'commit/lines',
  'commit/file',
  'changes',
  'changes/lines',
  'changes/file',
  'sync',
  'stashes',
  'hidden',
  'leaving',
  'file/history',
  'file/blame',
  'find',
  'open',
  'stage',
  'push',
  'nope',
];
const PAGE_AGENT = [
  '',
  '/ask',
  '/open',
  '/new',
  '/terminal',
  '/activity',
  '/activity/export',
  '/efforts',
  '/effort',
  '/model',
  '/nope',
];

/** Every address the server answers, and some under its prefixes that it does not. */
const PATHS = [
  '/',
  '/index.html',
  '/assets/none.js',
  '/%E0%A4%A',
  '/api/capabilities',
  '/api/graph',
  `/api/source?side=head&file=${changed}`,
  '/api/source?side=head&file=none.ts',
  '/api/files',
  `/api/file?path=${changed}`,
  '/api/file?path=none.ts',
  '/api/review',
  '/api/merge',
  '/api/state/review',
  '/api/state/nope',
  '/api/open',
  '/api/nope',
  '/api/logs',
  '/api/events',
  '/api/events/ping',
  '/api/events/listen',
  '/api/intro',
  '/api/hive',
  '/api/hive/state',
  '/api/hive/landing',
  '/api/hive/pacing',
  '/api/hive/reviewer/efforts',
  '/api/hive/reviewer/effort',
  '/api/hive/reviewer/model',
  `/diff/${SHA}..${HEAD}`,
  `/diff/${SHA}..${HEAD}/`,
  `/diff/${SHA}..${HEAD}/api/graph`,
  `/diff/${SHA}..${HEAD}/api/files`,
  `/diff/${SHA}..${HEAD}/api/capabilities`,
  '/review/fix%2Fa',
  '/review/fix%2Fa/api/graph',
  '/review/%E0%A4%A/',
  '/api/reviews',
  '/git',
  '/history',
  '/overview',
  '/api/history?scope=all&from=0&to=10',
  '/api/history?scope=none',
  '/api/history/shape?scope=all&version=v1',
  '/api/history/refs?scope=all&version=v1',
  `/api/history/rows?scope=all&version=v1&sha=${SHA}`,
  ...GIT.map((name) => `/api/git/${name}?sha=${SHA}&path=a.ts&scope=all&version=v1&q=x`),
  '/api/git/commit',
  '/api/status',
  '/api/refs',
  '/api/checkout',
  '/api/workspaces/findings',
  '/api/diffs',
  '/api/diffs/stop',
  '/api/mcp',
  '/api/mcp/asks',
  '/api/mcp/answer',
  '/api/mcp/nope',
  '/api/nucleus/start-confirm',
  '/workspaces',
  '/features',
  '/start',
  '/workspace-history',
  '/api/workspaces/day?since=2026-11-09T00:00:00.000Z',
  '/api/workspaces/day?since=never',
  '/api/workspaces/hive?branch=fix%2Fa',
  '/api/workspaces/hive/test?branch=fix%2Fa&round=1&path=a.test.ts',
  '/api/workspaces/hive/log?branch=fix%2Fa&log=check-1&from=0',
  '/api/workspaces/hive/log',
  '/api/workspaces/hive/nope',
  '/api/workspaces',
  '/api/workspaces/options',
  '/api/workspaces/history',
  '/api/workspaces/history?branch=fix%2Fa',
  '/api/workspaces/draft',
  '/api/workspaces/documents',
  '/api/workspaces/suggest',
  '/api/workspaces/advisor/claude/efforts',
  '/api/workspaces/advisor/codex/effort',
  '/api/workspaces/advisor/claude/model',
  '/api/workspaces/check?at=main',
  '/api/workspaces/check',
  '/api/workspaces/start',
  '/api/workspaces/stop',
  '/api/workspaces/open',
  '/api/workspaces/diff',
  '/api/workspaces/changes?branch=fix%2Fa',
  '/api/workspaces/changes',
  '/api/workspaces/prompt?branch=fix%2Fa',
  '/api/workspaces/merge?branch=fix%2Fa',
  '/api/workspaces/against?branch=fix%2Fa',
  '/api/workspaces/thread?branch=fix%2Fa',
  '/api/workspaces/activity?branch=fix%2Fa',
  '/api/workspaces/activity/export?branch=fix%2Fa',
  '/api/workspaces/activity/export?branch=fix%2Fa&format=pdf',
  '/api/workspaces/activity/export',
  '/api/workspaces/reply',
  '/api/workspaces/sent',
  '/api/workspaces/clean',
  '/api/workspaces/terminal',
  '/api/workspaces/shell',
  '/api/workspaces/shells?branch=fix%2Fa',
  '/api/workspaces/nope',
  '/nucleus',
  '/scout',
  ...PAGE_AGENT.map((path) => `/api/nucleus${path}`),
  '/api/nucleus/activity/export?format=pdf',
  ...PAGE_AGENT.map((path) => `/api/scribe${path}`),
  '/skills',
  '/api/skills',
  '/api/skills/open',
  '/api/skills/library?folder=%2Ftmp',
  '/api/skills/library',
  '/monitor',
  '/api/monitor',
  '/api/monitor/open',
  '/issues',
  '/api/issues',
  '/api/issues?state=closed&cursor=nope',
  '/api/issues/12',
  '/api/usage',
  '/settings',
  '/api/settings/prompts',
  '/api/settings/checks',
  '/api/merges',
  '/api/merges/targets?branch=fix%2Fa',
  '/api/merges/log?id=m1&from=0',
  '/api/merges/log',
  '/api/merges/efforts',
  '/api/merges/effort',
  '/api/merges/model',
  '/api/merges/approve',
  '/api/merges/recheck',
  '/api/merges/send',
  '/api/merges/merge-commit',
  '/api/merges/request-changes',
  '/api/merges/land',
  '/api/merges/retry',
  '/api/merges/remove',
  '/api/merges/nope',
  '/api/terminals/abc123',
  '/api/terminals/abc123/in',
  '/api/terminals/abc123/resize',
  '/api/terminals/abc123/close',
  '/api/terminals/abc123/image',
  '/api/terminals/abc123/paths',
  '/api/terminals/abc123/open',
  '/api/terminals/abc123/nope',
];

/** A page's write: JSON, the custom header, from its own origin. */
const WRITE = { 'content-type': 'application/json', 'x-symbiote': '1' };

/** One request's line in the table: its status, and its body's first words or its stream's type. */
function ask(
  base: string,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, base), { method, headers }, (res) => {
      const head = `${method} ${path} → ${res.statusCode}`;
      if (isStream(res.headers)) {
        resolve(`${head} ${res.headers['content-type']}`);
        res.destroy();
        req.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8').replace(/\s+/g, ' ');
        const where = res.headers.location ? ` → ${res.headers.location}` : '';
        resolve(`${head}${where} ${text.slice(0, 100)}`.trimEnd());
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

const isStream = (headers: IncomingHttpHeaders) =>
  headers['content-type']?.startsWith('text/event-stream') === true;

/** The table of one server: each path asked with GET, then POSTed as a page's write. */
async function table(options: ViewServerOptions): Promise<string> {
  const server = await startViewServer(options);
  try {
    const lines: string[] = [];
    for (const path of PATHS) lines.push(await ask(server.url, 'GET', path));
    for (const path of PATHS) lines.push(await ask(server.url, 'POST', path, WRITE, '{}'));
    lines.push(await ask(server.url, 'PUT', '/api/state/review', WRITE, '{}'));
    lines.push(await ask(server.url, 'PUT', `/diff/${SHA}..${HEAD}/api/state/review`, WRITE, '{}'));
    // Refused before any route: another host, another site's request, a write without the header.
    lines.push(await ask(server.url, 'GET', '/api/status', { host: 'evil.test' }));
    lines.push(
      await ask(server.url, 'GET', '/api/status', {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
      }),
    );
    lines.push(await ask(server.url, 'POST', '/api/workspaces/stop', {}, '{}'));
    lines.push(
      await ask(server.url, 'POST', '/api/workspaces/stop', {
        ...WRITE,
        origin: 'http://evil.test',
      }),
    );
    return lines.join('\n') + '\n';
  } finally {
    await server.close();
  }
}

describe("the view server's routes (refactor/cli-services)", () => {
  // Some 1,100 requests a server, one at a time.
  it('answers each address as before, with every service', { timeout: 60_000 }, async () => {
    await expect(await table(everything())).toMatchFileSnapshot(
      '__snapshots__/server-routes-everything.txt',
    );
  });

  it(
    'answers each address as before, with only what symbiote view must have',
    { timeout: 60_000 },
    async () => {
      await expect(await table(bare())).toMatchFileSnapshot('__snapshots__/server-routes-bare.txt');
    },
  );

  it(
    'answers each address as before, serving one graph (symbiote pr)',
    { timeout: 60_000 },
    async () => {
      await expect(await table(onePr())).toMatchFileSnapshot('__snapshots__/server-routes-pr.txt');
    },
  );
});
