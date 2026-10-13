import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { HISTORY_SCOPES, type Graph, type HistoryScope } from '@cpr/core';
import type { Review, ReviewComment, ReviewEvent } from '@cpr/forge';
import { pairKey, type Diffs, type Pair } from './diffs.js';
import type { Histories } from './history.js';

export type Side = 'base' | 'head';

/** What the viewer keeps between sessions: reviewed marks and draft comments. */
export type StateName = 'review' | 'drafts';
const STATE_NAMES: readonly StateName[] = ['review', 'drafts'];

export interface StateStore {
  /** The saved value, or null. */
  read(name: StateName): Promise<unknown>;
  write(name: StateName, value: unknown): Promise<void>;
}

/** Posts reviews to the change request being viewed (`cpr pr` only). */
export interface ReviewTarget {
  forge: 'github' | 'gitlab';
  submit(review: Review): Promise<{ url: string }>;
}

/** `cpr view`: the repository's commits, and the diffs between them picked in the viewer. */
export interface RepositoryOptions {
  /** The commits page's history: rows and their details, its shape (`GET /api/history…`). */
  history: Histories;
  /** Whether a full SHA is a commit of the repository (`POST /api/diffs`). */
  isCommit(sha: string): Promise<boolean>;
  /** Analyzed and asked for, each served under `/diff/<base>..<head>/`. */
  diffs: Diffs;
  /** A repo-relative file at a commit. */
  readFile(sha: string, path: string): Promise<string>;
  /** Where a diff's review state is kept; without it the viewer keeps state in the browser. */
  state?: (graph: Graph) => StateStore;
}

export interface ViewServerOptions {
  /** The graph served at `/` (`cpr pr`). */
  graph?: Graph;
  /** Folder with the built viewer (index.html, assets/). */
  viewerDir: string;
  /** Reads a repo-relative file on one side of `graph`'s change. */
  readSource?: (side: Side, path: string) => Promise<string>;
  /** Default: a free port. */
  port?: number;
  /** Enables `POST /api/review`. */
  review?: ReviewTarget;
  /** Enables `/api/state/<name>`; without it the viewer keeps state in the browser. */
  state?: StateStore;
  /** Enables the commits page at `/` and diffs under `/diff/<base>..<head>/`. */
  repository?: RepositoryOptions;
}

/** A graph served with its sources, review state and reviews. */
interface Site {
  graph: Graph;
  allowed: Record<Side, Set<string>>;
  readSource: (side: Side, path: string) => Promise<string>;
  state?: StateStore | undefined;
  review?: ReviewTarget | undefined;
}

export interface ViewServer {
  url: string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** Largest review or state the viewer may send. */
const MAX_BODY_BYTES = 1 << 20;
const EVENTS: readonly ReviewEvent[] = ['comment', 'approve', 'request-changes'];
/** Rows of the history the viewer may ask for at once. */
const MAX_HISTORY_ROWS = 500;
const SHA = '[0-9a-f]{40}(?:[0-9a-f]{24})?';
const FULL_SHA = new RegExp(`^${SHA}$`);
/** `/diff/<base>..<head>` and what follows: the viewer's own files and API, for that diff. */
const DIFF_PATH = new RegExp(`^/diff/(${SHA})\\.\\.(${SHA})(/.*)?$`);

/**
 * Serves the viewer, `/api/graph` and `/api/source` on localhost only: one graph at `/`
 * (`cpr pr`), or (`cpr view`) the commits page at `/` and each diff under its own path, where
 * the viewer's relative URLs reach that diff's API. Sources are limited to files a graph
 * mentions, so the server never exposes anything else from the machine. Requests must name the
 * server itself as host, which defeats DNS rebinding; writes (a review, saved state, starting
 * or stopping an analysis) also need a same-origin JSON request with a custom header, which
 * other sites cannot send.
 */
export async function startViewServer(options: ViewServerOptions): Promise<ViewServer> {
  const { repository } = options;
  const root: Site | undefined =
    options.graph && options.readSource
      ? {
          graph: options.graph,
          allowed: sourceFiles(options.graph),
          readSource: options.readSource,
          state: options.state,
          review: options.review,
        }
      : undefined;
  // One site per diff graph, made once: `allowed` walks the whole graph.
  const sites = new WeakMap<Graph, Site>();
  let hosts: Set<string> = new Set();
  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => send(res, 500, String(error)));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hosts.has(req.headers.host ?? '')) return send(res, 421, 'unknown host');
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (repository) {
      const diff = DIFF_PATH.exec(url.pathname);
      if (diff) {
        const [, base = '', head = '', rest] = diff;
        // Relative URLs in the viewer need the trailing slash.
        if (rest === undefined) return redirect(res, `${url.pathname}/${url.search}`);
        return serveDiff(req, res, url, rest, repository, { base, head });
      }
      if (url.pathname === '/api/history') return historyRows(req, res, url, repository);
      if (url.pathname === '/api/history/shape') return historyShape(req, res, url, repository);
      if (url.pathname === '/api/diffs') return startDiff(req, res, repository);
      if (url.pathname === '/api/diffs/stop') return stopDiff(req, res, repository);
    }
    return serveSite(req, res, url, url.pathname, root);
  }

  /** The viewer and its API for one graph (or none: the commits page). */
  async function serveSite(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    path: string,
    site: Site | undefined,
    diff = false,
  ): Promise<void> {
    if (path === '/api/review') return postReview(req, res, site);
    if (path.startsWith('/api/state/')) {
      return state(req, res, site, path.slice('/api/state/'.length));
    }
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');

    if (path === '/api/capabilities') {
      const capabilities = {
        sources: site !== undefined || diff,
        review: site?.review ? { forge: site.review.forge } : null,
        state: diff ? repository?.state !== undefined : site?.state !== undefined,
        ...(repository ? { commits: true } : {}),
      };
      return send(res, 200, JSON.stringify(capabilities), TYPES['.json']);
    }
    if (path === '/api/graph') {
      if (!site) return send(res, 404, 'no graph here: pick two commits');
      return send(res, 200, JSON.stringify(site.graph), TYPES['.json']);
    }
    if (path === '/api/source') {
      const side = url.searchParams.get('side');
      const file = url.searchParams.get('file') ?? '';
      if (!site || (side !== 'base' && side !== 'head') || !site.allowed[side].has(file)) {
        return send(res, 404, 'unknown source');
      }
      try {
        return send(res, 200, await site.readSource(side, file), 'text/plain; charset=utf-8');
      } catch {
        return send(res, 404, 'unknown source');
      }
    }
    if (path.startsWith('/api/')) return send(res, 404, 'not found');
    return serveFile(res, path);
  }

  /** Static viewer files; anything outside the viewer folder is refused. */
  async function serveFile(res: ServerResponse, pathname: string): Promise<void> {
    const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '') || 'index.html';
    const path = join(options.viewerDir, relative);
    if (!path.startsWith(options.viewerDir + sep) && path !== options.viewerDir) {
      return send(res, 404, 'not found');
    }
    try {
      const body = await readFile(path);
      return send(res, 200, body, TYPES[extname(path)] ?? 'application/octet-stream');
    } catch {
      return send(res, 404, 'not found');
    }
  }

  /** A diff's page: its graph once analyzed, its progress meanwhile. */
  async function serveDiff(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    path: string,
    repo: RepositoryOptions,
    pair: Pair,
  ): Promise<void> {
    const status = repo.diffs.status(pair);
    if (status?.status === 'done') {
      return serveSite(req, res, url, path, diffSite(repo, status.graph), true);
    }
    if (path === '/api/graph' && req.method === 'GET') {
      if (!status) return json(res, 404, { ...pair, error: 'not analyzed' });
      if (status.status === 'failed') return json(res, 502, { ...pair, error: status.error });
      return json(res, 202, { ...pair, ...status });
    }
    return serveSite(req, res, url, path, undefined, true);
  }

  function diffSite(repo: RepositoryOptions, graph: Graph): Site {
    let site = sites.get(graph);
    if (!site) {
      const shas = { base: graph.revisions.from, head: graph.revisions.head.sha };
      site = {
        graph,
        allowed: sourceFiles(graph),
        readSource: (side, path) => {
          const sha = shas[side];
          return sha ? repo.readFile(sha, path) : Promise.reject(new Error(`no ${side}`));
        },
        state: repo.state?.(graph),
      };
      sites.set(graph, site);
    }
    return site;
  }

  /** Rows of the history with their details: `?scope=all|current&from=<n>&to=<n>&version=…`. */
  async function historyRows(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    repo: RepositoryOptions,
  ): Promise<void> {
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    const scope = historyScope(url);
    if (!scope) return send(res, 400, 'scope: all or current');
    const from = count(url.searchParams.get('from') ?? '0');
    const to = count(url.searchParams.get('to') ?? String((from ?? 0) + 200));
    if (from === null || to === null || to < from || to - from > MAX_HISTORY_ROWS) {
      return send(res, 400, `from, to: counts, at most ${MAX_HISTORY_ROWS} rows apart`);
    }
    const version = url.searchParams.get('version') ?? undefined;
    const page = await repo.history.page(scope, from, to, version);
    if (!page) return send(res, 409, 'the history changed: list it again');
    return json(res, 200, page);
  }

  /** Every row's parents as row numbers, once listed: `?scope=…&version=…`. */
  async function historyShape(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    repo: RepositoryOptions,
  ): Promise<void> {
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    const scope = historyScope(url);
    const version = url.searchParams.get('version');
    if (!scope || !version) return send(res, 400, 'scope and version needed');
    const shape = await repo.history.shape(scope, version);
    if (!shape) return send(res, 409, 'the history changed: list it again');
    return json(res, 200, shape);
  }

  /** Starts analyzing two commits; answers where the diff will be. */
  async function startDiff(
    req: IncomingMessage,
    res: ServerResponse,
    repo: RepositoryOptions,
  ): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let pair: Pair;
    try {
      pair = parsePair(await readBody(req, MAX_BODY_BYTES));
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    if (pair.base === pair.head) return send(res, 400, 'pick two different commits');
    for (const sha of [pair.base, pair.head]) {
      if (!(await repo.isCommit(sha))) return send(res, 400, `not a commit: ${sha}`);
    }
    repo.diffs.start(pair);
    return json(res, 200, { url: `/diff/${pairKey(pair)}/` });
  }

  async function stopDiff(
    req: IncomingMessage,
    res: ServerResponse,
    repo: RepositoryOptions,
  ): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let pair: Pair;
    try {
      pair = parsePair(await readBody(req, MAX_BODY_BYTES));
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    if (!repo.diffs.stop(pair)) return send(res, 404, 'not running');
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
  }

  async function postReview(
    req: IncomingMessage,
    res: ServerResponse,
    site: Site | undefined,
  ): Promise<void> {
    const target = site?.review;
    if (!site || !target) return send(res, 404, 'reviews are posted from cpr pr');
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');

    let review: Review;
    try {
      review = parseReview(await readBody(req, MAX_BODY_BYTES), site.allowed);
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    try {
      return send(res, 200, JSON.stringify(await target.submit(review)), TYPES['.json']);
    } catch (error) {
      // The forge's own words: no access, a line outside the diff, approving one's own PR…
      return send(res, 502, JSON.stringify({ error: (error as Error).message }), TYPES['.json']);
    }
  }

  async function state(
    req: IncomingMessage,
    res: ServerResponse,
    site: Site | undefined,
    name: string,
  ): Promise<void> {
    const store = site?.state;
    if (!store || !STATE_NAMES.includes(name as StateName)) return send(res, 404, 'not found');
    if (req.method === 'GET') {
      return send(res, 200, JSON.stringify(await store.read(name as StateName)), TYPES['.json']);
    }
    if (req.method !== 'PUT') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let value: unknown;
    try {
      value = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    await store.write(name as StateName, value);
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
  }

  /** A write from the viewer itself: JSON, the custom header, and (if sent) our own origin. */
  function writable(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    return (
      req.headers['x-cpr'] === '1' &&
      !!req.headers['content-type']?.startsWith('application/json') &&
      (origin === undefined || hosts.has(origin.replace(/^http:\/\//, '')))
    );
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), TYPES['.json']);
}

/** `?scope=`: every branch when absent; null when unknown. */
function historyScope(url: URL): HistoryScope | null {
  const scope = url.searchParams.get('scope') ?? 'all';
  return HISTORY_SCOPES.includes(scope as HistoryScope) ? (scope as HistoryScope) : null;
}

/** A non-negative integer, or null. */
function count(text: string): number | null {
  const n = Number(text);
  return text !== '' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(308, { location, 'cache-control': 'no-store' });
  res.end();
}

/** `{ base, head }`: two full SHAs. */
function parsePair(text: string): Pair {
  const value = JSON.parse(text) as Partial<Record<keyof Pair, unknown>> | null;
  const { base, head } = value ?? {};
  if (typeof base !== 'string' || !FULL_SHA.test(base)) throw new Error('base: not a full SHA');
  if (typeof head !== 'string' || !FULL_SHA.test(head)) throw new Error('head: not a full SHA');
  return { base, head };
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type = 'text/plain',
): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

/** Repo-relative files per side that the graph refers to. */
export function sourceFiles(graph: Graph): Record<Side, Set<string>> {
  const files: Record<Side, Set<string>> = { base: new Set(), head: new Set() };
  for (const node of graph.nodes) {
    if (node.base) files.base.add(node.base.file);
    if (node.head) files.head.add(node.head.file);
  }
  for (const file of graph.files) {
    if (file.status !== 'added') files.base.add(file.previousPath ?? file.path);
    if (file.status !== 'deleted') files.head.add(file.path);
  }
  return files;
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('review too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Checks a review from the viewer: known event, comments only on files of this change. */
export function parseReview(text: string, allowed: Record<Side, Set<string>>): Review {
  const value = JSON.parse(text) as Partial<Record<keyof Review, unknown>>;
  if (!value || typeof value !== 'object') throw new Error('not a review');
  const { event, body, comments } = value;
  if (!EVENTS.includes(event as ReviewEvent)) throw new Error(`unknown event '${String(event)}'`);
  if (typeof body !== 'string') throw new Error('body must be a string');
  if (!Array.isArray(comments)) throw new Error('comments must be a list');
  return {
    event: event as ReviewEvent,
    body,
    comments: comments.map((raw: unknown, i): ReviewComment => {
      const c = (raw ?? {}) as Partial<Record<keyof ReviewComment, unknown>>;
      const where = `comment ${i + 1}`;
      if (c.side !== 'base' && c.side !== 'head') throw new Error(`${where}: side`);
      const other = c.side === 'head' ? 'base' : 'head';
      if (typeof c.path !== 'string' || !allowed[c.side].has(c.path)) {
        throw new Error(`${where}: ${String(c.path)} is not part of this change`);
      }
      if (
        typeof c.otherPath !== 'string' ||
        !(c.otherPath === c.path || allowed[other].has(c.otherPath))
      ) {
        throw new Error(`${where}: otherPath`);
      }
      if (typeof c.line !== 'number' || !Number.isInteger(c.line) || c.line < 1) {
        throw new Error(`${where}: line`);
      }
      if (typeof c.body !== 'string' || c.body.trim() === '') throw new Error(`${where}: empty`);
      return { side: c.side, path: c.path, otherPath: c.otherPath, line: c.line, body: c.body };
    }),
  };
}
