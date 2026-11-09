// A graph's pages in the view server: the viewer's files and a graph's API (`/api/graph`, its
// sources, files, state, review), a diff's page while it is analyzed, a branch review's page.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import type {
  BranchReviewInfo,
  ChangedBlob,
  ChangedFile,
  LocalReview,
  Graph,
  ReviewFile,
} from '@symbiote/core';
import type { Review } from '@symbiote/forge';
import { pairKey, type Pair } from './diffs.js';
import {
  parseLocalReview,
  parseOpen,
  parsePair,
  parseRef,
  parseReview,
  sourceFiles,
  withLines,
} from './server-requests.js';
import { STATE_NAMES, type StateName } from './state.js';
import { withHive } from './hive.js';
import { ReviewRefused, type BranchReviews } from './reviews.js';
import type {
  ChangeFiles,
  RepositoryOptions,
  Site,
  SiteFiles,
  ServerContext,
  ViewServerOptions,
} from './server-context.js';
import {
  TYPES,
  MAX_BODY_BYTES,
  json,
  send,
  badBody,
  readBody,
  type ServerHttp,
} from './server-http.js';
import type { ServerHive } from './server-hive.js';

/** Most a file's diff may weigh on the Files page (V60, decision 436): more would stall it. */
const MAX_FILE_DIFF_BYTES = 5 * 2 ** 20;

/**
 * A graph's files from git (V60), at its two commits; none without a reader or a commit. Their
 * lines are read once; a failed read is tried again at the next ask.
 */
export function siteFiles(graph: Graph, files: ChangeFiles | undefined): SiteFiles | undefined {
  const from = graph.revisions.from;
  const to = graph.revisions.head.sha;
  if (!files || !from || !to) return undefined;
  return readFiles(files, from, to, () => Promise.resolve(graph.files));
}

/**
 * The files from `from` to `to` (`changed`: the graph's, or git's while it is analyzed), with
 * git's lines and blobs, read once; a failed read is read again next time.
 */
function readFiles(
  files: ChangeFiles,
  from: string,
  to: string,
  changed: (blobs: ChangedBlob[]) => Promise<Graph['files']>,
): SiteFiles {
  let listed: Promise<ReviewFile[]> | undefined;
  return {
    list: () =>
      (listed ??= Promise.all([files.lines(from, to), files.blobs(from, to)]).then(
        async ([counts, blobs]) => withLines(await changed(blobs), counts, blobs),
        (error: unknown) => {
          listed = undefined;
          throw error;
        },
      )),
    diff: (file) => files.diff(from, to, file),
  };
}

/**
 * A pair's files before its graph exists (V90, decision 847): git's, so the page being analyzed
 * lists them and the Files page reads them meanwhile.
 */
function pairFiles(pair: Pair, files: ChangeFiles): SiteFiles {
  // git's files carry their blobs already; `withLines` gives them again.
  return readFiles(files, pair.base, pair.head, (blobs) => Promise.resolve(blobs));
}

/** The sites of `symbiote pr`'s graph, of each diff and of each branch review. */
export function serverSites(
  ctx: Pick<ServerContext, 'viewerFiles' | 'pairSites' | 'opened' | 'reviewSites' | 'sites'> & {
    options: Pick<ViewServerOptions, 'open' | 'viewerDir'>;
    repository: Pick<RepositoryOptions, 'name' | 'files' | 'state'> | undefined;
  },
  { writable, hiveOn }: Pick<ServerHttp, 'writable'> & Pick<ServerHive, 'hiveOn'>,
) {
  const { options, repository, viewerFiles, pairSites, opened, reviewSites, sites } = ctx;
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
        ...(site?.files || (diff && repository?.files) ? { files: true } : {}),
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
    if (path === '/api/files' || path === '/api/file') {
      if (!site?.files)
        return send(res, 404, path === '/api/files' ? 'no files here' : 'unknown file');
      return serveFiles(res, url, path, site.files, site.graph.files);
    }
    if (path.startsWith('/api/')) return send(res, 404, 'not found');
    return serveFile(res, path);
  }

  /**
   * `./api/files` (the change's files with git's lines) and `./api/file?path=` (one of `changed`'s
   * diffs, a path in the change only), V60.
   */
  async function serveFiles(
    res: ServerResponse,
    url: URL,
    path: '/api/files' | '/api/file',
    files: SiteFiles,
    changed: readonly ChangedFile[],
  ): Promise<void> {
    if (path === '/api/files') {
      return send(res, 200, JSON.stringify(await files.list()), TYPES['.json']);
    }
    const wanted = url.searchParams.get('path');
    const file = changed.find((f) => f.path === wanted);
    if (!file) return send(res, 404, 'unknown file');
    const diff = await files.diff(file);
    if (Buffer.byteLength(diff) > MAX_FILE_DIFF_BYTES) {
      return send(res, 413, `a diff of at most ${MAX_FILE_DIFF_BYTES / 2 ** 20} MB`);
    }
    return send(res, 200, diff, 'text/plain; charset=utf-8');
  }

  /**
   * Static viewer files, as the server started with them: nothing outside the viewer folder. The
   * page marked for Hive mode's look while it is on (decision 612).
   */
  async function serveFile(res: ServerResponse, pathname: string): Promise<void> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return send(res, 400, 'not a path');
    }
    const relative = normalize(decoded).replace(/^[/\\]+/, '') || 'index.html';
    const path = join(options.viewerDir, relative);
    const body = viewerFiles.get(path);
    if (!body) return send(res, 404, 'not found');
    const type = TYPES[extname(path)] ?? 'application/octet-stream';
    if (relative === 'index.html' && (await hiveOn())) {
      return send(res, 200, withHive(body.toString('utf8')), type);
    }
    return send(res, 200, body, type);
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
      pairSites.delete(pairKey(pair));
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
    // Its files do not wait for the graph (V90): git's, from the pair, while it is analyzed.
    if ((path === '/api/files' || path === '/api/file') && req.method === 'GET' && repo.files) {
      const key = pairKey(pair);
      let files = pairSites.get(key);
      if (!files) pairSites.set(key, (files = pairFiles(pair, repo.files)));
      const changed = path === '/api/file' ? await files.list() : [];
      return serveFiles(res, url, path, files, changed);
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
      return badBody(res, error);
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
        files: siteFiles(graph, repo.files),
      };
      sites.set(graph, site);
    }
    return site;
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
      return badBody(res, error);
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
      return badBody(res, error);
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
      return badBody(res, error);
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
      return badBody(res, error);
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
      return badBody(res, error);
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
      return badBody(res, error);
    }
    await store.write(name as StateName, value);
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
  }

  return { serveSite, serveDiff, serveReview, reviewsApi, startDiff, stopDiff };
}

export type ServerSites = ReturnType<typeof serverSites>;
