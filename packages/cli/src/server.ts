import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import {
  CheckoutRefused,
  SymbioteError,
  UnknownCheckoutTarget,
  type BranchReviewInfo,
  type CheckoutResult,
  type BranchMerge,
  type ChangedFile,
  type FinishResult,
  type LocalReview,
  type CheckoutTarget,
  type WorkspaceRequest,
  type Graph,
  type HistoryRefs,
  type LineCount,
  type McpCaller,
  type RefList,
  type RepoStatus,
  type ReviewFile,
} from '@symbiote/core';
import type { Review } from '@symbiote/forge';
import { silentLog, type Log } from '@symbiote/log';
import type { CodeMap } from '@symbiote/monitor';
import { pairKey, type Diffs, type Pair } from './diffs.js';
import {
  count,
  historyScope,
  parseCheckoutTarget,
  parseDocument,
  parseDraft,
  parsePageError,
  parseLocalReview,
  parseMergeChanges,
  parseMergeId,
  parseMcpAnswer,
  parseMergeRequest,
  parseModelChange,
  parseOpen,
  parsePair,
  parseRef,
  parseReview,
  parseScoutAsk,
  parseScoutOpen,
  parseScoutEffort,
  parseScoutTerminal,
  parseTerminalFile,
  parseTerminalPaths,
  parseWorkspaceClean,
  parseWorkspaceDiff,
  parseWorkspaceOpen,
  parseWorkspaceReply,
  parseWorkspaceRequest,
  parseWorkspaceTerminal,
  SHA,
  sourceFiles,
  terminalSize,
  withLines,
  type Side,
} from './server-requests.js';
import type { OpenRequest, OpenResult } from './editor.js';
import type { Workspaces } from './workspaces.js';
import { STATE_NAMES, type StateName, type StateStore } from './state.js';
import { MAX_DOCUMENT_BYTES } from './workspace-documents.js';
import { WorkspaceRefused } from './workspace-record.js';
import { MergeRefused, type Merger } from './merges.js';
import { parsePromptChange, PromptRefused, type PromptSettingsService } from './prompts.js';
import type { UsageService } from './usage.js';
import type { IntroRecord } from './intro.js';
import type { Histories } from './history.js';
import { ReviewRefused, type BranchReviews } from './reviews.js';
import { imageKind, MAX_IMAGE_BYTES, type Terminals } from './terminal.js';
import { ScoutRefused, type Scout } from './scout.js';
import { MAX_SKILL, parseSkillChange, SkillRefused, type SkillsService } from './skills.js';
import { McpRefused, symbioteMcp, type SymbioteMcp } from './mcp.js';

export { sourceFiles } from './server-requests.js';

/** Posts reviews to the change request being viewed (`symbiote pr` only). */
export interface ReviewTarget {
  forge: 'github' | 'gitlab';
  submit(review: Review): Promise<{ url: string }>;
}

/** A change's files read from git (V60), for the Files page: their lines, and one file's diff. */
export interface ChangeFiles {
  /** Lines added and removed per file from `from` to `to`, renames detected. */
  lines(from: string, to: string): Promise<LineCount[]>;
  /** One file's diff from `from` to `to`, the whole file as context. */
  diff(from: string, to: string, file: ChangedFile): Promise<string>;
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
  /** Each diff's files with their lines, and one file's diff (V60): `./api/files`, `./api/file`. */
  files?: ChangeFiles;
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
  /** The checkout's skills (V41): `/skills`, `/api/skills`. */
  skills?: SkillsService;
  /** Scribe, the Skills page's agent that writes skills (V41): `/api/scribe…`. */
  scribe?: Scout;
  /** Where the checkout's code is, by file (RM1): `/monitor`, `/api/monitor…`. */
  monitor?: { map(): Promise<CodeMap> };
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
  /** The files of `graph`'s change, and one file's diff (V60): `/api/files`, `/api/file`. */
  files?: ChangeFiles;
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
  /** Enables `/api/intro` (V39): whether a person saw the first-time intro, for every page. */
  intro?: IntroRecord;
  /**
   * Symbiote's logs (LG1): a line per request, and the pages' errors at `POST /api/logs`;
   * without it, nothing is written.
   */
  log?: Log;
  /** Symbiote's version, as its MCP introduces itself (MC1). */
  version?: string;
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
  /** The change's files with their lines, and one file's diff (V60). */
  files?: SiteFiles | undefined;
}

/** A site's {@link ChangeFiles}, at its graph's two commits. */
interface SiteFiles {
  list(): Promise<ReviewFile[]>;
  diff(file: ChangedFile): Promise<string>;
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
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** Largest review or state the viewer may send. */
const MAX_BODY_BYTES = 1 << 20;

/** Rows of the history the viewer may ask for at once. */
const MAX_HISTORY_ROWS = 500;

/** `/diff/<base>..<head>` and what follows: the viewer's own files and API, for that diff. */
const DIFF_PATH = new RegExp(`^/diff/(${SHA})\\.\\.(${SHA})(/.*)?$`);
/** `/review/<branch, URL-encoded>` and what follows: a branch's review, as a diff's page. */
const REVIEW_PATH = /^\/review\/([^/]+)(\/.*)?$/;
/**
 * `/api/terminals/<id>`, its output; `…/in`, `…/resize`, `…/close` (V21); `…/image` (V36);
 * `…/paths`, `…/open` (V38).
 */
const TERMINAL_PATH = /^\/api\/terminals\/([0-9a-z]+)(?:\/(in|resize|close|image|paths|open))?$/;
/** Most a terminal is sent at once: keys typed, or a line Symbiote types (V21). */
const MAX_TERMINAL_INPUT = 64 * 1024;
/** How often an open merge log's stream looks for new lines (V46a). */
const LOG_POLL_MS = 250;

/** Most a file's diff may weigh on the Files page (V60, decision 436): more would stall it. */
const MAX_FILE_DIFF_BYTES = 5 * 2 ** 20;

/** Most a page's error may weigh (LG1), and how many the pages may send a minute. */
const MAX_PAGE_ERROR = 32 * 1024;
const PAGE_ERRORS_A_MINUTE = 60;
/**
 * Writes that come many times a minute, written at `debug` as reads are (LG1): keys typed in a
 * terminal and its size, a review's marks and drafts as they are saved.
 */
const CHATTY = /^\/api\/terminals\/[0-9a-z]+\/(?:in|resize)$|\/api\/state\//;
/** A terminal's ID in a request's path: what keeps other sites out of it, so written short. */
const TERMINAL_ID = /^(\/api\/terminals\/[0-9a-z]{8})[0-9a-z]+/;

/** A file a terminal could not open (V38): its status by why. */
const FILE_REFUSED = { terminal: 404, outside: 400, missing: 409, editor: 502 } as const;
/** Most an image's request may weigh (V36): the image as base64, in its JSON. */
const MAX_IMAGE_BODY = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024;
const IMAGE_TOO_LARGE = `an image of at most ${MAX_IMAGE_BYTES / 2 ** 20} MB`;
/** Most a document's request may weigh (V40): the file as base64, in its JSON with its name. */
const MAX_DOCUMENT_BODY = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 4096;
const DOCUMENT_TOO_LARGE = `a document of at most ${MAX_DOCUMENT_BYTES / 2 ** 20} MB`;

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
          files: siteFiles(options.graph, options.files),
        }
      : undefined;
  // One site per diff graph, made once: `allowed` walks the whole graph.
  const sites = new WeakMap<Graph, Site>();
  // Branch reviews: the one each branch's page shows (resolved when asked for, or opened), and
  // a site per graph and branch, whose state is the branch's review.
  const opened = new Map<string, { info: BranchReviewInfo; pair: Pair }>();
  const reviewSites = new WeakMap<Graph, Map<string, Site>>();
  let hosts: Set<string> = new Set();
  let address = '';
  let checkingOut = false;
  /**
   * Writes that must not overlap (V18c: two messages at once would make two sessions; one start at
   * a time), from the pages and from Symbiote's MCP alike.
   */
  const busy = new Set<string>();
  /** Symbiote's MCP (MC1): its tools over the repository's services; the asks it holds. */
  const mcp: SymbioteMcp | undefined = repository
    ? symbioteMcp(repository, {
        ...(options.version ? { version: options.version } : {}),
        url: () => address,
        exclusive,
      })
    : undefined;
  /** Terminals' output streams (V21), ended when the server closes. */
  const streams = new Set<ServerResponse>();
  const log = options.log ?? silentLog();
  // The pages' errors, as they sent them: `err` is theirs, not an Error for pino to read.
  const pageLog = log.as('viewer').child({}, { serializers: { err: (err: unknown) => err } });
  const pageErrors = { since: 0, count: 0 };
  const server = createServer((req, res) => {
    const started = performance.now();
    let failure: unknown;
    res.once('close', () => requestLine(req, res, performance.now() - started, failure));
    handle(req, res).catch((error: unknown) => {
      failure = error;
      send(res, 500, String(error));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hosts.has(req.headers.host ?? '')) return send(res, 421, 'unknown host');
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/logs') return pageError(req, res);
    if (url.pathname === '/api/intro' && options.intro) return introApi(req, res, options.intro);
    if (repository) return repositoryRoute(req, res, url, repository);
    return serveSite(req, res, url, url.pathname, root);
  }

  /**
   * A request's line (LG1, decision 354), once it has ended: its method, path, status and time.
   * A `5xx` is an error, with the stack when the request threw; other writes are `info`, with
   * a refusal's words; reads and the chatty writes are `debug`. What a request carried is never
   * written (decision 356).
   */
  function requestLine(req: IncomingMessage, res: ServerResponse, ms: number, failure: unknown) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/logs') return;
    const status = res.statusCode;
    const refusal = status >= 400 ? answers.get(res) : undefined;
    const fields = {
      method: req.method,
      path: url.pathname.replace(TERMINAL_ID, '$1…'),
      ...(url.search ? { query: url.search.slice(0, 300) } : {}),
      status,
      ms: Math.round(ms),
      ...(failure === undefined ? {} : { err: failure }),
      ...(refusal === undefined ? {} : { answer: refusal }),
    };
    if (status >= 500) log.log.error(fields, 'request failed');
    else if (req.method === 'GET' || req.method === 'HEAD' || CHATTY.test(url.pathname)) {
      log.log.debug(fields, 'request');
    } else log.log.info(fields, 'request');
  }

  /**
   * `POST /api/logs` (LG1, decision 353): a page's error (`viewer/src/ui/report.ts`), written as
   * a `viewer` line. From the pages only, as any write; 32 KB, and 60 a minute, at most.
   */
  async function pageError(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (Number(req.headers['content-length']) > MAX_PAGE_ERROR) {
      req.resume();
      return send(res, 413, `a page's error of at most ${MAX_PAGE_ERROR / 1024} KB`);
    }
    return written(
      req,
      res,
      parsePageError,
      ({ level, msg, ...fields }) => {
        const now = Date.now();
        if (now - pageErrors.since >= 60_000) Object.assign(pageErrors, { since: now, count: 0 });
        if (pageErrors.count >= PAGE_ERRORS_A_MINUTE) {
          send(res, 429, "too many of the pages' errors this minute");
          return Promise.resolve();
        }
        pageErrors.count++;
        pageLog[level](fields, msg);
        res.writeHead(204, { 'cache-control': 'no-store' });
        res.end();
        return Promise.resolve();
      },
      MAX_PAGE_ERROR,
    );
  }

  /**
   * `symbiote view`'s addresses: a diff's and a branch review's pages, History and the
   * repository's state, the shell's pages, then each service's API (`/api/workspaces…`,
   * `/api/scout…`, `/api/merges…`); any other, as without a repository.
   */
  async function repositoryRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    repository: RepositoryOptions,
  ): Promise<void> {
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
    if (mcp && url.pathname.startsWith('/api/mcp')) return mcpRoute(req, res, url, mcp);
    const { workspaces, scout, scribe, skills, monitor, settings, usage, merges } = repository;
    if (workspaces) {
      // The workspaces view's old addresses (V18b, `/workspaces` before it); the viewer moves
      // them to `/`.
      if (url.pathname === '/workspaces' || url.pathname === '/features')
        return serveSite(req, res, url, '/', undefined);
      // Start a workspace, a page of the shell's (V30a).
      if (url.pathname === '/start') return serveSite(req, res, url, '/', undefined);
      if (url.pathname.startsWith('/api/workspaces'))
        return workspacesRoute(req, res, url, workspaces);
    }
    // Scout's page, a page of the shell's (V35).
    if (scout && url.pathname === '/scout') return serveSite(req, res, url, '/', undefined);
    if (scout && url.pathname.startsWith('/api/scout')) {
      return pageAgentRoute(req, res, url, scout, {
        api: '/api/scout',
        busy: 'Scout is being asked',
      });
    }
    // Scribe (V41), on the Skills page: Scout's conversation, its own agent.
    if (scribe && url.pathname.startsWith('/api/scribe')) {
      return pageAgentRoute(req, res, url, scribe, {
        api: '/api/scribe',
        busy: 'Scribe is being asked',
      });
    }
    if (skills) {
      // The Skills page (V41), a page of the shell's.
      if (url.pathname === '/skills') return serveSite(req, res, url, '/', undefined);
      if (url.pathname === '/api/skills') {
        if (req.method === 'GET') return answer(res, () => skills.state());
        return written(
          req,
          res,
          parseSkillChange,
          (change) => answer(res, () => skills.change(change)),
          // A skill's text, as JSON escapes it.
          MAX_SKILL * 6 + 4096,
        );
      }
      // What is at a folder the skill library may be set to (SK1), as Settings shows it.
      if (url.pathname === '/api/skills/library') {
        if (req.method !== 'GET') return send(res, 405, 'method not allowed');
        const folder = url.searchParams.get('folder');
        if (!folder) return send(res, 400, 'folder: the folder to look at');
        return answer(res, () => skills.probe(folder));
      }
    }
    if (monitor) {
      // The Monitor page (RM1), a page of the shell's.
      if (url.pathname === '/monitor') return serveSite(req, res, url, '/', undefined);
      if (url.pathname === '/api/monitor') return monitorMap(req, res, monitor);
      if (url.pathname === '/api/monitor/open') return monitorOpen(req, res, monitor);
    }
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
    if (merges && url.pathname.startsWith('/api/merges')) {
      return mergesRoute(req, res, url, merges);
    }
    const terminal = repository.terminals ? TERMINAL_PATH.exec(url.pathname) : null;
    if (terminal && repository.terminals) {
      const [, id = '', action] = terminal;
      return terminalApi(req, res, repository.terminals, id, action);
    }
    return serveSite(req, res, url, url.pathname, root);
  }

  /**
   * `/api/mcp` (MC1): one JSON-RPC message of an agent's, answered when its tool is done — an asked
   * one once the person answered —, and dropped when the agent hangs up; `/api/mcp/asks`, what waits
   * for the person; `/api/mcp/answer { id, yes }`, their answer from a page.
   */
  async function mcpRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    mcp: SymbioteMcp,
  ): Promise<void> {
    if (url.pathname === '/api/mcp/asks') return read(req, res, () => Promise.resolve(mcp.asks()));
    if (url.pathname === '/api/mcp/answer') {
      return written(req, res, parseMcpAnswer, async (answer) => {
        try {
          json(res, 200, await mcp.answer(answer));
        } catch (error) {
          if (!(error instanceof McpRefused)) throw error;
          json(res, error.status, { error: error.message });
        }
      });
    }
    if (url.pathname !== '/api/mcp') return send(res, 404, 'not found');
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let message: unknown;
    try {
      message = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch {
      return json(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'not JSON' },
      });
    }
    const hungUp = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) hungUp.abort();
    });
    const answer = await mcp.handle(message, callerOf(req), hungUp.signal);
    if (hungUp.signal.aborted) return;
    if (answer) return json(res, 200, answer);
    // A notification has no answer; a call ended without one, by the server closing.
    const call = !!message && typeof message === 'object' && 'id' in message;
    if (call) return send(res, 503, 'Symbiote is closing');
    res.writeHead(202, { 'cache-control': 'no-store' });
    res.end();
  }

  /** Who calls Symbiote's MCP, as its bridge says (MC1): Scout, or an agent through `symbiote mcp`. */
  function callerOf(req: IncomingMessage): McpCaller {
    if (req.headers['x-symbiote-caller'] === 'scout') return { via: 'scout' };
    const header = (name: string) => {
      const value = req.headers[name];
      return typeof value === 'string' && value !== '' ? value : undefined;
    };
    const client = header('x-symbiote-client')?.slice(0, 200);
    let folder: string | undefined;
    try {
      folder = header('x-symbiote-folder') && decodeURIComponent(header('x-symbiote-folder') ?? '');
    } catch {
      folder = undefined;
    }
    return {
      via: 'mcp',
      ...(client ? { client } : {}),
      ...(folder ? { folder: folder.slice(0, 1000) } : {}),
    };
  }

  /** `/api/workspaces…` (V18): the list and a start, each workspace's reads and writes. */
  async function workspacesRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    workspaces: Workspaces,
  ): Promise<void> {
    if (url.pathname === '/api/workspaces') return workspacesApi(req, res, workspaces);
    if (url.pathname === '/api/workspaces/options')
      return read(req, res, () => workspaces.options());
    if (url.pathname === '/api/workspaces/draft') {
      if (req.method === 'GET') return json(res, 200, await workspaces.draft());
      return written(req, res, parseDraft, (draft) =>
        answer(res, () => workspaces.saveDraft(draft).then(() => ({}))),
      );
    }
    if (url.pathname === '/api/workspaces/documents') {
      // A file for the start (V40), refused before it is read: the page checks the size first.
      if (Number(req.headers['content-length']) > MAX_DOCUMENT_BODY) {
        req.resume();
        return send(res, 413, DOCUMENT_TOO_LARGE);
      }
      return written(
        req,
        res,
        parseDocument,
        ({ name, bytes }) => answer(res, () => workspaces.saveDocument(name, bytes)),
        MAX_DOCUMENT_BODY,
      );
    }
    if (url.pathname === '/api/workspaces/check') {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      const at = url.searchParams.get('at');
      if (!at) return send(res, 400, 'at: the commit a workspace starts from');
      return answer(res, () => workspaces.check(at).then((guess) => guess ?? {}));
    }
    if (url.pathname === '/api/workspaces/start') {
      return onBranch(req, res, (branch) => startingOne(res, () => workspaces.startAgent(branch)));
    }
    if (url.pathname === '/api/workspaces/stop') {
      return onBranch(req, res, (branch) => answer(res, () => workspaces.stopAgent(branch)));
    }
    if (url.pathname === '/api/workspaces/open') {
      return written(req, res, parseWorkspaceOpen, ({ branch }) =>
        answer(res, () => workspaces.openWorktree(branch).then(() => ({}))),
      );
    }
    if (url.pathname === '/api/workspaces/diff') {
      return written(req, res, parseWorkspaceDiff, ({ branch, file }) =>
        answer(res, () => workspaces.openDiff(branch, file).then(() => ({}))),
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
    if (url.pathname === '/api/workspaces/shell') {
      return written(req, res, parseWorkspaceTerminal, (request) =>
        answer(res, () => workspaces.shell(request)),
      );
    }
    if (url.pathname === '/api/workspaces/shells') {
      // It hands out terminals' IDs, which read and drive them: for the page only (V45).
      if (req.headers['x-symbiote'] !== '1' || !sameSite(req)) {
        return send(res, 403, 'forbidden');
      }
      return ofBranch(req, res, url, (branch) => workspaces.shells(branch));
    }
    return serveSite(req, res, url, url.pathname, root);
  }

  /**
   * A page agent's API under `api` (Scout's, V35; Scribe's, V41): its state; a question or a new
   * conversation, one at a time (each starts or stops an agent), refused meanwhile with `busy`;
   * its terminal; the levels, read where a stepper shows them (Codex's start its daemon), and its
   * level and model (V47) in the project's config, set in Settings.
   */
  async function pageAgentRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    agent: Scout,
    { api, busy }: { api: string; busy: string },
  ): Promise<void> {
    if (url.pathname === api) return read(req, res, () => agent.state());
    if (url.pathname === `${api}/ask`) {
      return written(req, res, parseScoutAsk, (request) =>
        oneAtATime(res, busy, () => agent.ask(request)),
      );
    }
    // Scout's conversation with no question (V50).
    if (url.pathname === `${api}/open`) {
      return written(req, res, parseScoutOpen, (request) =>
        oneAtATime(res, busy, () => agent.open(request)),
      );
    }
    if (url.pathname === `${api}/new`) {
      return written(
        req,
        res,
        () => ({}),
        () => oneAtATime(res, busy, () => agent.renew()),
      );
    }
    if (url.pathname === `${api}/terminal`) {
      return written(req, res, parseScoutTerminal, (request) =>
        answer(res, () => agent.terminal(request)),
      );
    }
    if (url.pathname === `${api}/efforts`) return read(req, res, () => agent.efforts());
    if (url.pathname === `${api}/effort`) {
      return written(req, res, parseScoutEffort, (change) =>
        answer(res, () => agent.setEffort(change)),
      );
    }
    if (url.pathname === `${api}/model`) {
      return written(req, res, parseModelChange, (change) =>
        answer(res, () => agent.setModel(change)),
      );
    }
    return serveSite(req, res, url, url.pathname, root);
  }

  /** `/api/merges…` (V26): the queue and a merge's entry, log, actions, effort and model. */
  async function mergesRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    merges: Merger,
  ): Promise<void> {
    if (url.pathname === '/api/merges') {
      if (req.method === 'GET') return answer(res, () => merges.list());
      return written(req, res, parseMergeRequest, (request) =>
        answer(res, () => merges.enqueue(request)),
      );
    }
    if (url.pathname === '/api/merges/targets') {
      return ofBranch(req, res, url, (branch) => merges.targets(branch));
    }
    if (url.pathname === '/api/merges/log') return mergeLog(req, res, url, merges);
    // The merger's effort (V46d), read and set where Settings' stepper shows it, as Scout's.
    if (url.pathname === '/api/merges/efforts') return read(req, res, () => merges.efforts());
    if (url.pathname === '/api/merges/effort') {
      return written(req, res, parseScoutEffort, (change) =>
        answer(res, () => merges.setEffort(change)),
      );
    }
    if (url.pathname === '/api/merges/model') {
      return written(req, res, parseModelChange, (change) =>
        answer(res, () => merges.setModel(change)),
      );
    }
    if (url.pathname === '/api/merges/approve') {
      return written(req, res, parseMergeId, (id) => answer(res, () => merges.approve(id)));
    }
    if (url.pathname === '/api/merges/recheck') {
      return written(req, res, parseMergeId, (id) => answer(res, () => merges.recheck(id)));
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
    if (path === '/api/files') {
      if (!site?.files) return send(res, 404, 'no files here');
      return send(res, 200, JSON.stringify(await site.files.list()), TYPES['.json']);
    }
    if (path === '/api/file') {
      const wanted = url.searchParams.get('path');
      const file = site?.graph.files.find((f) => f.path === wanted);
      if (!site?.files || !file) return send(res, 404, 'unknown file');
      const diff = await site.files.diff(file);
      if (Buffer.byteLength(diff) > MAX_FILE_DIFF_BYTES) {
        return send(res, 413, `a diff of at most ${MAX_FILE_DIFF_BYTES / 2 ** 20} MB`);
      }
      return send(res, 200, diff, 'text/plain; charset=utf-8');
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
        files: siteFiles(graph, repo.files),
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

  /** `GET /api/intro`: `{ show }`; `POST`: the intro seen (V39). */
  async function introApi(
    req: IncomingMessage,
    res: ServerResponse,
    intro: IntroRecord,
  ): Promise<void> {
    if (req.method === 'GET') return json(res, 200, { show: !(await intro.seen()) });
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    await intro.markSeen();
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
  }

  /**
   * `GET /api/merges/log?id=<id>&from=<byte>`: a merge's log as server-sent events (V46a,
   * decision 314). `lines` with the lines from `from` and the offset to read on from, then each
   * time the log grows, read every 250 ms: whichever process merges writes it. `gone` when its
   * entry is removed. Refused from another site, as a terminal's stream: a check prints the code.
   */
  async function mergeLog(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    merges: Merger,
  ): Promise<void> {
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    if (!sameSite(req)) return send(res, 403, 'forbidden');
    const id = url.searchParams.get('id');
    const from = Number(url.searchParams.get('from') ?? '0');
    if (!id || !Number.isSafeInteger(from) || from < 0) {
      return send(res, 400, 'id: a queued merge; from: an offset in its log');
    }
    const first = await merges.log(id, from);
    if (!first) return send(res, 404, `no merge ${id}`);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    const event = (name: string, data: unknown) =>
      res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    if (first.lines.length > 0) event('lines', first);
    else res.flushHeaders();
    streams.add(res);
    let next = first.next;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(timer);
      streams.delete(res);
    };
    req.on('close', done);
    const poll = () => {
      timer = setTimeout(() => {
        merges
          .log(id, next)
          .then((read) => {
            if (!streams.has(res)) return;
            if (!read) {
              event('gone', {});
              done();
              res.end();
              return;
            }
            if (read.lines.length > 0) event('lines', read);
            next = read.next;
            poll();
          })
          .catch(() => poll());
      }, LOG_POLL_MS);
    };
    poll();
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
   * paste. `…/paths { paths }` answers which paths it printed are files in its folder, and
   * `…/open { path, line?, column? }` opens one in the editor (V38): writes too, as which files
   * exist is not for another site. Its ID is unguessable and made only by a write; a read from
   * another site is refused too.
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
    if (action === 'paths') {
      return written(req, res, parseTerminalPaths, async (paths) => {
        const files = await terminals.files(id, paths);
        if (!files) return send(res, 404, 'no such terminal');
        return json(res, 200, { files });
      });
    }
    if (action === 'open') {
      return written(req, res, parseTerminalFile, async (at) => {
        const result = await terminals.openFile(id, at);
        if (!result.opened) return send(res, FILE_REFUSED[result.why], result.message);
        res.writeHead(204, { 'cache-control': 'no-store' });
        res.end();
      });
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

  /** `oneAtATime` for Symbiote's MCP (MC1): its refusal is an `McpRefused`. */
  async function exclusive<T>(words: string, task: () => Promise<T>): Promise<T> {
    if (busy.has(words)) throw new McpRefused(words, 409);
    busy.add(words);
    try {
      return await task();
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
        error instanceof ScoutRefused ||
        error instanceof SkillRefused
      )
        return json(res, error.status, { error: error.message });
      throw error;
    }
  }

  /** One start at a time (a worktree and an agent each), from a page or Symbiote's MCP. */
  function startingOne(res: ServerResponse, task: () => Promise<unknown>): Promise<void> {
    return oneAtATime(res, 'a workspace is being started', task);
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

  /** The checkout's map (RM1), or why there is none (no commit yet): 409 with its words. */
  async function monitorMap(
    req: IncomingMessage,
    res: ServerResponse,
    monitor: NonNullable<RepositoryOptions['monitor']>,
  ): Promise<void> {
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    try {
      return json(res, 200, await monitor.map());
    } catch (error) {
      if (error instanceof SymbioteError) return json(res, 409, { error: error.message });
      throw error;
    }
  }

  /**
   * Opens a file of the Monitor's map in VS Code (RM1): `POST { path }`, a path of the map read,
   * at its commit's first line where that is in the working copy now. Nothing outside the map.
   */
  async function monitorOpen(
    req: IncomingMessage,
    res: ServerResponse,
    monitor: NonNullable<RepositoryOptions['monitor']>,
  ): Promise<void> {
    const { open } = options;
    if (!open) return send(res, 404, 'files open from symbiote view');
    return written(
      req,
      res,
      (text) => {
        const value = JSON.parse(text) as { path?: unknown } | null;
        if (typeof value?.path !== 'string') throw new Error("path: a file of the map's commit");
        return value.path;
      },
      async (path) => {
        const map = await monitor.map();
        if (!map.files.some((file) => file.path === path)) {
          return send(res, 400, `${path} is not a file of ${map.commit.slice(0, 7)}`);
        }
        const result = await open({ sha: map.commit, file: path, line: 1, column: 1 });
        if (!result.opened) {
          return json(res, result.reason === 'missing' ? 404 : 502, { error: result.message });
        }
        return json(res, 200, { line: result.line, how: result.how, moved: result.moved });
      },
    );
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
  address = `http://127.0.0.1:${port}/`;
  return {
    url: address,
    close: () => {
      // A held call or wait would keep its connection, and the server, open.
      mcp?.close();
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

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(308, { location, 'cache-control': 'no-store' });
  res.end();
}

/** A refusal's or a failure's words, for its request's line (LG1): 500 characters at most. */
const answers = new WeakMap<ServerResponse, string>();

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type = 'text/plain',
): void {
  if (status >= 400) answers.set(res, body.toString().slice(0, 500));
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
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

/**
 * A graph's files from git (V60), at its two commits; none without a reader or a commit. Their
 * lines are read once; a failed read is tried again at the next ask.
 */
function siteFiles(graph: Graph, files: ChangeFiles | undefined): SiteFiles | undefined {
  const from = graph.revisions.from;
  const to = graph.revisions.head.sha;
  if (!files || !from || !to) return undefined;
  let listed: Promise<ReviewFile[]> | undefined;
  return {
    list: () =>
      (listed ??= files.lines(from, to).then(
        (counts) => withLines(graph.files, counts),
        (error: unknown) => {
          listed = undefined;
          throw error;
        },
      )),
    diff: (file) => files.diff(from, to, file),
  };
}
