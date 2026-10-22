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
  type BranchMerge,
  type FinishResult,
  type LocalReview,
  type CheckoutTarget,
  type WorkspaceReply,
  type BriefParts,
  type WorkspaceRequest,
  type WorkspaceTerminalRequest,
  type MergeRequest,
  type Graph,
  type AgentKind,
  type PermissionMode,
  type HistoryRefs,
  type HistoryScope,
  type RefList,
  type RepoStatus,
  type ScoutAsk,
  type ScoutTerminalRequest,
  type WorkKind,
} from '@symbiote/core';
import type { Review, ReviewComment, ReviewEvent } from '@symbiote/forge';
import { pairKey, type Diffs, type Pair } from './diffs.js';
import type { OpenRequest, OpenResult } from './editor.js';
import { WorkspaceRefused, type Workspaces } from './workspaces.js';
import { MergeRefused, type Merger } from './merges.js';
import { parsePromptChange, PromptRefused, type PromptSettingsService } from './prompts.js';
import type { UsageService } from './usage.js';
import type { Histories } from './history.js';
import { ReviewRefused, type BranchReviews } from './reviews.js';
import { imageKind, MAX_IMAGE_BYTES, type Terminals } from './terminal.js';
import { ScoutRefused, type Scout } from './scout.js';

export type Side = 'base' | 'head';

/** What the viewer keeps between sessions: reviewed marks and draft comments. */
export type StateName = 'review' | 'drafts';
const STATE_NAMES: readonly StateName[] = ['review', 'drafts'];

export interface StateStore {
  /** The saved value, or null. */
  read(name: StateName): Promise<unknown>;
  write(name: StateName, value: unknown): Promise<void>;
}

/** Posts reviews to the change request being viewed (`symbiote pr` only). */
export interface ReviewTarget {
  forge: 'github' | 'gitlab';
  submit(review: Review): Promise<{ url: string }>;
}

/** `symbiote view`: the repository's commits, and the diffs between them picked in the viewer. */
export interface RepositoryOptions {
  /** The repository's folder name, shown at the top of the viewer's sidenav (V29a). */
  name?: string;
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
  /** Workspaces started from the page, each with its agent (V18): `/api/workspaces…`. */
  workspaces?: Workspaces;
  /** Terminals on agents' sessions (V21): `/api/terminals/<id>…`; closed with the server. */
  terminals?: Terminals;
  /** Symbiote's merger (V26): approved branches merged, checked and landed: `/api/merges…`. */
  merges?: Merger;
  /** Every agent's prompts (V28): `/api/settings/prompts`. */
  settings?: PromptSettingsService;
  /** Scout, a read-only agent in the checkout (V35): `/scout`, `/api/scout…`. */
  scout?: Scout;
  /** Each subscription's windows of use (V29c): `GET /api/usage`, from a 5-min copy. */
  usage?: UsageService;
}

export interface ViewServerOptions {
  /** The graph served at `/` (`symbiote pr`). */
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
  /**
   * Enables `POST /api/open`: a file of a graph's change, opened in VS Code; in `worktree` when
   * the branch reviewed is checked out in another worktree (V18b).
   */
  open?: (request: OpenRequest, worktree?: string) => Promise<OpenResult>;
}

/** A graph served with its sources, review state and reviews. */
interface Site {
  graph: Graph;
  allowed: Record<Side, Set<string>>;
  readSource: (side: Side, path: string) => Promise<string>;
  state?: StateStore | undefined;
  review?: ReviewTarget | undefined;
  /** A branch review's own end (V16): its verdict recorded. */
  finish?: (review: LocalReview) => Promise<FinishResult>;
  /** Whether the branch merges cleanly into the default branch (V17). */
  merge?: () => Promise<BranchMerge | null>;
  /** The worktree the branch reviewed is checked out in, when not this one (V18b). */
  worktree?: () => Promise<string | undefined>;
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
/** `/api/terminals/<id>`, its output; `…/in`, `…/resize`, `…/close` (V21); `…/image` (V36). */
const TERMINAL_PATH = /^\/api\/terminals\/([0-9a-z]+)(?:\/(in|resize|close|image))?$/;
/** Most a terminal is sent at once: keys typed, or a line Symbiote types (V21). */
const MAX_TERMINAL_INPUT = 64 * 1024;
/** Most an image's request may weigh (V36): the image as base64, in its JSON. */
const MAX_IMAGE_BODY = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024;
const IMAGE_TOO_LARGE = `an image of at most ${MAX_IMAGE_BYTES / 2 ** 20} MB`;

/**
 * Serves the viewer, `/api/graph` and `/api/source` on localhost only: one graph at `/`
 * (`symbiote pr`), or (`symbiote view`) the commits page at `/` and each diff under its own path,
 * where the viewer's relative URLs reach that diff's API. Sources are limited to files a graph
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
  let startingWorkspace = false;
  /** Writes that must not overlap (V18c: two messages at once would make two sessions). */
  const busy = new Set<string>();
  /** Terminals' output streams (V21), ended when the server closes. */
  const streams = new Set<ServerResponse>();
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
      // The history page (V25; at `/` before, which is now the workspaces view).
      if (url.pathname === '/history') return serveSite(req, res, url, '/', undefined);
      if (url.pathname === '/api/history') return historyRows(req, res, url, repository);
      if (url.pathname === '/api/history/shape') return historyShape(req, res, url, repository);
      if (url.pathname === '/api/history/refs') return historyRefs(req, res, url, repository);
      if (url.pathname === '/api/status') return read(req, res, () => repository.status());
      if (url.pathname === '/api/refs') return read(req, res, () => repository.refs());
      if (url.pathname === '/api/checkout') return checkoutTarget(req, res, repository);
      if (url.pathname === '/api/diffs') return startDiff(req, res, repository);
      if (url.pathname === '/api/diffs/stop') return stopDiff(req, res, repository);
      const { workspaces } = repository;
      if (workspaces) {
        // The workspaces view's old addresses (V18b, `/workspaces` before it); the viewer moves
        // them to `/`.
        if (url.pathname === '/workspaces' || url.pathname === '/features')
          return serveSite(req, res, url, '/', undefined);
        // Start a workspace, a page of the shell's (V30a).
        if (url.pathname === '/start') return serveSite(req, res, url, '/', undefined);
        if (url.pathname === '/api/workspaces') return workspacesApi(req, res, workspaces);
        if (url.pathname === '/api/workspaces/options')
          return read(req, res, () => workspaces.options());
        if (url.pathname === '/api/workspaces/draft') {
          if (req.method === 'GET') return json(res, 200, await workspaces.draft());
          return written(req, res, parseDraft, (draft) =>
            answer(res, () => workspaces.saveDraft(draft).then(() => ({}))),
          );
        }
        if (url.pathname === '/api/workspaces/check') {
          if (req.method !== 'GET') return send(res, 405, 'method not allowed');
          const at = url.searchParams.get('at');
          if (!at) return send(res, 400, 'at: the commit a workspace starts from');
          return answer(res, () => workspaces.check(at).then((guess) => guess ?? {}));
        }
        if (url.pathname === '/api/workspaces/start') {
          return onBranch(req, res, (branch) =>
            startingOne(res, () => workspaces.startAgent(branch)),
          );
        }
        if (url.pathname === '/api/workspaces/stop') {
          return onBranch(req, res, (branch) => answer(res, () => workspaces.stopAgent(branch)));
        }
        if (url.pathname === '/api/workspaces/open') {
          return written(req, res, parseWorkspaceOpen, ({ branch, file }) =>
            answer(res, () => workspaces.openWorktree(branch, file).then(() => ({}))),
          );
        }
        if (url.pathname === '/api/workspaces/changes') {
          return ofBranch(req, res, url, (branch) => workspaces.changes(branch));
        }
        if (url.pathname === '/api/workspaces/prompt') {
          return ofBranch(req, res, url, (branch) =>
            workspaces.prompt(branch).then((prompt) => ({ prompt })),
          );
        }
        if (url.pathname === '/api/workspaces/merge') {
          return ofBranch(req, res, url, (branch) => workspaces.merge(branch));
        }
        if (url.pathname === '/api/workspaces/thread') {
          return ofBranch(req, res, url, (branch) => workspaces.thread(branch));
        }
        if (url.pathname === '/api/workspaces/reply') {
          return written(req, res, parseWorkspaceReply, (request) =>
            oneAtATime(res, 'a message is being sent', () => workspaces.reply(request)),
          );
        }
        if (url.pathname === '/api/workspaces/clean') {
          return written(req, res, parseWorkspaceClean, (request) =>
            answer(res, () => workspaces.clean(request)),
          );
        }
        if (url.pathname === '/api/workspaces/terminal') {
          return written(req, res, parseWorkspaceTerminal, (request) =>
            answer(res, () => workspaces.terminal(request)),
          );
        }
      }
      const { scout } = repository;
      if (scout) {
        // Scout's page, a page of the shell's (V35).
        if (url.pathname === '/scout') return serveSite(req, res, url, '/', undefined);
        if (url.pathname === '/api/scout') return read(req, res, () => scout.state());
        // One question or new conversation at a time: each starts or stops an agent.
        if (url.pathname === '/api/scout/ask') {
          return written(req, res, parseScoutAsk, (request) =>
            oneAtATime(res, 'Scout is being asked', () => scout.ask(request)),
          );
        }
        if (url.pathname === '/api/scout/new') {
          return written(
            req,
            res,
            () => ({}),
            () => oneAtATime(res, 'Scout is being asked', () => scout.renew()),
          );
        }
        if (url.pathname === '/api/scout/terminal') {
          return written(req, res, parseScoutTerminal, (request) =>
            answer(res, () => scout.terminal(request)),
          );
        }
      }
      const { settings, usage } = repository;
      // Each subscription's windows of use (V29c): read only, the tokens stay in this process.
      if (usage && url.pathname === '/api/usage') {
        if (req.method !== 'GET') return send(res, 405, 'method not allowed');
        return answer(res, () => usage.report());
      }
      // Every agent's prompts (V28b).
      if (settings && url.pathname === '/settings') return serveSite(req, res, url, '/', undefined);
      if (settings && url.pathname === '/api/settings/prompts') {
        if (req.method === 'GET') return answer(res, () => settings.prompts());
        return written(req, res, parsePromptChange, (change) =>
          answer(res, () => settings.setPrompt(change)),
        );
      }
      const { merges } = repository;
      if (merges) {
        if (url.pathname === '/api/merges') {
          if (req.method === 'GET') return answer(res, () => merges.list());
          return written(req, res, parseMergeRequest, (request) =>
            answer(res, () => merges.enqueue(request)),
          );
        }
        if (url.pathname === '/api/merges/targets') {
          return ofBranch(req, res, url, (branch) => merges.targets(branch));
        }
        if (url.pathname === '/api/merges/approve') {
          return written(req, res, parseMergeId, (id) => answer(res, () => merges.approve(id)));
        }
        if (url.pathname === '/api/merges/request-changes') {
          return written(req, res, parseMergeChanges, ({ id, comments }) =>
            answer(res, () => merges.requestChanges(id, comments)),
          );
        }
        const action = /^\/api\/merges\/(land|retry|remove)$/.exec(url.pathname)?.[1];
        if (action) {
          return written(req, res, parseMergeId, (id) =>
            answer(res, () =>
              action === 'land'
                ? merges.land(id)
                : action === 'retry'
                  ? merges.retry(id)
                  : merges.remove(id).then(() => ({})),
            ),
          );
        }
      }
      const terminal = repository.terminals ? TERMINAL_PATH.exec(url.pathname) : null;
      if (terminal && repository.terminals) {
        const [, id = '', action] = terminal;
        return terminalApi(req, res, repository.terminals, id, action);
      }
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
    if (path === '/api/merge') return mergeCheck(req, res, site);
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
        ...(repository?.name ? { repo: repository.name } : {}),
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
   * review. Opened anew (a reload, a new `symbiote view`), the branch is resolved here.
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
        merge: () => reviews.merge(info),
        worktree: async () =>
          (await repo.refs()).branches.find((b) => b.name === info.branch)?.worktree,
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

  /** The branches with their tips' rows in a listing (V10b): `?scope=…&version=…`. */
  async function historyRefs(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    repo: RepositoryOptions,
  ): Promise<void> {
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    const scope = historyScope(url);
    const version = url.searchParams.get('version');
    if (!scope || !version) return send(res, 400, 'scope and version needed');
    const { branches, remotes } = await repo.refs();
    const rows = await repo.history.tips(scope, version, [
      ...branches.map((b) => b.sha),
      ...remotes.map((r) => r.sha),
    ]);
    if (!rows) return send(res, 409, 'the history changed: list it again');
    const answer: HistoryRefs = {
      version,
      branches: branches.map((b, i) => ({ ...b, row: rows[i] ?? null })),
      remotes: remotes.map((r, i) => ({ ...r, row: rows[branches.length + i] ?? null })),
    };
    return json(res, 200, answer);
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

  /** The workspaces (GET), or a new one: its branch, worktree and agent (POST), one at a time. */
  async function workspacesApi(
    req: IncomingMessage,
    res: ServerResponse,
    workspaces: Workspaces,
  ): Promise<void> {
    if (req.method === 'GET') return json(res, 200, await workspaces.list());
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let request: WorkspaceRequest;
    try {
      request = parseWorkspaceRequest(await readBody(req, MAX_BODY_BYTES));
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    return startingOne(res, () => workspaces.start(request));
  }

  /** A write about one workspace: `POST { branch }`. */
  async function onBranch(
    req: IncomingMessage,
    res: ServerResponse,
    act: (branch: string) => Promise<void>,
  ): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let branch: string;
    try {
      const value = JSON.parse(await readBody(req, MAX_BODY_BYTES)) as { branch?: unknown } | null;
      if (typeof value?.branch !== 'string') throw new Error("branch: a workspace's branch");
      branch = value.branch;
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    return act(branch);
  }

  /** A write with a JSON body `parse` checks: 400 with its words when it does not. */
  async function written<T>(
    req: IncomingMessage,
    res: ServerResponse,
    parse: (text: string) => T,
    act: (request: T) => Promise<void>,
    limit = MAX_BODY_BYTES,
  ): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let request: T;
    try {
      request = parse(await readBody(req, limit));
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    return act(request);
  }

  /**
   * A terminal (V21): `GET` streams its output as server-sent events (`out`, then `exit` and
   * the end); `POST …/in { data }`, `…/resize { cols, rows }` and `…/close` are writes, and so is
   * `…/image { data }` (V36), an image as base64 saved for the agent: its path and the text to
   * paste. Its ID is unguessable and made only by a write; a read from another site is refused
   * too.
   */
  async function terminalApi(
    req: IncomingMessage,
    res: ServerResponse,
    terminals: Terminals,
    id: string,
    action: string | undefined,
  ): Promise<void> {
    if (action === undefined) {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      if (!sameSite(req)) return send(res, 403, 'forbidden');
      // What it printed so far arrives while listening starts: kept until the head is sent.
      let ready = false;
      const queued: string[] = [];
      const event = (name: string, data: unknown) => {
        const text = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
        if (ready) res.write(text);
        else queued.push(text);
      };
      const stop = terminals.listen(id, {
        out: (data) => event('out', data),
        exit: (code) => {
          event('exit', { code });
          streams.delete(res);
          res.end();
        },
      });
      if (!stop) return send(res, 404, 'no such terminal');
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      ready = true;
      if (queued.length > 0) res.write(queued.join(''));
      else res.flushHeaders();
      streams.add(res);
      req.on('close', () => {
        streams.delete(res);
        stop();
      });
      return;
    }
    const parse = (text: string) => JSON.parse(text) as Record<string, unknown> | null;
    if (action === 'image') {
      // Refused before it is read: the page checks the size first.
      if (Number(req.headers['content-length']) > MAX_IMAGE_BODY) {
        req.resume();
        return send(res, 413, IMAGE_TOO_LARGE);
      }
      return written(
        req,
        res,
        parse,
        async (body) => {
          if (typeof body?.data !== 'string' || body.data === '') {
            return send(res, 400, 'data: the image, as base64');
          }
          const bytes = Buffer.from(body.data, 'base64');
          if (bytes.length > MAX_IMAGE_BYTES) return send(res, 413, IMAGE_TOO_LARGE);
          const kind = imageKind(bytes);
          if (!kind)
            return send(res, 400, 'not an image the agents attach: PNG, JPEG, GIF or WebP');
          const saved = await terminals.image(id, bytes, kind);
          if (!saved) return send(res, 404, 'no such terminal');
          return json(res, 200, saved);
        },
        MAX_IMAGE_BODY,
      );
    }
    return written(req, res, parse, (body) => {
      let done: boolean;
      if (action === 'in') {
        if (typeof body?.data !== 'string' || body.data.length > MAX_TERMINAL_INPUT) {
          return Promise.resolve(
            send(res, 400, `data: what to type, at most ${MAX_TERMINAL_INPUT} characters`),
          );
        }
        done = terminals.write(id, body.data);
      } else if (action === 'resize') {
        const size = terminalSize(body);
        if (!size) return Promise.resolve(send(res, 400, 'cols, rows: whole numbers, 2 to 1000'));
        done = terminals.resize(id, size.cols, size.rows);
      } else done = terminals.close(id);
      if (!done) return Promise.resolve(send(res, 404, 'no such terminal'));
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return Promise.resolve();
    });
  }

  /** One such write at a time: another meanwhile is refused (409) with `words`. */
  async function oneAtATime(
    res: ServerResponse,
    words: string,
    task: () => Promise<unknown>,
  ): Promise<void> {
    if (busy.has(words)) return json(res, 409, { error: words });
    busy.add(words);
    try {
      return await answer(res, task);
    } finally {
      busy.delete(words);
    }
  }

  /** A read about one workspace: `GET ?branch=`. */
  async function ofBranch(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    value: (branch: string) => Promise<unknown>,
  ): Promise<void> {
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    const branch = url.searchParams.get('branch');
    if (!branch) return send(res, 400, "branch: a workspace's branch");
    return answer(res, () => value(branch));
  }

  /** The answer, or a workspace's, a merge's or a setting's refusal with its status and words. */
  async function answer(res: ServerResponse, task: () => Promise<unknown>): Promise<void> {
    try {
      return json(res, 200, await task());
    } catch (error) {
      if (
        error instanceof WorkspaceRefused ||
        error instanceof MergeRefused ||
        error instanceof PromptRefused ||
        error instanceof ScoutRefused
      )
        return json(res, error.status, { error: error.message });
      throw error;
    }
  }

  /** One start at a time (a worktree and an agent each). */
  async function startingOne(res: ServerResponse, task: () => Promise<unknown>): Promise<void> {
    if (startingWorkspace) return json(res, 409, { error: 'a workspace is being started' });
    startingWorkspace = true;
    try {
      return await answer(res, task);
    } finally {
      startingWorkspace = false;
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

  /** `GET`: whether a branch review's branch merges cleanly into the default branch (V17). */
  async function mergeCheck(
    req: IncomingMessage,
    res: ServerResponse,
    site: Site | undefined,
  ): Promise<void> {
    if (!site?.merge) return send(res, 404, 'not a branch review');
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    return json(res, 200, await site.merge());
  }

  async function postReview(
    req: IncomingMessage,
    res: ServerResponse,
    site: Site | undefined,
  ): Promise<void> {
    const target = site?.review;
    if (!site || !target) return send(res, 404, 'reviews are posted from symbiote pr');
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
    if (!open || !site) return send(res, 404, 'files open from symbiote view and symbiote pr');
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let target: ReturnType<typeof parseOpen>;
    try {
      const text = await readBody(req, MAX_BODY_BYTES);
      try {
        target = parseOpen(text, site.allowed);
      } catch (error) {
        // A file the branch conflicts in with the default branch (V17) may be outside the change.
        const merge = site.merge ? await site.merge() : null;
        if (!merge || !('conflicts' in merge)) throw error;
        target = parseOpen(text, site.allowed, new Set(merge.conflicts));
      }
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    const { revisions } = site.graph;
    const sha = target.side === 'base' ? revisions.from : revisions.head.sha;
    if (!sha) return json(res, 404, { error: `no ${target.side} commit to open the file at` });
    const worktree = await site.worktree?.();
    const result = await open(
      { sha, file: target.file, line: target.line, column: target.column },
      worktree,
    );
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
    return (
      req.headers['x-symbiote'] === '1' &&
      !!req.headers['content-type']?.startsWith('application/json') &&
      sameSite(req)
    );
  }

  /** No origin (a page's own request may send none), or our own. */
  function sameSite(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    return origin === undefined || hosts.has(origin.replace(/^http:\/\//, ''));
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => {
      // Open streams would keep the server from closing: the terminals end them.
      repository?.terminals?.closeAll();
      for (const stream of streams) stream.end();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), TYPES['.json']);
}

/**
 * `{ kind, title, parts, branch, planFirst, base?, from?, agent?, permissionMode?, effort? }`
 * (V24, V20a, V30b, V33), or `brief` instead of the kind, title and parts, each of its type; what
 * they say is the workspaces' to check (V18).
 */
function parseWorkspaceRequest(text: string): WorkspaceRequest {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected { kind, title, parts, branch, planFirst }');
  }
  const {
    brief,
    kind,
    title,
    parts,
    branch,
    planFirst,
    base,
    from,
    agent,
    permissionMode,
    effort,
  } = value;
  if (brief === undefined && kind === undefined) {
    throw new Error('kind: feature, fix, refactor, chore or spike');
  }
  if (brief !== undefined && typeof brief !== 'string') throw new Error('brief: what to build');
  if (kind !== undefined && typeof kind !== 'string') {
    throw new Error('kind: feature, fix, refactor, chore or spike');
  }
  if (title !== undefined && typeof title !== 'string') throw new Error("title: the work's name");
  const textOnly = (v: unknown) =>
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'string');
  if (parts !== undefined && !textOnly(parts)) throw new Error('parts: each a text');
  if (typeof branch !== 'string') throw new Error("branch: the new branch's name");
  if (typeof planFirst !== 'boolean') throw new Error('planFirst: true or false');
  if (base !== undefined && typeof base !== 'string') throw new Error('base: a full SHA');
  if (from !== undefined && typeof from !== 'string') throw new Error("from: a branch's name");
  if (agent !== undefined && typeof agent !== 'string') throw new Error('agent: claude or codex');
  if (permissionMode !== undefined && typeof permissionMode !== 'string') {
    throw new Error('permissionMode: default, acceptEdits or auto');
  }
  if (effort !== undefined && typeof effort !== 'string')
    throw new Error('effort: a level, as high');
  return {
    ...(brief === undefined ? {} : { brief }),
    ...(kind === undefined ? {} : { kind: kind as WorkKind }),
    ...(title === undefined ? {} : { title }),
    ...(parts === undefined ? {} : { parts: parts as BriefParts }),
    branch,
    planFirst,
    ...(base === undefined ? {} : { base }),
    ...(from === undefined ? {} : { from }),
    ...(agent === undefined ? {} : { agent: agent as AgentKind }),
    ...(permissionMode === undefined ? {} : { permissionMode: permissionMode as PermissionMode }),
    ...(effort === undefined ? {} : { effort }),
  };
}

/** The start page's draft (V24c): any object; what it holds is the page's to read. */
function parseDraft(text: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('a draft is an object');
  }
  return value as Record<string, unknown>;
}

/** `{ branch, text, stop? }`: a message for a workspace's agent (V18c). */
function parseWorkspaceReply(text: string): WorkspaceReply {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.branch !== 'string') throw new Error("branch: a workspace's branch");
  if (typeof value.text !== 'string') throw new Error('text: the message');
  if (value.stop !== undefined && typeof value.stop !== 'boolean') {
    throw new Error('stop: true or false');
  }
  return { branch: value.branch, text: value.text, ...(value.stop ? { stop: true } : {}) };
}

/** `{ cols, rows }`: whole numbers from 2 to 1000; null otherwise. */
function terminalSize(
  value: Record<string, unknown> | null,
): { cols: number; rows: number } | null {
  const ok = (n: unknown): n is number =>
    Number.isInteger(n) && (n as number) >= 2 && (n as number) <= 1000;
  return ok(value?.cols) && ok(value.rows) ? { cols: value.cols, rows: value.rows } : null;
}

/** `{ branch, cols, rows }`: a terminal on a workspace's agent session (V21). */
function parseWorkspaceTerminal(text: string): WorkspaceTerminalRequest {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.branch !== 'string') throw new Error("branch: a workspace's branch");
  const size = terminalSize(value);
  if (!size) throw new Error('cols, rows: whole numbers, 2 to 1000');
  return { branch: value.branch, ...size };
}

/** `{ text, agent? }`: a question for Scout (V35). */
function parseScoutAsk(text: string): ScoutAsk {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.text !== 'string') throw new Error('text: the question');
  if (value.agent !== undefined && value.agent !== 'claude' && value.agent !== 'codex') {
    throw new Error('agent: claude or codex');
  }
  return { text: value.text, ...(value.agent ? { agent: value.agent } : {}) };
}

/** `{ cols, rows }`: a terminal on Scout's session (V35). */
function parseScoutTerminal(text: string): ScoutTerminalRequest {
  const size = terminalSize(JSON.parse(text) as Record<string, unknown> | null);
  if (!size) throw new Error('cols, rows: whole numbers, 2 to 1000');
  return size;
}

/** `{ branch, unmerged? }`: a workspace to clean up (V18c). */
function parseWorkspaceClean(text: string): { branch: string; unmerged?: boolean } {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.branch !== 'string') throw new Error("branch: a workspace's branch");
  if (value.unmerged !== undefined && typeof value.unmerged !== 'boolean') {
    throw new Error('unmerged: true or false');
  }
  return { branch: value.branch, ...(value.unmerged ? { unmerged: true } : {}) };
}

/**
 * `{ branch, file?, previousPath? }`: a workspace's worktree to open, or a file in it (V29d) and,
 * for a renamed file, where it was.
 */
function parseWorkspaceOpen(text: string): {
  branch: string;
  file?: { path: string; previousPath?: string };
} {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.branch !== 'string') throw new Error("branch: a workspace's branch");
  if (value.file === undefined) return { branch: value.branch };
  if (typeof value.file !== 'string' || value.file === '') {
    throw new Error('file: a path in its worktree');
  }
  if (value.previousPath !== undefined && typeof value.previousPath !== 'string') {
    throw new Error('previousPath: where a renamed file was');
  }
  const { previousPath } = value;
  return {
    branch: value.branch,
    file: { path: value.file, ...(previousPath ? { previousPath } : {}) },
  };
}

/** `{ branch, into }`: a branch to merge, and the branch to merge it into (V26). */
function parseMergeRequest(text: string): MergeRequest {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.branch !== 'string' || value.branch === '') {
    throw new Error('branch: the branch to merge');
  }
  if (typeof value.into !== 'string' || value.into === '') {
    throw new Error('into: the branch to merge into');
  }
  return { branch: value.branch, into: value.into };
}

/** `{ id, comments }`: what to change in a merge's resolution (V26c). */
function parseMergeChanges(text: string): { id: string; comments: string } {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.id !== 'string' || value.id === '') throw new Error('id: a queued merge');
  if (typeof value.comments !== 'string') throw new Error('comments: what to change');
  return { id: value.id, comments: value.comments };
}

/** `{ id }`: a queued merge. */
function parseMergeId(text: string): string {
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value?.id !== 'string' || value.id === '') throw new Error('id: a queued merge');
  return value.id;
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
/** `POST ./api/open`'s body: a file of the change, or one of `conflicts` (head side). */
function parseOpen(
  text: string,
  allowed: Record<Side, Set<string>>,
  conflicts: ReadonlySet<string> = new Set(),
): { side: Side; file: string; line: number; column: number } {
  const value = JSON.parse(text) as Record<'side' | 'file' | 'line' | 'column', unknown> | null;
  const { side, file, line, column = 1 } = value ?? {};
  if (side !== 'base' && side !== 'head') throw new Error('side: base or head');
  const known = (path: string) =>
    allowed[side].has(path) || (side === 'head' && conflicts.has(path));
  if (typeof file !== 'string' || !known(file)) {
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
