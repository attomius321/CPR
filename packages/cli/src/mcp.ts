// Symbiote's MCP (MC1): Symbiote's services as tools, for Scout and for the person's own agents
// (`symbiote mcp`), answered in `symbiote view`'s process at `POST /api/mcp` and reached through a
// stdio bridge (`mcp-bridge.ts`, decision 358). The protocol's few methods by hand (decision 359).
// A tool that changes a branch's fate waits for the person's Confirm on Symbiote's pages, 10 minutes
// at most (an ask, decision 361); the others run at once.
import {
  AGENT_KINDS,
  WORK_KINDS,
  type AgentKind,
  type BranchReviewInfo,
  type Graph,
  type McpAnswer,
  type McpAsk,
  type McpAsks,
  type McpCaller,
  type MergeEntry,
  type RepoStatus,
  type WorkspaceRequest,
  type WorkspaceSummary,
} from '@symbiote/core';
import type { CodeMap } from '@symbiote/monitor';
import { AGENT_NAMES } from './agent-levels.js';
import type { DiffStatus, Pair } from './diffs.js';
import type { Merger } from './merges.js';
import type { BranchReviews } from './reviews.js';
import { parseLocalReview, parseWorkspaceRequest, sourceFiles } from './server-requests.js';
import type { UsageService } from './usage.js';
import type { Workspaces } from './workspaces.js';

/** The protocol version answered to a client that names none. */
const LATEST_PROTOCOL = '2025-06-18';

/** How long an ask waits for the person; then nothing is done. */
const ASK_MS = 10 * 60_000;
/** How long `review` and `finish_review` wait for an analysis. */
const ANALYSIS_MS = 60_000;
/** How often `wait` and an analysis's wait read Symbiote's state. */
const POLL_MS = 2_000;
/** Most `wait` waits, in minutes. */
const MAX_WAIT = 10;

/** What the tools are given: `symbiote view`'s services (`RepositoryOptions`). */
export interface McpServices {
  /** The repository's folder name. */
  name?: string;
  status(): Promise<RepoStatus>;
  readFile(sha: string, path: string): Promise<string>;
  diffs: { start(pair: Pair): void; status(pair: Pair): DiffStatus | undefined };
  workspaces?: Pick<
    Workspaces,
    | 'list'
    | 'options'
    | 'changes'
    | 'merge'
    | 'thread'
    | 'reply'
    | 'stopAgent'
    | 'startAgent'
    | 'start'
    | 'clean'
  >;
  reviews?: Pick<BranchReviews, 'list' | 'resolve' | 'finish'>;
  merges?: Pick<
    Merger,
    | 'list'
    | 'targets'
    | 'enqueue'
    | 'land'
    | 'retry'
    | 'recheck'
    | 'remove'
    | 'approve'
    | 'requestChanges'
    | 'log'
  >;
  usage?: Pick<UsageService, 'report'>;
  monitor?: { map(): Promise<CodeMap> };
}

export interface McpOptions {
  /** Symbiote's version, as it introduces itself. */
  version?: string;
  /** The server's address (`http://127.0.0.1:<port>/`), for a review page's link. */
  url?: () => string;
  now?: () => Date;
  askMs?: number;
  analysisMs?: number;
  pollMs?: number;
  /** A minute of `wait`'s, shorter in tests. */
  minuteMs?: number;
  /**
   * Runs `task` unless a write with the same `words` runs (the server's one-at-a-time rule, shared
   * with its pages); rejects with `McpRefused` meanwhile.
   */
  exclusive?: <T>(words: string, task: () => Promise<T>) => Promise<T>;
}

/** An ask or a write the server cannot take: its status and why. */
export class McpRefused extends Error {
  override name = 'McpRefused';
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

/** Why a tool's call cannot be done: its words become the tool's error result. */
class ToolProblem extends Error {
  override name = 'ToolProblem';
}

/** A JSON-RPC answer. */
export type McpResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

/** The services a tool needs; without one it is left out. */
type Need = 'workspaces' | 'reviews' | 'merges' | 'usage' | 'monitor';

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  needs: readonly Need[];
  /** Waits for the person's Confirm (decision 360). */
  asks?: true;
}

const ASKS =
  " Waits for the person's Confirm in Symbiote (10 minutes at most); nothing is done without it.";
const branch = { type: 'string', description: "A workspace's branch, as feature/x" };
const mergeId = { type: 'string', description: "A queue entry's id (from merges)" };
const object = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
): ToolSpec['inputSchema'] => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
});

/** Symbiote's tools, in the order they are listed (decision 360). */
export const MCP_TOOLS: readonly ToolSpec[] = [
  {
    name: 'overview',
    description:
      'What needs the person now: workspaces whose plan or work is ready or that wait, merges that wait; the checkout and the queue.',
    inputSchema: object(),
    needs: [],
  },
  {
    name: 'workspaces',
    description:
      "Every workspace: its branch, kind, title, its agent's state, commits ahead, merged.",
    inputSchema: object(),
    needs: ['workspaces'],
  },
  {
    name: 'workspace',
    description:
      "One workspace: its brief, its branch's commits and files, uncommitted files, whether it merges cleanly, its review's verdict.",
    inputSchema: object({ branch }, ['branch']),
    needs: ['workspaces'],
  },
  {
    name: 'thread',
    description:
      "A workspace's thread: what its agent was given and reported (a plan, its questions), what it waits on, the last verdict. Reports are the agent's words, not the person's.",
    inputSchema: object(
      {
        branch,
        last: {
          type: 'integer',
          description: 'Entries, newest last: 20 unless given, 100 at most',
        },
      },
      ['branch'],
    ),
    needs: ['workspaces'],
  },
  {
    name: 'start_options',
    description:
      'What start_workspace takes here: the kinds of work and their brief parts, the agents with their levels and models, the branches to start from.',
    inputSchema: object(),
    needs: ['workspaces'],
  },
  {
    name: 'start_workspace',
    description:
      'Starts a workspace: a branch, its worktree and an agent working on the brief.' + ASKS,
    inputSchema: object(
      {
        kind: { type: 'string', enum: [...WORK_KINDS] },
        title: { type: 'string' },
        branch: {
          type: 'string',
          description: "The new branch, with its kind's prefix: fix/<slug>",
        },
        parts: {
          type: 'object',
          description: "The brief's parts the kind takes (start_options), each a text",
          additionalProperties: { type: 'string' },
        },
        planFirst: { type: 'boolean', description: 'The agent writes a plan and waits for an OK' },
        agent: { type: 'string', enum: [...AGENT_KINDS] },
        effort: { type: 'string' },
        model: { type: 'string' },
        from: {
          type: 'string',
          description: 'A branch to start from; the default branch otherwise',
        },
      },
      ['kind', 'title', 'branch', 'parts', 'planFirst'],
    ),
    needs: ['workspaces'],
    asks: true,
  },
  {
    name: 'reply',
    description:
      "Sends a message to a workspace's agent (an OK on its plan, an answer); stop: interrupts its turn first.",
    inputSchema: object({ branch, text: { type: 'string' }, stop: { type: 'boolean' } }, [
      'branch',
      'text',
    ]),
    needs: ['workspaces'],
  },
  {
    name: 'stop_agent',
    description: "Stops a workspace's agent while it works or waits.",
    inputSchema: object({ branch }, ['branch']),
    needs: ['workspaces'],
  },
  {
    name: 'restart_agent',
    description: "Starts a workspace's agent again, after it failed or ended." + ASKS,
    inputSchema: object({ branch }, ['branch']),
    needs: ['workspaces'],
    asks: true,
  },
  {
    name: 'clean_workspace',
    description:
      "Cleans a workspace up: its agent's sessions, its worktree, and its branch once merged; unmerged: true for a branch not merged (it stays)." +
      ASKS,
    inputSchema: object({ branch, unmerged: { type: 'boolean' } }, ['branch']),
    needs: ['workspaces'],
    asks: true,
  },
  {
    name: 'review',
    description:
      "A branch's change as Symbiote's graph, from its fork point to its tip: symbols changed by kind, every finding in the detector's words, the most-used changed symbols, the review's verdict and page. Waits up to a minute for the analysis.",
    inputSchema: object({ branch }, ['branch']),
    needs: ['reviews'],
  },
  {
    name: 'finish_review',
    description:
      "Records the person's verdict on a branch at its reviewed tip: approve (to be merged into the default branch), request-changes or comment, with a summary and comments on changed symbols (a line: path, line, side)." +
      ASKS,
    inputSchema: object(
      {
        branch,
        event: { type: 'string', enum: ['approve', 'request-changes', 'comment'] },
        summary: { type: 'string' },
        comments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: 'A symbol id from review' },
              body: { type: 'string' },
              path: { type: 'string' },
              line: { type: 'integer' },
              side: { type: 'string', enum: ['head', 'base'] },
            },
            required: ['symbol', 'body'],
          },
        },
      },
      ['branch', 'event', 'summary'],
    ),
    needs: ['reviews'],
    asks: true,
  },
  {
    name: 'merges',
    description:
      "The merge queue: each entry's branch, target, state, check and the merger's resolution; with branch, also where it can merge and why not.",
    inputSchema: object({ branch: { type: 'string' } }),
    needs: ['merges'],
  },
  {
    name: 'merge_log',
    description: "A queued merge's log: its steps and the check's output, the last lines.",
    inputSchema: object(
      {
        id: mergeId,
        last: { type: 'integer', description: 'Lines: 60 unless given, 400 at most' },
      },
      ['id'],
    ),
    needs: ['merges'],
  },
  {
    name: 'queue_merge',
    description:
      "Queues a branch's approved commit to be merged, checked and landed into a branch (its default target unless given)." +
      ASKS,
    inputSchema: object({ branch, into: { type: 'string' } }, ['branch']),
    needs: ['merges'],
    asks: true,
  },
  {
    name: 'land_merge',
    description:
      'Lands a merge that is ready: the target branch moves to it (and is pushed when the project says).' +
      ASKS,
    inputSchema: object({ id: mergeId }, ['id']),
    needs: ['merges'],
    asks: true,
  },
  {
    name: 'merge_resolution',
    description:
      "Answers the merger's resolution of a merge's conflicts: approve: true lands it; false asks the merger again with comments." +
      ASKS,
    inputSchema: object(
      { id: mergeId, approve: { type: 'boolean' }, comments: { type: 'string' } },
      ['id', 'approve'],
    ),
    needs: ['merges'],
    asks: true,
  },
  {
    name: 'retry_merge',
    description: 'Queues a failed or stopped merge again.' + ASKS,
    inputSchema: object({ id: mergeId }, ['id']),
    needs: ['merges'],
    asks: true,
  },
  {
    name: 'recheck_merge',
    description: "Runs a merge's failed check again on the same merge." + ASKS,
    inputSchema: object({ id: mergeId }, ['id']),
    needs: ['merges'],
    asks: true,
  },
  {
    name: 'remove_merge',
    description: 'Takes an entry out of the queue, with its log.' + ASKS,
    inputSchema: object({ id: mergeId }, ['id']),
    needs: ['merges'],
    asks: true,
  },
  {
    name: 'usage',
    description: "Each agent subscription's windows of use: whether another agent's work fits now.",
    inputSchema: object(),
    needs: ['usage'],
  },
  {
    name: 'code_map',
    description: "Where the checkout's code is: lines of code by folder, largest first.",
    inputSchema: object({
      folder: { type: 'string', description: 'A repo-relative folder; the root unless given' },
    }),
    needs: ['monitor'],
  },
  {
    name: 'wait',
    description:
      "Waits until a workspace's agent or a merge changes state, or the minutes pass (10 at most), and says what changed. Only when the person asked to watch.",
    inputSchema: object({ minutes: { type: 'integer', minimum: 1, maximum: MAX_WAIT } }),
    needs: [],
  },
];

type Args = Record<string, unknown>;

const short = (sha: string) => sha.slice(0, 7);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function words(args: Args, key: string, what: string, max = 20_000): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new ToolProblem(`${key}: ${what}`);
  }
  return value;
}
const branchOf = (args: Args) => words(args, 'branch', "a workspace's branch", 255);
const idOf = (args: Args) => words(args, 'id', "a queue entry's id (from merges)", 100);

function flag(args: Args, key: string): boolean {
  const value = args[key];
  if (value !== undefined && typeof value !== 'boolean')
    throw new ToolProblem(`${key}: true or false`);
  return value === true;
}

function count(args: Args, key: string, fallback: number, max: number, what: string): number {
  const value = args[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new ToolProblem(`${key}: ${what}`);
  }
  return value;
}

/** A workspace as a list gives it: no brief, no paths. */
function row(w: WorkspaceSummary) {
  const { state, kind, waitingFor, interrupted, error } = w.agent;
  return {
    branch: w.branch,
    ...(w.kind ? { kind: w.kind } : {}),
    ...(w.title ? { title: w.title } : {}),
    agent: {
      state,
      ...(kind ? { kind } : {}),
      ...(waitingFor ? { waitingFor } : {}),
      ...(interrupted ? { interrupted } : {}),
      ...(error ? { error } : {}),
    },
    planFirst: w.planFirst,
    ahead: w.ahead,
    merged: w.merged,
    created: w.created,
    ...(w.lastAction ? { lastAction: w.lastAction } : {}),
    ...(w.worktree.exists ? {} : { worktree: 'gone' }),
    ...(w.worktree.changed ? { uncommitted: w.worktree.changed } : {}),
    ...(w.via ? { via: w.via } : {}),
  };
}

/** A queue entry without its resolution's text or the check's whole output. */
function mergeRow(e: MergeEntry) {
  return {
    id: e.id,
    branch: e.branch,
    head: e.head,
    into: e.into,
    state: e.state,
    title: e.title,
    updated: e.updated,
    ...(e.merge ? { merge: e.merge } : {}),
    ...(e.message ? { message: e.message } : {}),
    ...(e.conflicts ? { conflicts: e.conflicts } : {}),
    ...(e.check
      ? {
          check: {
            commands: e.check.commands,
            ...(e.check.ok !== undefined ? { ok: e.check.ok } : {}),
            ...(e.check.failed ? { failed: e.check.failed } : {}),
            ...(e.check.ok === false && e.check.output
              ? { output: e.check.output.split('\n').slice(-20).join('\n') }
              : {}),
          },
        }
      : {}),
    ...(e.resolution
      ? {
          resolution: {
            agent: e.resolution.agent,
            regions: e.resolution.regions.map((r) => ({
              path: r.path,
              line: r.line,
              ...(r.note ? { note: r.note } : {}),
            })),
            ...(e.resolution.needsYou ? { needsYou: e.resolution.needsYou } : {}),
          },
        }
      : {}),
    ...(e.landed ? { landed: e.landed } : {}),
    ...(e.pushed ? { pushed: e.pushed } : {}),
  };
}

/** Workspace states that wait on the person, and merge states. */
const WORKSPACE_NEEDS = new Set(['plan-ready', 'needs-you', 'ready', 'failed', 'not-started']);
const MERGE_NEEDS = new Set(['needs-you', 'ready', 'failed']);

/** A branch's graph as `review` answers it (decision 363): no lines, the decisions. */
function reviewOf(graph: Graph) {
  const users = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue;
    const set = users.get(edge.to) ?? new Set<string>();
    set.add(edge.from);
    users.set(edge.to, set);
  }
  const changed = graph.nodes
    .filter((n) => n.status !== 'unchanged')
    .map((n) => {
      const side = n.head ?? n.base;
      const delta = n.delta
        ? (['signature', 'body', 'moved'] as const).filter((k) => n.delta?.[k])
        : [];
      return {
        id: n.id,
        kind: n.kind,
        status: n.status,
        ...(delta.length > 0 ? { delta } : {}),
        ...(n.exported ? { exported: true } : {}),
        users: users.get(n.id)?.size ?? 0,
        ...(side ? { at: `${side.file}:${side.range.start.line}` } : {}),
      };
    })
    .sort((a, b) => b.users - a.users || a.id.localeCompare(b.id));
  const findings = graph.findings.map((f) => ({
    id: f.id,
    severity: f.severity,
    rule: f.rule,
    symbol: f.symbol,
    message: f.message,
    related: f.related.length,
  }));
  return {
    stats: graph.stats,
    findings: findings.slice(0, 50),
    ...(findings.length > 50 ? { moreFindings: findings.length - 50 } : {}),
    changed: changed.slice(0, 30),
    ...(changed.length > 30 ? { moreChanged: changed.length - 30 } : {}),
    files: graph.files.slice(0, 50).map((f) => ({
      path: f.path,
      status: f.status,
      ...(f.ignored ? { ignored: true } : {}),
    })),
    ...(graph.files.length > 50 ? { moreFiles: graph.files.length - 50 } : {}),
    ...(graph.warnings.length > 0 ? { warnings: graph.warnings.slice(0, 10) } : {}),
  };
}

/** How long, in words: "12 s", "3 min". */
const elapsed = (ms: number) =>
  ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;

/** Resolves after `ms`, or when `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });
}

/** An asked call's way to the person: its words, then what to do on the yes. */
interface Prepared {
  words: string;
  act: () => Promise<unknown>;
}

/** An ask held for the person (decision 361). */
interface Held {
  ask: McpAsk;
  settle(answer: 'yes' | 'no' | 'expired' | 'gone'): void;
}

const callerKey = (c: McpCaller) =>
  c.via === 'scout' ? 'scout' : `mcp\u0000${c.client ?? ''}\u0000${c.folder ?? ''}`;

export interface SymbioteMcp {
  /** One JSON-RPC message from `caller`; null for a notification, or once `signal` aborted. */
  handle(message: unknown, caller: McpCaller, signal?: AbortSignal): Promise<McpResponse | null>;
  /** The asks waiting for the person, oldest first. */
  asks(): McpAsks;
  /** The person's answer to an ask; rejects with `McpRefused` (404) for one not held. */
  answer(answer: McpAnswer): McpAsks;
  /** Ends every held call and wait: the server closes. */
  close(): void;
}

/** Symbiote's tools over `services` (decision 358). */
export function symbioteMcp(services: McpServices, options: McpOptions = {}): SymbioteMcp {
  const {
    version = '0.0.0',
    url = () => '/',
    now = () => new Date(),
    askMs = ASK_MS,
    analysisMs = ANALYSIS_MS,
    pollMs = POLL_MS,
    minuteMs = 60_000,
  } = options;
  const busy = new Set<string>();
  const exclusive =
    options.exclusive ??
    (async <T>(what: string, task: () => Promise<T>): Promise<T> => {
      if (busy.has(what)) throw new McpRefused(what, 409);
      busy.add(what);
      try {
        return await task();
      } finally {
        busy.delete(what);
      }
    });
  const held = new Map<string, Held>();
  const closing = new AbortController();
  let asked = 0;

  const available = (tool: ToolSpec) => tool.needs.every((need) => services[need] !== undefined);
  const tools = MCP_TOOLS.filter(available);

  function service<K extends Need>(need: K): NonNullable<McpServices[K]> {
    const found = services[need];
    if (!found) throw new ToolProblem(`Symbiote has no ${need} here`);
    return found;
  }

  /** Waits for the person's answer to `words`, for `caller`. */
  function ask(tool: string, words: string, caller: McpCaller, signal: AbortSignal) {
    const key = callerKey(caller);
    if ([...held.values()].some((h) => callerKey(h.ask.by) === key)) {
      throw new ToolProblem(
        'An ask of yours waits for the person already: wait for their answer, then ask again',
      );
    }
    const at = now();
    const ask: McpAsk = {
      id: `a${++asked}-${at.getTime().toString(36)}`,
      tool,
      words,
      by: caller,
      at: at.toISOString(),
      until: new Date(at.getTime() + askMs).toISOString(),
    };
    return new Promise<'yes' | 'no' | 'expired' | 'gone'>((resolve) => {
      const timer = setTimeout(() => settle('expired'), askMs);
      const gone = () => settle('gone');
      function settle(answer: 'yes' | 'no' | 'expired' | 'gone') {
        clearTimeout(timer);
        signal.removeEventListener('abort', gone);
        held.delete(ask.id);
        resolve(answer);
      }
      if (signal.aborted) return settle('gone');
      signal.addEventListener('abort', gone);
      held.set(ask.id, { ask, settle });
    });
  }

  async function workspaceOf(branch: string): Promise<WorkspaceSummary> {
    const { workspaces } = await service('workspaces').list();
    const found = workspaces.find((w) => w.branch === branch);
    if (!found) throw new ToolProblem(`no workspace ${branch}`);
    return found;
  }

  async function entryOf(id: string): Promise<MergeEntry> {
    const { merges } = await service('merges').list();
    const found = merges.find((e) => e.id === id);
    if (!found) throw new ToolProblem(`no merge ${id}`);
    return found;
  }

  /** A branch's review and its graph once analyzed, or how far the analysis is. */
  async function analyzed(
    branch: string,
    signal: AbortSignal,
  ): Promise<{ info: BranchReviewInfo; pair: Pair; graph?: Graph; pending?: DiffStatus }> {
    const { info, pair } = await service('reviews').resolve(branch);
    services.diffs.start(pair);
    const until = Date.now() + analysisMs;
    for (;;) {
      const status = services.diffs.status(pair);
      if (status?.status === 'done') return { info, pair, graph: status.graph };
      if (status?.status === 'failed') {
        throw new ToolProblem(`the analysis of ${branch} failed: ${status.error}`);
      }
      if (Date.now() >= until || signal.aborted)
        return { info, pair, ...(status ? { pending: status } : {}) };
      await sleep(pollMs, signal);
    }
  }

  /** What every state is now, for `wait`. */
  async function states(): Promise<{
    workspaces: Map<string, string>;
    merges: Map<string, { branch: string; state: string }>;
  }> {
    const [list, queue] = await Promise.all([services.workspaces?.list(), services.merges?.list()]);
    return {
      workspaces: new Map((list?.workspaces ?? []).map((w) => [w.branch, w.agent.state])),
      merges: new Map(
        (queue?.merges ?? []).map((e) => [e.id, { branch: e.branch, state: e.state }]),
      ),
    };
  }

  const via = (caller: McpCaller) => caller.via;

  /** The tools that run at once. */
  const reads: Record<
    string,
    (args: Args, caller: McpCaller, signal: AbortSignal) => Promise<unknown>
  > = {
    async overview() {
      const [status, list, queue] = await Promise.all([
        services.status(),
        services.workspaces?.list(),
        services.merges?.list(),
      ]);
      const workspaces = list?.workspaces ?? [];
      const merges = (queue?.merges ?? []).filter((e) => e.state !== 'landed');
      const counts: Record<string, number> = {};
      for (const w of workspaces) counts[w.agent.state] = (counts[w.agent.state] ?? 0) + 1;
      const open = [...held.values()].map((h) => h.ask.words);
      return {
        ...(services.name ? { repository: services.name } : {}),
        checkout: {
          branch: status.branch,
          head: status.head,
          changed: status.changed,
          ...(status.operation ? { operation: status.operation } : {}),
        },
        needsYou: [
          ...workspaces
            .filter((w) => WORKSPACE_NEEDS.has(w.agent.state))
            .map((w) => ({
              workspace: w.branch,
              state: w.agent.state,
              ...(w.agent.waitingFor ? { waitingFor: w.agent.waitingFor } : {}),
              ...(w.agent.error ? { error: w.agent.error } : {}),
            })),
          ...merges
            .filter((e) => MERGE_NEEDS.has(e.state))
            .map((e) => ({
              merge: e.id,
              branch: e.branch,
              state: e.state,
              ...(e.message ? { message: e.message } : {}),
            })),
        ],
        workspaces: counts,
        merges: merges.map((e) => ({ id: e.id, branch: e.branch, into: e.into, state: e.state })),
        ...(open.length > 0 ? { asks: open } : {}),
      };
    },

    async workspaces() {
      const { workspaces } = await service('workspaces').list();
      return { workspaces: workspaces.map(row) };
    },

    async workspace(args) {
      const branch = branchOf(args);
      const w = await workspaceOf(branch);
      const ws = service('workspaces');
      const [changes, merge, reviews] = await Promise.all([
        ws.changes(branch),
        ws.merge(branch).catch((error: Error) => ({ error: error.message })),
        services.reviews?.list().catch(() => null),
      ]);
      const review = reviews?.reviews.find((r) => r.branch === branch);
      return {
        ...row(w),
        ...(w.from ? { from: w.from } : {}),
        base: w.base,
        tip: w.tip,
        brief: w.brief,
        ...(w.documents ? { documents: w.documents.files } : {}),
        commits: changes.commits,
        files: { ...changes.files, listed: changes.files.listed.slice(0, 100) },
        ...(changes.uncommitted ? { uncommitted: changes.uncommitted } : {}),
        merge,
        ...(review
          ? {
              review: {
                marks: review.marks,
                ...(review.verdict ? { verdict: review.verdict } : {}),
              },
            }
          : {}),
      };
    },

    async thread(args) {
      const branch = branchOf(args);
      const last = count(args, 'last', 20, 100, 'a count from 1 to 100');
      const thread = await service('workspaces').thread(branch);
      const cut = (text: string) => (text.length > 4000 ? `${text.slice(0, 4000)} […]` : text);
      return {
        recorded: thread.recorded,
        entries: thread.entries
          .slice(-last)
          .map((e) => ('text' in e ? { ...e, text: cut(e.text) } : e)),
        ...(thread.verdict ? { verdict: thread.verdict } : {}),
      };
    },

    async start_options() {
      const o = await service('workspaces').options();
      return {
        base: o.base,
        branches: o.branches.slice(0, 50),
        branchPrefixes: o.branchPrefixes,
        kinds: o.kinds,
        agents: o.agents,
        maxBrief: o.maxBrief,
      };
    },

    async reply(args) {
      const branch = branchOf(args);
      const text = words(args, 'text', 'the message for the agent');
      const stop = flag(args, 'stop');
      const replied = await exclusive('a message is being sent', () =>
        service('workspaces').reply({ branch, text, ...(stop ? { stop: true } : {}) }),
      );
      return { workspace: row(replied.workspace), ...(replied.copy ? { copy: replied.copy } : {}) };
    },

    async stop_agent(args) {
      const branch = branchOf(args);
      const stopped = await service('workspaces').stopAgent(branch);
      return { workspace: row(stopped.workspace) };
    },

    async review(args, _caller, signal) {
      const branch = branchOf(args);
      const { info, graph, pending } = await analyzed(branch, signal);
      const head = {
        branch: info.branch,
        base: info.base,
        head: info.head,
        ...(info.into ? { into: info.into } : {}),
        ...(info.reviewed ? { reviewed: info.reviewed, since: info.since } : {}),
        ...(info.verdict ? { verdict: info.verdict } : {}),
        page: `${url()}review/${encodeURIComponent(info.branch)}/`,
      };
      if (!graph) {
        const how =
          pending?.status === 'running'
            ? { analyzing: pending.phase ?? 'starting', elapsedMs: pending.elapsedMs }
            : pending?.status === 'queued'
              ? { analyzing: `queued, ${pending.queued} before it`, elapsedMs: pending.elapsedMs }
              : { analyzing: 'starting', elapsedMs: 0 };
        return {
          ...head,
          ...how,
          note: `Symbiote is still analyzing ${branch} (${elapsed(how.elapsedMs)} so far): call review again in a minute.`,
        };
      }
      return { ...head, ...reviewOf(graph) };
    },

    async merges(args) {
      const merger = service('merges');
      const branch = args.branch === undefined ? undefined : branchOf(args);
      const [{ merges }, targets] = await Promise.all([
        merger.list(),
        branch ? merger.targets(branch) : Promise.resolve(undefined),
      ]);
      return {
        merges: merges.map(mergeRow),
        ...(targets
          ? {
              targets: {
                branches: targets.branches,
                into: targets.into,
                ...(targets.head ? { head: targets.head } : {}),
                ...(targets.blocked ? { blocked: targets.blocked } : {}),
              },
            }
          : {}),
      };
    },

    async merge_log(args) {
      const id = idOf(args);
      const last = count(args, 'last', 60, 400, 'a count from 1 to 400');
      const read = await service('merges').log(id, 0);
      if (!read) throw new ToolProblem(`no merge ${id}`);
      return { lines: read.lines.slice(-last), of: read.lines.length };
    },

    async usage() {
      return service('usage').report();
    },

    async code_map(args) {
      const folder =
        args.folder === undefined ? '' : words(args, 'folder', 'a repo-relative folder', 1000);
      const prefix = folder.replace(/^\.?\/+|\/+$/g, '');
      const map = await service('monitor').map();
      const groups = new Map<
        string,
        { folder: string; files: number; code: number; lines: number }
      >();
      for (const file of map.files) {
        if (file.kind === 'aside') continue;
        if (prefix && !file.path.startsWith(`${prefix}/`)) continue;
        const rest = prefix ? file.path.slice(prefix.length + 1) : file.path;
        const name = rest.split('/')[0] ?? rest;
        const key = prefix ? `${prefix}/${name}` : name;
        const group = groups.get(key) ?? { folder: key, files: 0, code: 0, lines: 0 };
        group.files += 1;
        group.code += file.code;
        group.lines += file.lines;
        groups.set(key, group);
      }
      return {
        commit: map.commit,
        ...(map.branch ? { branch: map.branch } : {}),
        folders: [...groups.values()].sort((a, b) => b.code - a.code).slice(0, 30),
      };
    },

    async wait(args, _caller, signal) {
      const minutes = count(args, 'minutes', MAX_WAIT, MAX_WAIT, `from 1 to ${MAX_WAIT}`);
      const before = await states();
      const until = Date.now() + minutes * minuteMs;
      while (Date.now() < until && !signal.aborted) {
        await sleep(Math.min(pollMs, Math.max(0, until - Date.now())), signal);
        if (signal.aborted) break;
        const after = await states();
        const changed: Record<string, unknown>[] = [];
        for (const [branch, state] of after.workspaces) {
          const was = before.workspaces.get(branch) ?? null;
          if (was !== state) changed.push({ workspace: branch, was, now: state });
        }
        for (const [branch, was] of before.workspaces) {
          if (!after.workspaces.has(branch)) changed.push({ workspace: branch, was, now: null });
        }
        for (const [id, entry] of after.merges) {
          const was = before.merges.get(id)?.state ?? null;
          if (was !== entry.state) {
            changed.push({ merge: id, branch: entry.branch, was, now: entry.state });
          }
        }
        for (const [id, entry] of before.merges) {
          if (!after.merges.has(id)) {
            changed.push({ merge: id, branch: entry.branch, was: entry.state, now: null });
          }
        }
        if (changed.length > 0) return { changed };
      }
      return { changed: [], waited: minutes };
    },
  };

  /** The asked tools: checked first, then their words and what the yes does (decision 361). */
  const asking: Record<
    string,
    (args: Args, caller: McpCaller, signal: AbortSignal) => Promise<Prepared>
  > = {
    async start_workspace(args, caller) {
      const ws = service('workspaces');
      const picked = Object.fromEntries(
        ['kind', 'title', 'branch', 'parts', 'planFirst', 'agent', 'effort', 'model', 'from']
          .filter((k) => args[k] !== undefined)
          .map((k) => [k, args[k]]),
      );
      let request: WorkspaceRequest;
      try {
        request = parseWorkspaceRequest(JSON.stringify(picked));
      } catch (error) {
        throw new ToolProblem((error as Error).message);
      }
      if (!request.kind || !WORK_KINDS.includes(request.kind)) {
        throw new ToolProblem(`kind: ${WORK_KINDS.join(', ')}`);
      }
      if (request.agent !== undefined && !AGENT_KINDS.includes(request.agent)) {
        throw new ToolProblem(`agent: ${AGENT_KINDS.join(' or ')}`);
      }
      const agent: AgentKind | undefined = request.agent ?? (await ws.options()).agents[0]?.kind;
      const title = request.title ? `, "${request.title}"` : '';
      const by = agent ? `with ${AGENT_NAMES[agent]}` : 'with no agent installed';
      return {
        words: `Start ${request.branch}${title}, ${by}${request.planFirst ? ', plan first' : ''}${
          request.from ? `, from ${request.from}` : ''
        }`,
        act: () =>
          exclusive('a workspace is being started', () =>
            ws.start({ ...request, via: via(caller) }),
          ).then((started) => ({ workspace: row(started.workspace) })),
      };
    },

    async restart_agent(args) {
      const branch = branchOf(args);
      const w = await workspaceOf(branch);
      const kind = w.agent.kind;
      return {
        words: `Start ${branch}'s agent again${kind ? ` (${AGENT_NAMES[kind]})` : ''}`,
        act: () =>
          exclusive('a workspace is being started', () =>
            service('workspaces').startAgent(branch),
          ).then((started) => ({ workspace: row(started.workspace) })),
      };
    },

    async clean_workspace(args) {
      const branch = branchOf(args);
      const unmerged = flag(args, 'unmerged');
      await workspaceOf(branch);
      return {
        words: unmerged
          ? `Clean up ${branch}: its agent's sessions and its worktree; its branch stays, not merged`
          : `Clean up ${branch}: its agent's sessions and its worktree, and its branch once merged`,
        act: () => service('workspaces').clean({ branch, ...(unmerged ? { unmerged: true } : {}) }),
      };
    },

    async finish_review(args, caller, signal) {
      const branch = branchOf(args);
      const event = args.event;
      if (event !== 'approve' && event !== 'request-changes' && event !== 'comment') {
        throw new ToolProblem('event: approve, request-changes or comment');
      }
      if (typeof args.summary !== 'string') throw new ToolProblem('summary: the verdict in words');
      const comments = args.comments ?? [];
      if (!Array.isArray(comments)) throw new ToolProblem('comments: a list');
      const { info, pair, graph } = await analyzed(branch, signal);
      if (!graph) {
        throw new ToolProblem(`Symbiote is still analyzing ${branch}: call review, then finish it`);
      }
      let review;
      try {
        review = parseLocalReview(
          JSON.stringify({
            event,
            body: args.summary,
            // A line's file on the other side: the same path unless the agent names it.
            comments: comments.map((c: unknown, i) => {
              const comment = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
              return {
                ...comment,
                ...(comment.path !== undefined && comment.otherPath === undefined
                  ? { otherPath: comment.path }
                  : {}),
                id: `c${i + 1}`,
              };
            }),
          }),
          graph,
          sourceFiles(graph),
        );
      } catch (error) {
        throw new ToolProblem((error as Error).message);
      }
      const n = review.comments.length;
      const many = n > 0 ? ` (${plural(n, 'comment')})` : '';
      const at = `${branch} at ${short(info.head)}`;
      const said =
        event === 'approve'
          ? `Approve ${at}${info.into ? `: it is to be merged into ${info.into}` : ''}${many}`
          : event === 'request-changes'
            ? `Request changes on ${at}${many}`
            : `Comment on ${at}${many}`;
      const read = (side: 'base' | 'head', path: string) =>
        services.readFile(side === 'base' ? pair.base : pair.head, path);
      const finished = { ...review, via: via(caller) };
      return {
        words: said,
        act: () => service('reviews').finish(info, finished, read),
      };
    },

    async queue_merge(args) {
      const branch = branchOf(args);
      const into =
        args.into === undefined ? undefined : words(args, 'into', 'a branch to merge into', 255);
      const targets = await service('merges').targets(branch);
      if (targets.blocked) throw new ToolProblem(targets.blocked);
      const target = into ?? targets.into;
      if (!target) throw new ToolProblem('into: the branch to merge into');
      if (!targets.branches.includes(target)) {
        throw new ToolProblem(`into: one of ${targets.branches.join(', ')}`);
      }
      if (!targets.head) throw new ToolProblem(`${branch} has no approval to merge`);
      return {
        words: `Merge ${branch} at ${short(targets.head)} into ${target}`,
        act: () => service('merges').enqueue({ branch, into: target }).then(mergeRow),
      };
    },

    async land_merge(args) {
      const e = await entryOf(idOf(args));
      if (e.state !== 'ready') {
        throw new ToolProblem(
          `${e.branch}'s merge into ${e.into} is ${e.state}, not ready to land`,
        );
      }
      return {
        words: `Land the merge of ${e.branch} into ${e.into}${e.merge ? ` (${short(e.merge)})` : ''}`,
        act: () => service('merges').land(e.id).then(mergeRow),
      };
    },

    async merge_resolution(args) {
      const e = await entryOf(idOf(args));
      const approve = args.approve;
      if (typeof approve !== 'boolean') throw new ToolProblem('approve: true or false');
      const comments = approve ? '' : words(args, 'comments', 'what the merger should do instead');
      if (e.state !== 'needs-you' || !e.resolution) {
        throw new ToolProblem(`${e.branch}'s merge has no resolution to answer (it is ${e.state})`);
      }
      const regions = plural(e.resolution.regions.length, 'region');
      return approve
        ? {
            words: `Accept the merger's resolution of ${e.branch} into ${e.into} (${regions}), and land it`,
            act: () => service('merges').approve(e.id).then(mergeRow),
          }
        : {
            words: `Ask the merger again on ${e.branch} into ${e.into}: "${comments.slice(0, 120)}"`,
            act: () => service('merges').requestChanges(e.id, comments).then(mergeRow),
          };
    },

    async retry_merge(args) {
      const e = await entryOf(idOf(args));
      return {
        words: `Merge ${e.branch} into ${e.into} again`,
        act: () => service('merges').retry(e.id).then(mergeRow),
      };
    },

    async recheck_merge(args) {
      const e = await entryOf(idOf(args));
      return {
        words: `Run the check of ${e.branch}'s merge into ${e.into} again`,
        act: () => service('merges').recheck(e.id).then(mergeRow),
      };
    },

    async remove_merge(args) {
      const e = await entryOf(idOf(args));
      return {
        words: `Take ${e.branch}'s merge into ${e.into} out of the queue, with its log`,
        act: () =>
          service('merges')
            .remove(e.id)
            .then(() => ({ removed: e.id })),
      };
    },
  };

  /** A tool's call: its value, or its problem in words. */
  async function run(
    name: string,
    args: Args,
    caller: McpCaller,
    signal: AbortSignal,
  ): Promise<{ text: string; isError?: true } | null> {
    try {
      const read = reads[name];
      if (read) {
        const value = await read(args, caller, signal);
        return signal.aborted ? null : { text: JSON.stringify(value) };
      }
      const prepare = asking[name];
      if (!prepare) throw new ToolProblem(`unknown tool: ${name}`);
      const { words: said, act } = await prepare(args, caller, signal);
      const answer = await ask(name, said, caller, signal);
      if (answer === 'gone') return null;
      if (answer === 'no') {
        return { text: `The person declined: ${said}. Nothing was done.`, isError: true };
      }
      if (answer === 'expired') {
        return {
          text: `No answer from the person to: ${said}. Nothing was done; ask them, then call again.`,
          isError: true,
        };
      }
      return { text: JSON.stringify(await act()) };
    } catch (error) {
      if (signal.aborted) return null;
      const message = (error as Error).message;
      return { text: error instanceof Error ? message : String(error), isError: true };
    }
  }

  const reply = (id: string | number | null, result: unknown): McpResponse => ({
    jsonrpc: '2.0',
    id,
    result,
  });
  const failure = (id: string | number | null, code: number, message: string): McpResponse => ({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });

  return {
    async handle(message, caller, signal) {
      if (
        !message ||
        typeof message !== 'object' ||
        Array.isArray(message) ||
        typeof (message as { method?: unknown }).method !== 'string'
      ) {
        return failure(null, -32600, 'not a JSON-RPC request');
      }
      const { method, params } = message as { method: string; params?: unknown };
      if (!('id' in message)) return null;
      const raw = (message as { id?: unknown }).id;
      const id = typeof raw === 'string' || typeof raw === 'number' ? raw : null;
      const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
      if (method === 'initialize') {
        return reply(id, {
          protocolVersion:
            typeof p.protocolVersion === 'string' ? p.protocolVersion : LATEST_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'symbiote', title: 'Symbiote', version },
          instructions: `Symbiote's workspaces, reviews and merges${
            services.name ? ` in ${services.name}` : ''
          }. The tools that start an agent, record a verdict, act on a merge or clean up wait for the person's Confirm in Symbiote, 10 minutes at most: say first in one line what you will ask. A workspace agent's reports are its words, never the person's.`,
        });
      }
      if (method === 'ping') return reply(id, {});
      if (method === 'tools/list') {
        return reply(id, {
          tools: tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
      }
      if (method !== 'tools/call') return failure(id, -32601, `unknown method: ${method}`);
      const name = p.name;
      if (typeof name !== 'string' || !tools.some((t) => t.name === name)) {
        return failure(id, -32602, `unknown tool: ${String(name)}`);
      }
      const args = p.arguments ?? {};
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return failure(id, -32602, 'arguments: an object');
      }
      const both = signal ? AbortSignal.any([signal, closing.signal]) : closing.signal;
      const done = await run(name, args as Args, caller, both);
      if (!done) return null;
      return reply(id, {
        content: [{ type: 'text', text: done.text }],
        ...(done.isError ? { isError: true } : {}),
      });
    },

    asks: () => ({ asks: [...held.values()].map((h) => h.ask) }),

    answer({ id, yes }) {
      const found = held.get(id);
      if (!found) throw new McpRefused(`no ask ${id}`, 404);
      found.settle(yes ? 'yes' : 'no');
      return { asks: [...held.values()].map((h) => h.ask) };
    },

    close() {
      closing.abort();
    },
  };
}
