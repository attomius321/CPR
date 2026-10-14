import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import {
  CheckoutRefused,
  HISTORY_SCOPES,
  UnknownCheckoutTarget,
  type BranchReviewInfo,
  type CheckoutResult,
  type FinishResult,
  type LocalReview,
  type CheckoutTarget,
  type Graph,
  type HistoryScope,
  type RefList,
  type RepoStatus,
} from '@cpr/core';
import type { Review, ReviewComment, ReviewEvent } from '@cpr/forge';
import { pairKey, type Diffs, type Pair } from './diffs.js';
import type { OpenRequest, OpenResult } from './editor.js';
import type { Histories } from './history.js';
import { ReviewRefused, type BranchReviews } from './reviews.js';

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
  /** HEAD, the history's version, local changes and an operation in progress. */
  status(): Promise<RepoStatus>;
  /** Branches, remote branches and tags (`GET /api/refs`). */
  refs(): Promise<RefList>;
  /** Checks out a branch, remote branch, tag or commit (`POST /api/checkout`). */
  checkout(target: CheckoutTarget): Promise<CheckoutResult>;
  /** Whether a full SHA is a commit of the repository (`POST /api/diffs`). */
  isCommit(sha: string): Promise<boolean>;
  /** Analyzed and asked for, each served under `/diff/<base>..<head>/`. */
  diffs: Diffs;
  /** A repo-relative file at a commit. */
  readFile(sha: string, path: string): Promise<string>;
  /** Where a diff's review state is kept; without it the viewer keeps state in the browser. */
  state?: (graph: Graph) => StateStore;
  /** Branch reviews (V15): `/api/reviews`, and each review under `/review/<branch>/`. */
  reviews?: BranchReviews;
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
  /** Enables `POST /api/open`: a file of a graph's change, opened in VS Code. */
  open?: (request: OpenRequest) => Promise<OpenResult>;
}

/** A graph served with its sources, review state and reviews. */
interface Site {
  graph: Graph;
  allowed: Record<Side, Set<string>>;
  readSource: (side: Side, path: string) => Promise<string>;
  state?: StateStore | undefined;
  review?: ReviewTarget | undefined;
  /** A branch review's own end (V16): its verdict recorded, pushed on Approve. */
  finish?: (review: LocalReview) => Promise<FinishResult>;
  pushAgain?: () => Promise<FinishResult>;
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
/** `/review/<branch, URL-encoded>` and what follows: a branch's review, as a diff's page. */
const REVIEW_PATH = /^\/review\/([^/]+)(\/.*)?$/;

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
  // Branch reviews: the one each branch's page shows (resolved when asked for, or opened), and
  // a site per graph and branch, whose state is the branch's review.
  const opened = new Map<string, { info: BranchReviewInfo; pair: Pair }>();
  const reviewSites = new WeakMap<Graph, Map<string, Site>>();
  let hosts: Set<string> = new Set();
  let checkingOut = false;
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
      const review = repository.reviews ? REVIEW_PATH.exec(url.pathname) : null;
      if (review && repository.reviews) {
        const [, encoded = '', rest] = review;
        let branch: string;
        try {
          branch = decodeURIComponent(encoded);
        } catch {
          return send(res, 400, 'not a branch name');
        }
        if (rest === undefined) return redirect(res, `${url.pathname}/${url.search}`);
        return serveReview(req, res, url, rest, repository, repository.reviews, branch);
      }
      if (url.pathname === '/api/reviews' && repository.reviews) {
        return reviewsApi(req, res, repository, repository.reviews);
      }
      if (url.pathname === '/api/history') return historyRows(req, res, url, repository);
      if (url.pathname === '/api/history/shape') return historyShape(req, res, url, repository);
      if (url.pathname === '/api/status') return read(req, res, () => repository.status());
      if (url.pathname === '/api/refs') return read(req, res, () => repository.refs());
      if (url.pathname === '/api/checkout') return checkoutTarget(req, res, repository);
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
    branchReview?: BranchReviewInfo,
  ): Promise<void> {
    if (path === '/api/review') {
      return site?.finish ? finishReview(req, res, site) : postReview(req, res, site);
    }
    if (path === '/api/review/push') return pushAgain(req, res, site);
    if (path.startsWith('/api/state/')) {
      return state(req, res, site, path.slice('/api/state/'.length));
    }
    if (path === '/api/open') return openFile(req, res, site);
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');

    if (path === '/api/capabilities') {
      const capabilities = {
        sources: site !== undefined || diff,
        review: branchReview
          ? { forge: 'local' }
          : site?.review
            ? { forge: site.review.forge }
            : null,
        state: branchReview
          ? true
          : diff
            ? repository?.state !== undefined
            : site?.state !== undefined,
        ...(options.open && (site !== undefined || diff) ? { open: true } : {}),
        ...(repository ? { commits: true } : {}),
        ...(branchReview ? { branchReview } : {}),
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
    review?: { info: BranchReviewInfo; reviews: BranchReviews },
  ): Promise<void> {
    const status = repo.diffs.status(pair);
    if (status?.status === 'done') {
      const site = review
        ? reviewSite(repo, status.graph, review.info, review.reviews)
        : diffSite(repo, status.graph);
      return serveSite(req, res, url, path, site, true, review?.info);
    }
    if (path === '/api/graph' && req.method === 'GET') {
      if (!status) return json(res, 404, { ...pair, error: 'not analyzed' });
      if (status.status === 'failed') return json(res, 502, { ...pair, error: status.error });
      return json(res, 202, { ...pair, ...status });
    }
    return serveSite(req, res, url, path, undefined, true, review?.info);
  }

  /**
   * A branch review's page: the diff from its fork point to its tip, its state the branch's
   * review. Opened anew (a reload, a new `cpr view`), the branch is resolved here.
   */
  async function serveReview(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    path: string,
    repo: RepositoryOptions,
    reviews: BranchReviews,
    branch: string,
  ): Promise<void> {
    let review = opened.get(branch);
    if (!review) {
      try {
        review = await reviews.resolve(branch);
      } catch (error) {
        if (!(error instanceof ReviewRefused)) throw error;
        if (path === '/api/graph') return json(res, 404, { error: error.message });
        return serveSite(req, res, url, path, undefined, true);
      }
      opened.set(branch, review);
      repo.diffs.start(review.pair);
    }
    return serveDiff(req, res, url, path, repo, review.pair, { info: review.info, reviews });
  }

  function reviewSite(
    repo: RepositoryOptions,
    graph: Graph,
    info: BranchReviewInfo,
    reviews: BranchReviews,
  ): Site {
    let byBranch = reviewSites.get(graph);
    if (!byBranch) reviewSites.set(graph, (byBranch = new Map<string, Site>()));
    let site = byBranch.get(info.branch);
    if (!site) {
      const shared = diffSite(repo, graph);
      site = {
        ...shared,
        state: reviews.state(info),
        finish: (review) => reviews.finish(info, review, shared.readSource),
        pushAgain: () => reviews.pushAgain(info),
      };
      byBranch.set(info.branch, site);
    }
    return site;
  }

  /** `GET`: the reviewer's branch reviews. `POST { ref }`: starts one; answers where it is. */
  async function reviewsApi(
    req: IncomingMessage,
    res: ServerResponse,
    repo: RepositoryOptions,
    reviews: BranchReviews,
  ): Promise<void> {
    if (req.method === 'GET') return json(res, 200, await reviews.list());
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let ref: string;
    try {
      ref = parseRef(await readBody(req, MAX_BODY_BYTES));
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    let review: { info: BranchReviewInfo; pair: Pair };
    try {
      review = await reviews.resolve(ref);
    } catch (error) {
      if (error instanceof ReviewRefused) return send(res, 400, error.message);
      throw error;
    }
    opened.set(review.info.branch, review);
    repo.diffs.start(review.pair);
    return json(res, 200, { url: `/review/${encodeURIComponent(review.info.branch)}/` });
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

  /** A GET answered with a value of the repository. */
  async function read(
    req: IncomingMessage,
    res: ServerResponse,
    value: () => Promise<unknown>,
  ): Promise<void> {
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    return json(res, 200, await value());
  }

  /** Checks out what the commits page asks for, one checkout at a time. */
  async function checkoutTarget(
    req: IncomingMessage,
    res: ServerResponse,
    repo: RepositoryOptions,
  ): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let target: CheckoutTarget;
    try {
      target = parseCheckoutTarget(await readBody(req, MAX_BODY_BYTES));
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    if (checkingOut) return json(res, 409, { error: 'a checkout is running' });
    checkingOut = true;
    try {
      return json(res, 200, await repo.checkout(target));
    } catch (error) {
      if (error instanceof UnknownCheckoutTarget) return send(res, 400, error.message);
      if (error instanceof CheckoutRefused) return json(res, 409, { error: error.message });
      throw error;
    } finally {
      checkingOut = false;
    }
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

  /** Finishes a branch review (V16): the verdict, its comments checked against the change. */
  async function finishReview(
    req: IncomingMessage,
    res: ServerResponse,
    site: Site,
  ): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let review: LocalReview;
    try {
      review = parseLocalReview(await readBody(req, MAX_BODY_BYTES), site.graph, site.allowed);
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    const { finish } = site;
    if (!finish) return send(res, 404, 'not a branch review');
    return json(res, 200, await finish(review));
  }

  /** Pushes a branch review's approval again, after git refused it. */
  async function pushAgain(
    req: IncomingMessage,
    res: ServerResponse,
    site: Site | undefined,
  ): Promise<void> {
    if (!site?.pushAgain) return send(res, 404, 'not a branch review');
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    try {
      return json(res, 200, await site.pushAgain());
    } catch (error) {
      if (error instanceof ReviewRefused) return json(res, 409, { error: error.message });
      throw error;
    }
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

  /** Opens a file of the change in VS Code, where that line is in the working copy now. */
  async function openFile(
    req: IncomingMessage,
    res: ServerResponse,
    site: Site | undefined,
  ): Promise<void> {
    const { open } = options;
    if (!open || !site) return send(res, 404, 'files open from cpr view and cpr pr');
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let target: ReturnType<typeof parseOpen>;
    try {
      target = parseOpen(await readBody(req, MAX_BODY_BYTES), site.allowed);
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    const { revisions } = site.graph;
    const sha = target.side === 'base' ? revisions.from : revisions.head.sha;
    if (!sha) return json(res, 404, { error: `no ${target.side} commit to open the file at` });
    const result = await open({ sha, file: target.file, line: target.line, column: target.column });
    if (!result.opened) {
      return json(res, result.reason === 'missing' ? 404 : 502, { error: result.message });
    }
    return json(res, 200, { line: result.line, how: result.how, moved: result.moved });
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

const CHECKOUT_KINDS: readonly CheckoutTarget['kind'][] = ['branch', 'remote', 'tag', 'commit'];

/** `{ kind, name }`, or `{ kind: 'commit', sha }` with a full SHA. */
function parseCheckoutTarget(text: string): CheckoutTarget {
  const value = JSON.parse(text) as { kind?: unknown; name?: unknown; sha?: unknown } | null;
  const kind = value?.kind as CheckoutTarget['kind'];
  if (!CHECKOUT_KINDS.includes(kind)) throw new Error('kind: branch, remote, tag or commit');
  if (kind === 'commit') {
    if (typeof value?.sha !== 'string' || !FULL_SHA.test(value.sha)) {
      throw new Error('sha: not a full SHA');
    }
    return { kind, sha: value.sha };
  }
  const name = value?.name;
  if (typeof name !== 'string' || name === '' || name.length > 255)
    throw new Error('name: a ref name');
  return { kind, name };
}

/** `{ side, file, line, column? }`: a file the graph mentions on that side, 1-based positions. */
function parseOpen(
  text: string,
  allowed: Record<Side, Set<string>>,
): { side: Side; file: string; line: number; column: number } {
  const value = JSON.parse(text) as Record<'side' | 'file' | 'line' | 'column', unknown> | null;
  const { side, file, line, column = 1 } = value ?? {};
  if (side !== 'base' && side !== 'head') throw new Error('side: base or head');
  if (typeof file !== 'string' || !allowed[side].has(file)) {
    throw new Error(`${String(file)} is not part of this change`);
  }
  if (!isPosition(line)) throw new Error('line: a positive integer');
  if (!isPosition(column)) throw new Error('column: a positive integer');
  return { side, file, line, column };
}

function isPosition(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;
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

/**
 * A branch review's verdict from the viewer (V16): the event, the summary, and comments on lines
 * of the change (checked as for a forge) or about one of its symbols.
 */
export function parseLocalReview(
  text: string,
  graph: Graph,
  allowed: Record<Side, Set<string>>,
): LocalReview {
  const value = JSON.parse(text) as Partial<Record<keyof LocalReview, unknown>> | null;
  if (!value || typeof value !== 'object') throw new Error('not a review');
  const { event, body, comments } = value;
  if (!EVENTS.includes(event as ReviewEvent)) throw new Error(`unknown event '${String(event)}'`);
  if (typeof body !== 'string') throw new Error('body must be a string');
  if (!Array.isArray(comments)) throw new Error('comments must be a list');
  const symbols = new Set(graph.nodes.map((n) => n.id));
  return {
    event: event as ReviewEvent,
    body,
    comments: comments.map((raw: unknown, i) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      const where = `comment ${i + 1}`;
      if (typeof c.id !== 'string' || c.id === '' || c.id.length > 100)
        throw new Error(`${where}: id`);
      if (typeof c.symbol !== 'string' || !symbols.has(c.symbol)) {
        throw new Error(`${where}: ${String(c.symbol)} is not part of this change`);
      }
      if (typeof c.body !== 'string' || c.body.trim() === '') throw new Error(`${where}: empty`);
      const about = { id: c.id, symbol: c.symbol, body: c.body };
      if (c.side === undefined) return about;
      // Checked as a forge's comment would be; its errors name this comment.
      let placed: ReviewComment | undefined;
      try {
        [placed] = parseReview(
          JSON.stringify({ event, body: '', comments: [{ ...c, body: c.body }] }),
          allowed,
        ).comments;
      } catch (error) {
        throw new Error((error as Error).message.replace(/^comment 1/, where), { cause: error });
      }
      if (!placed) throw new Error(`${where}: line`);
      const { side, path, otherPath, line } = placed;
      return { ...about, side, path, otherPath, line };
    }),
  };
}

/** `{ ref }`: a branch or remote branch name. */
function parseRef(text: string): string {
  const ref = (JSON.parse(text) as { ref?: unknown } | null)?.ref;
  if (typeof ref !== 'string' || ref === '' || ref.length > 255) throw new Error('ref: a branch');
  return ref;
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
