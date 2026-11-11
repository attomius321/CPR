import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { NUCLEUS_NAMES, type BranchReviewInfo, type Graph } from '@symbiote/core';
import { silentLog } from '@symbiote/log';
import type { Pair } from './diffs.js';
import {
  parseHiveChange,
  parseLandsBy,
  parseHivePacing,
  parseModelChange,
  parseEffortChange,
  parseEventsListen,
  parseEventsPing,
  SHA,
  sourceFiles,
} from './server-requests.js';
import { parsePromptChange } from './prompt-settings.js';
import { parseCheckChange } from './check-setting.js';
import { nucleusStart } from './nucleus-start.js';
import { MAX_SKILL, parseSkillChange, parseSkillOpen } from './skills.js';
import { symbioteMcp, type SymbioteMcp } from './mcp.js';
import { eventStream, type EventStream } from './events.js';
import type {
  RepositoryOptions,
  ViewServerOptions,
  Site,
  SiteFiles,
  ServerContext,
} from './server-context.js';
import { read, answer, fromAnotherSite, redirect, send, serverHttp } from './server-http.js';
import { serverLogs } from './server-logs.js';
import { siteFiles, serverSites } from './server-sites.js';
import { historyRows, historyShape, historyRefs, historyRowsOf, serverGit } from './server-git.js';
import { serverWorkspaces } from './server-workspaces.js';
import { sinceOf, serverHive } from './server-hive.js';
import { serverNucleus } from './server-nucleus.js';
import { serverMerges } from './server-merges.js';
import { serverTerminals } from './server-terminals.js';
import { monitorMap, issueList, issueOne, serverPages } from './server-pages.js';

export { sourceFiles } from './server-requests.js';

export interface ViewServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Sent with every answer (fix/security-and-bugs): only pages on this machine may frame one — the
 * nexus frames each `symbiote view` —, so no other site shows a page under its own and has the
 * person click in it; and no answer is read as another type than it says.
 */
const GUARD_HEADERS = {
  'content-security-policy': "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*",
  'x-content-type-options': 'nosniff',
};

/** `/diff/<base>..<head>` and what follows: the viewer's own files and API, for that diff. */
const DIFF_PATH = new RegExp(`^/diff/(${SHA})\\.\\.(${SHA})(/.*)?$`);
/** `/review/<branch, URL-encoded>` and what follows: a branch's review, as a diff's page. */
const REVIEW_PATH = /^\/review\/([^/]+)(\/.*)?$/;
/**
 * `/api/terminals/<id>`, its output; `…/in`, `…/resize`, `…/close` (V21); `…/image` (V36);
 * `…/paths`, `…/open` (V38).
 */
const TERMINAL_PATH = /^\/api\/terminals\/([0-9a-z]+)(?:\/(in|resize|close|image|paths|open))?$/;

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
  /** Each pair's files while it is analyzed (V90), by `pairKey`; dropped once its graph is. */
  const pairSites = new Map<string, SiteFiles>();
  /** The server's own hosts, once it listens. */
  const hosts = new Set<string>();
  let address = '';
  /**
   * Writes that must not overlap (V18c: two messages at once would make two sessions; one start at
   * a time), from the pages and from Symbiote's MCP alike.
   */
  const busy = new Set<string>();
  /** Terminals' output streams (V21), ended when the server closes. */
  const streams = new Set<ServerResponse>();
  const http = serverHttp({ hosts, busy, streams });
  const { sameSite, written, exclusive } = http;
  /** Nucleus's start without a Confirm (NU8): the person's setting with Hive mode over it. */
  const startSetting = options.nucleusStart
    ? nucleusStart(options.nucleusStart, options.hive)
    : undefined;
  /**
   * The page's one stream (V94a): the shell's state, the whole on connect, then what changed. Made
   * once the MCP is, whose asks it sends.
   */
  let events: EventStream | undefined;
  /** Symbiote's MCP (MC1): its tools over the repository's services; the asks it holds. */
  const mcp: SymbioteMcp | undefined = repository
    ? symbioteMcp(repository, {
        onAsks: () => events?.changed(['asks'], 'asks'),
        ...(options.version ? { version: options.version } : {}),
        ...(options.askMs ? { askMs: options.askMs } : {}),
        url: () => address,
        exclusive,
        // Nucleus's calls and their Confirms, in its activity (NU2, decision 607).
        ...(repository.nucleus?.record ? { record: repository.nucleus.record } : {}),
        // Its start without a Confirm: the person's setting, or Hive mode (NU8, decision 784).
        ...(startSetting ? { withoutConfirm: () => startSetting.why() } : {}),
      })
    : undefined;
  const log = options.log ?? silentLog();
  if (repository && options.events !== false) {
    // The page's six reads (decision 898), each as its own route answers it.
    const { workspaces, reviews, merges, nucleus, scribe } = repository;
    events = eventStream({
      read: {
        ...(workspaces ? { workspaces: () => workspaces.list() } : {}),
        ...(reviews ? { reviews: () => reviews.list() } : {}),
        ...(merges ? { merges: () => merges.list() } : {}),
        ...(nucleus ? { nucleus: () => nucleus.state() } : {}),
        ...(scribe ? { scribe: () => scribe.state() } : {}),
        ...(mcp ? { asks: () => Promise.resolve(mcp.asks()) } : {}),
      },
      ...(repository.recordFolders ? { roots: repository.recordFolders } : {}),
      // Terminals' output on the browser's one stream (V94b, decision 903).
      ...(repository.terminals ? { terminals: repository.terminals } : {}),
      // Changes from outside (V94c): git's refs, and Claude Code's list while an agent is live.
      ...(repository.gitDir ? { git: repository.gitDir } : {}),
      ...(repository.sessions ? { sessions: repository.sessions } : {}),
      ...(repository.codexStatus ? { codex: repository.codexStatus } : {}),
      log: log.log,
    });
  }
  const viewerFiles = await readViewer(options.viewerDir);
  const ctx: ServerContext = {
    options,
    repository,
    root,
    sites,
    opened,
    reviewSites,
    pairSites,
    hosts,
    busy,
    streams,
    log,
    viewerFiles,
    mcp,
  };
  const { requestLine, pageError } = serverLogs(ctx, http);
  const hive = serverHive(ctx, http);
  const { hiveApi, hiveState } = hive;
  const sitesOf = serverSites(ctx, { ...http, ...hive });
  const { serveSite, serveDiff, serveReview, reviewsApi, startDiff, stopDiff } = sitesOf;
  const { gitApi, checkoutTarget } = serverGit(http);
  const { introApi, monitorOpen } = serverPages(ctx, http);
  const { workspacesRoute, hiveRoute } = serverWorkspaces(ctx, { ...http, ...sitesOf });
  const { pageAgentRoute, mcpRoute } = serverNucleus(ctx, { ...http, ...sitesOf, ...hive });
  const { mergesRoute } = serverMerges(ctx, { ...http, ...sitesOf });
  const { terminalApi } = serverTerminals(ctx, http);
  /** Set once `close` starts: from then on the server answers nothing more (fix-ci-green). */
  let closing = false;
  const server = createServer((req, res) => {
    for (const [name, value] of Object.entries(GUARD_HEADERS)) res.setHeader(name, value);
    // Node keeps serving a connection that was busy when the server stopped listening, for as long
    // as it asks: the page's stream, answered and ended, asked again on it every second, and
    // `symbiote view` never ended on Ctrl+C (fix-ci-green). Closing, it answers nothing more, and a
    // connection goes once its last answer is sent.
    if (closing) {
      res.writeHead(503, { connection: 'close' });
      res.end();
      return;
    }
    res.once('close', () => {
      if (closing) setImmediate(() => server.closeIdleConnections());
    });
    const started = performance.now();
    let failure: unknown;
    res.once('close', () => {
      requestLine(req, res, performance.now() - started, failure);
      // A write this server answered: what it may have changed is read for the pages (V94a).
      if (events && req.method === 'POST' && res.statusCode < 400) {
        events.wrote(new URL(req.url ?? '/', 'http://localhost').pathname);
      }
    });
    handle(req, res).catch((error: unknown) => {
      failure = error;
      send(res, 500, String(error));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hosts.has(req.headers.host ?? '')) return send(res, 421, 'unknown host');
    if (fromAnotherSite(req)) return send(res, 403, "forbidden: another site's request");
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/logs') return pageError(req, res);
    if (events && url.pathname === '/api/events') {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      if (!sameSite(req)) return send(res, 403, 'forbidden');
      return events.open(req, res);
    }
    // A hook wrote (V94c, decision 905): a bare POST, its answer never waited for.
    if (events && url.pathname === '/api/events/ping') {
      const stream = events;
      return written(req, res, parseEventsPing, ({ kind }) => {
        stream.pinged(kind);
        res.writeHead(204);
        res.end();
        return Promise.resolve();
      });
    }
    if (events && url.pathname === '/api/events/listen') {
      const stream = events;
      return written(req, res, parseEventsListen, ({ stream: id, terminal, stop }) => {
        const listened = stream.listen(id, terminal, stop);
        if (listened === 'no-stream') {
          return Promise.resolve(send(res, 409, `no stream ${id}: listen on the one open now`));
        }
        if (listened === 'no-terminal') return Promise.resolve(send(res, 404, 'no such terminal'));
        res.writeHead(204);
        res.end();
        return Promise.resolve();
      });
    }
    if (url.pathname === '/api/intro' && options.intro) return introApi(req, res, options.intro);
    if (url.pathname === '/api/hive' && options.hive) return hiveApi(req, res, options.hive);
    if (url.pathname === '/api/hive/state' && options.hive) {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      const hive = options.hive;
      return answer(res, async () => {
        const [on, since, state, check] = await Promise.all([
          hive.on(),
          sinceOf(hive),
          hiveState(),
          // A check that cannot be read is none: the question says so (V92).
          options.hiveCheck?.().catch(() => null) ?? Promise.resolve(null),
        ]);
        return { on, ...(since ? { since } : {}), ...state, ...(check ? { check } : {}) };
      });
    }
    const landing = options.hiveLanding;
    if (landing && url.pathname === '/api/hive/landing') {
      if (req.method === 'GET') return read(req, res, () => landing.read());
      return written(req, res, parseLandsBy, ({ by }) => answer(res, () => landing.set(by)));
    }
    const pacing = options.hivePacing;
    if (pacing && url.pathname === '/api/hive/pacing') {
      if (req.method === 'GET') return read(req, res, () => pacing.read());
      return written(req, res, parseHivePacing, (change) => answer(res, () => pacing.set(change)));
    }
    const reviewer = options.hiveReviewer;
    if (reviewer && url.pathname === '/api/hive/reviewer/efforts') {
      return read(req, res, () => reviewer.efforts());
    }
    if (reviewer && url.pathname === '/api/hive/reviewer/effort') {
      return written(req, res, parseEffortChange, (change) =>
        answer(res, () => reviewer.setEffort(change)),
      );
    }
    if (reviewer && url.pathname === '/api/hive/reviewer/model') {
      return written(req, res, parseModelChange, (change) =>
        answer(res, () => reviewer.setModel(change)),
      );
    }
    if (repository) return repositoryRoute(req, res, url, repository);
    return serveSite(req, res, url, url.pathname, root);
  }

  /**
   * `symbiote view`'s addresses: a diff's and a branch review's pages, History and the
   * repository's state, the shell's pages, then each service's API (`/api/workspaces…`,
   * `/api/nucleus…`, `/api/merges…`); any other, as without a repository.
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
    // Git (V66); History's old address too, which the page moves to /git.
    if (url.pathname === '/git' || url.pathname === '/history')
      return serveSite(req, res, url, '/', undefined);
    // The Overview (V91), a page of the shell's, the one `/` opens.
    if (url.pathname === '/overview') return serveSite(req, res, url, '/', undefined);
    if (url.pathname === '/api/history') return historyRows(req, res, url, repository);
    if (url.pathname === '/api/history/shape') return historyShape(req, res, url, repository);
    if (url.pathname === '/api/history/refs') return historyRefs(req, res, url, repository);
    if (url.pathname === '/api/history/rows') return historyRowsOf(req, res, url, repository);
    if (url.pathname.startsWith('/api/git/') && repository.git)
      return gitApi(req, res, url, repository, repository.git);
    if (url.pathname === '/api/status') return read(req, res, () => repository.status());
    if (url.pathname === '/api/refs') return read(req, res, () => repository.refs());
    if (url.pathname === '/api/checkout') return checkoutTarget(req, res, repository);
    // The kept graphs' findings, counted (V93, decision 892): a workspace's row by its tip.
    if (url.pathname === '/api/workspaces/findings') {
      return read(req, res, () => Promise.resolve({ graphs: repository.diffs.findings() }));
    }
    if (url.pathname === '/api/diffs') return startDiff(req, res, repository);
    if (url.pathname === '/api/diffs/stop') return stopDiff(req, res, repository);
    if (mcp && url.pathname.startsWith('/api/mcp')) return mcpRoute(req, res, url, mcp);
    // Settings' switch (NU8, decision 782): the person's alone, never an MCP tool's.
    if (startSetting && url.pathname === '/api/nucleus/start-confirm') {
      if (req.method === 'GET') return answer(res, () => startSetting.read());
      return written(req, res, parseHiveChange, ({ on }) =>
        answer(res, async () => {
          await startSetting.set(on);
          return startSetting.read();
        }),
      );
    }
    const {
      workspaces,
      nucleus,
      scribe,
      skills,
      monitor,
      issues,
      settings,
      checks,
      usage,
      merges,
    } = repository;
    if (workspaces) {
      // The workspaces view's old addresses (V18b, `/workspaces` before it); the viewer moves
      // them to `/`.
      if (url.pathname === '/workspaces' || url.pathname === '/features')
        return serveSite(req, res, url, '/', undefined);
      // Start a workspace, a page of the shell's (V30a).
      if (url.pathname === '/start') return serveSite(req, res, url, '/', undefined);
      // History, the finished workspaces (V77), a page of the shell's.
      if (url.pathname === '/workspace-history') return serveSite(req, res, url, '/', undefined);
      // The Overview's day (V91): a `since` that is not a time is the page's mistake.
      if (repository.day && url.pathname === '/api/workspaces/day') {
        const since = url.searchParams.get('since') ?? '';
        if (!Number.isFinite(Date.parse(since))) return send(res, 400, 'since is not a time');
        const { day } = repository;
        return read(req, res, () => day.read(since));
      }
      const hiveTab = repository.hiveWorkspace;
      if (hiveTab && url.pathname.startsWith('/api/workspaces/hive')) {
        return hiveRoute(req, res, url, hiveTab);
      }
      if (url.pathname.startsWith('/api/workspaces'))
        return workspacesRoute(req, res, url, workspaces);
    }
    // Nucleus's page, a page of the shell's (V35); the shell moves `/scout` to it (NU1).
    if (nucleus && (url.pathname === '/nucleus' || url.pathname === '/scout')) {
      return serveSite(req, res, url, '/', undefined);
    }
    if (nucleus && url.pathname.startsWith('/api/nucleus')) {
      return pageAgentRoute(req, res, url, nucleus, {
        api: '/api/nucleus',
        busy: 'Nucleus is being asked',
        // Said in Alpha Ceph's name while Hive mode is on (decision 682).
        hiveBusy: `${NUCLEUS_NAMES.hive} is being asked`,
      });
    }
    // Scribe (V41), on the Skills page: Nucleus's conversation, its own agent.
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
      // A skill's SKILL.md opened in VS Code (V64).
      if (url.pathname === '/api/skills/open') {
        return written(req, res, parseSkillOpen, (request) =>
          answer(res, () => skills.open(request)),
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
    if (issues) {
      // The Issues page (IS1), a page of the shell's, and its reads.
      if (url.pathname === '/issues') return serveSite(req, res, url, '/', undefined);
      if (url.pathname === '/api/issues') return issueList(req, res, url, issues);
      const one = /^\/api\/issues\/([^/]*)$/.exec(url.pathname);
      if (one) return issueOne(req, res, one[1] ?? '', issues);
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
    // The check (fix/settings-page): `merge.checks`, or the one Symbiote finds.
    if (checks && url.pathname === '/api/settings/checks') {
      if (req.method === 'GET') return answer(res, () => checks.read());
      return written(req, res, parseCheckChange, (change) => answer(res, () => checks.set(change)));
    }
    if (merges && url.pathname.startsWith('/api/merges')) {
      return mergesRoute(req, res, url, merges, repository.workspaces);
    }
    const terminal = repository.terminals ? TERMINAL_PATH.exec(url.pathname) : null;
    if (terminal && repository.terminals) {
      const [, id = '', action] = terminal;
      return terminalApi(req, res, repository.terminals, id, action);
    }
    return serveSite(req, res, url, url.pathname, root);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) hosts.add(host);
  address = `http://127.0.0.1:${port}/`;
  return {
    url: address,
    close: async () => {
      closing = true;
      // A held call or wait would keep its connection, and the server, open.
      mcp?.close();
      // The page's stream ends, and every timer and listener it holds (V94a).
      events?.close();
      // Open streams would keep the server from closing: the terminals end them.
      repository?.terminals?.closeAll();
      for (const stream of streams) stream.end();
      // Nucleus's and Scribe's reads of Codex stop, and what they write finishes.
      await Promise.all([repository?.nucleus?.close?.(), repository?.scribe?.close?.()]);
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * The built viewer's files by path, read once as the server starts (2.1 MB, 3 ms): a build under
 * a running `symbiote view` (a merge's, in the checkout it serves) would otherwise hand this older
 * server a page calling routes it lacks, and take away the chunks of a page opened before it
 * (fix/suggest-settings-models). A file it cannot read is missing, as it was when asked for.
 */
async function readViewer(dir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const path = join(entry.parentPath, entry.name);
        const body = await readFile(path).catch(() => undefined);
        if (body) files.set(path, body);
      }),
  );
  return files;
}
