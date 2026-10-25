import { readFileSync } from 'node:fs';
import type {
  BranchReviewInfo,
  Graph,
  LocalReview,
  McpCaller,
  MergeEntry,
  WorkspaceRequest,
  WorkspaceSummary,
} from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import type { DiffStatus, Pair } from '../src/diffs.js';
import { MCP_TOOLS, symbioteMcp, type McpServices } from '../src/mcp.js';
import { MergeRefused } from '../src/merges.js';
import { ReviewRefused } from '../src/reviews.js';
import { WorkspaceRefused } from '../src/workspace-record.js';

const graph = JSON.parse(
  readFileSync(
    new URL('../../core/test/__snapshots__/graph-callers.json', import.meta.url),
    'utf8',
  ),
) as Graph;

const SCOUT: McpCaller = { via: 'scout' };
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

function workspace(
  branch: string,
  state: WorkspaceSummary['agent']['state'],
  more: Partial<WorkspaceSummary> = {},
): WorkspaceSummary {
  return {
    branch,
    kind: 'fix',
    title: `Title of ${branch}`,
    base: BASE,
    created: '2026-10-25T10:00:00.000Z',
    planFirst: true,
    brief: `# The brief of ${branch}\n\nA long text.`,
    worktree: { path: `/w/${branch}`, exists: true, changed: 0 },
    tip: HEAD,
    ahead: 2,
    merged: false,
    agent: { state, kind: 'codex' },
    ...more,
  };
}

function entry(more: Partial<MergeEntry> = {}): MergeEntry {
  return {
    id: 'm1',
    branch: 'fix/a',
    head: HEAD,
    into: 'main',
    title: 'Merge fix/a: Title',
    state: 'ready',
    queued: '2026-10-25T10:00:00.000Z',
    updated: '2026-10-25T10:01:00.000Z',
    ...more,
  };
}

const info: BranchReviewInfo = {
  branch: 'fix/a',
  ref: 'fix/a',
  base: BASE,
  head: HEAD,
  reviewed: null,
  since: null,
  into: 'main',
};

/** Fake services, each call recorded as `[method, ...arguments]`. */
function fakes(
  options: {
    workspaces?: WorkspaceSummary[];
    merges?: MergeEntry[];
    diff?: () => DiffStatus | undefined;
  } = {},
) {
  const calls: unknown[][] = [];
  const list = options.workspaces ?? [
    workspace('fix/a', 'plan-ready'),
    workspace('feature/b', 'working'),
    workspace('chore/c', 'needs-you', {
      agent: { state: 'needs-you', waitingFor: 'a permission' },
    }),
  ];
  let queue = options.merges ?? [
    entry({ branch: 'feature/d', state: 'needs-you', message: 'a resolution' }),
  ];
  const services: McpServices = {
    name: 'trial',
    status: () =>
      Promise.resolve({ branch: 'main', head: HEAD, version: 'v1', changed: 1, operation: null }),
    readFile: (sha, path) => {
      calls.push(['readFile', sha, path]);
      return Promise.resolve('line 1\nline 2\nline 3\n');
    },
    diffs: {
      start: (pair: Pair) => void calls.push(['diffs.start', pair]),
      status: () => (options.diff ? options.diff() : { status: 'done', graph }),
    },
    workspaces: {
      list: () => Promise.resolve({ workspaces: list, place: 'repository' }),
      options: () =>
        Promise.resolve({
          base: { from: 'main', sha: HEAD },
          branches: [{ name: 'main', sha: HEAD }],
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
          worktrees: '../trial.worktrees/<branch>',
          agents: [{ kind: 'codex', command: 'codex' }],
          maxBrief: 20000,
          documents: {
            folder: 'symbiote/documents/<branch>',
            maxFiles: 10,
            maxBytes: 1,
            maxTotal: 1,
          },
        }),
      changes: (branch: string) =>
        Promise.resolve({
          branch,
          base: BASE,
          since: 'main',
          tip: HEAD,
          commits: {
            count: 1,
            listed: [
              {
                sha: HEAD,
                subject: 'Fix: the thing',
                author: 'A',
                date: '2026-10-25T10:00:00+00:00',
              },
            ],
          },
          files: {
            count: 1,
            added: 3,
            removed: 1,
            listed: [{ status: 'modified', path: 'src/a.ts', added: 3, removed: 1 }],
          },
          uncommitted: { count: 0, listed: [] },
        }),
      merge: () => Promise.resolve({ into: 'main', clean: true }),
      thread: (branch: string) =>
        Promise.resolve({
          recorded: true,
          entries: Array.from({ length: 30 }, (_, i) => ({
            at: `2026-10-25T10:${String(i).padStart(2, '0')}:00.000Z`,
            session: 's1',
            kind: 'report' as const,
            text: `report ${i} of ${branch}`,
          })),
        }),
      reply: (request) => {
        calls.push(['reply', request]);
        if (request.branch === 'gone/x') {
          return Promise.reject(new WorkspaceRefused('no workspace gone/x', 404));
        }
        return Promise.resolve({ workspace: workspace(request.branch, 'working') });
      },
      stopAgent: (branch: string) => {
        calls.push(['stopAgent', branch]);
        return Promise.resolve({ workspace: workspace(branch, 'stopped'), prompt: '' });
      },
      startAgent: (branch: string) => {
        calls.push(['startAgent', branch]);
        return Promise.resolve({ workspace: workspace(branch, 'working'), prompt: 'the prompt' });
      },
      start: (request: WorkspaceRequest) => {
        calls.push(['start', request]);
        return Promise.resolve({
          workspace: workspace(request.branch, 'working'),
          prompt: 'the prompt',
        });
      },
      clean: (request) => {
        calls.push(['clean', request]);
        return Promise.resolve({ finished: '2026-10-25T11:00:00.000Z' });
      },
    },
    reviews: {
      list: () =>
        Promise.resolve({
          defaultBranch: 'main',
          reviewer: 'person@example.com',
          place: 'repository',
          reviews: [],
        }),
      resolve: (ref: string) => {
        if (ref !== 'fix/a') return Promise.reject(new ReviewRefused(`no branch ${ref}`));
        return Promise.resolve({ info, pair: { base: BASE, head: HEAD } });
      },
      finish: async (at, review: LocalReview, read) => {
        calls.push(['finish', at.branch, review, await read('head', 'src/math.ts')]);
        return {
          verdict: {
            at: '2026-10-25T11:00:00.000Z',
            comments: [],
            event: review.event,
            head: HEAD,
            summary: review.body,
          },
          text: 'for the agent',
        };
      },
    },
    merges: {
      list: () => Promise.resolve({ merges: queue }),
      targets: (branch: string) =>
        Promise.resolve(
          branch === 'fix/a'
            ? { branches: ['main'], into: 'main', head: HEAD }
            : { branches: ['main'], into: 'main', blocked: `${branch} has no approval` },
        ),
      enqueue: (request) => {
        calls.push(['enqueue', request]);
        const queued = entry({ branch: request.branch, into: request.into, state: 'queued' });
        queue = [...queue, queued];
        return Promise.resolve(queued);
      },
      land: (id: string) => {
        calls.push(['land', id]);
        return Promise.resolve(entry({ id, state: 'landed' }));
      },
      retry: (id: string) => Promise.resolve(entry({ id, state: 'queued' })),
      recheck: (id: string) => Promise.resolve(entry({ id, state: 'checking' })),
      remove: (id: string) => {
        calls.push(['remove', id]);
        return id === 'busy'
          ? Promise.reject(new MergeRefused('it is merging', 409))
          : Promise.resolve();
      },
      approve: (id: string) => Promise.resolve(entry({ id, state: 'landed' })),
      requestChanges: (id: string, comments: string) => {
        calls.push(['requestChanges', id, comments]);
        return Promise.resolve(entry({ id, state: 'resolving' }));
      },
      log: (id: string) =>
        Promise.resolve(
          id === 'm1'
            ? {
                lines: Array.from({ length: 80 }, (_, i) => ({ at: i, out: `line ${i}` })),
                next: 999,
              }
            : null,
        ),
    },
    usage: { report: () => Promise.resolve({ subscriptions: [] }) },
    monitor: {
      map: () =>
        Promise.resolve({
          version: 1 as const,
          commit: HEAD,
          files: [
            {
              path: 'src/a.ts',
              kind: 'source' as const,
              language: 'TypeScript',
              lines: 100,
              code: 80,
              comments: 10,
              blank: 10,
            },
            {
              path: 'src/b/c.ts',
              kind: 'source' as const,
              language: 'TypeScript',
              lines: 50,
              code: 40,
              comments: 5,
              blank: 5,
            },
            {
              path: 'docs/x.md',
              kind: 'docs' as const,
              language: 'Markdown',
              lines: 20,
              code: 20,
              comments: 0,
              blank: 0,
            },
          ],
        }),
    },
  };
  return {
    services,
    calls,
    setQueue: (next: MergeEntry[]) => (queue = next),
    setWorkspaces: (next: WorkspaceSummary[]) => list.splice(0, list.length, ...next),
  };
}

type Mcp = ReturnType<typeof symbioteMcp>;

function server(services: McpServices, options: Parameters<typeof symbioteMcp>[1] = {}): Mcp {
  return symbioteMcp(services, {
    version: '1.2.3',
    url: () => 'http://127.0.0.1:4100/',
    analysisMs: 30,
    pollMs: 5,
    ...options,
  });
}

let ids = 0;
/** A tool's call: its text, whether it is an error, and its JSON when it is some. */
async function call(
  mcp: Mcp,
  name: string,
  args: Record<string, unknown> = {},
  caller: McpCaller = SCOUT,
  signal?: AbortSignal,
) {
  const answer = await mcp.handle(
    { jsonrpc: '2.0', id: ++ids, method: 'tools/call', params: { name, arguments: args } },
    caller,
    signal,
  );
  const result = (
    answer as { result?: { content: { type: string; text: string }[]; isError?: boolean } }
  ).result;
  if (!result) throw new Error(`no result: ${JSON.stringify(answer)}`);
  const text = result.content.map((c) => c.text).join('');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  return { text, isError: result.isError === true, value: value as Record<string, unknown> };
}

/** Waits until `mcp` holds an ask, and answers its ID. */
async function askOf(mcp: Mcp): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const ask = mcp.asks().asks[0];
    if (ask) return ask.id;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('no ask');
}

describe("Symbiote's MCP: the protocol (MC1, decision 359)", () => {
  it('introduces itself, echoing the version the client asked for', async () => {
    const mcp = server(fakes().services);
    const answer = await mcp.handle(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'claude-code', version: '2' },
        },
      },
      SCOUT,
    );
    expect(answer).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'symbiote', title: 'Symbiote', version: '1.2.3' },
        instructions: expect.stringContaining('Confirm') as unknown,
      },
    });
    const bare = await mcp.handle(
      { jsonrpc: '2.0', id: 2, method: 'initialize', params: {} },
      SCOUT,
    );
    expect((bare as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      '2025-06-18',
    );
  });

  it('answers ping, no notification, and refuses what it does not know', async () => {
    const mcp = server(fakes().services);
    expect(await mcp.handle({ jsonrpc: '2.0', id: 'p', method: 'ping' }, SCOUT)).toEqual({
      jsonrpc: '2.0',
      id: 'p',
      result: {},
    });
    expect(
      await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, SCOUT),
    ).toBeNull();
    expect(
      await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, SCOUT),
    ).toMatchObject({
      id: 3,
      error: { code: -32601 },
    });
    for (const wrong of [{}, [], null, 'text', { jsonrpc: '2.0', id: 4 }]) {
      expect(await mcp.handle(wrong, SCOUT)).toMatchObject({ id: null, error: { code: -32600 } });
    }
    expect(
      await mcp.handle(
        { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } },
        SCOUT,
      ),
    ).toMatchObject({ id: 5, error: { code: -32602, message: 'unknown tool: nope' } });
  });

  it('lists its tools, each with a schema; the asked ones say they ask', async () => {
    const mcp = server(fakes().services);
    const answer = (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, SCOUT)) as {
      result: { tools: { name: string; description: string; inputSchema: { type: string } }[] };
    };
    const { tools } = answer.result;
    expect(tools.map((t) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
    expect(tools.map((t) => t.name)).toEqual([
      'overview',
      'workspaces',
      'workspace',
      'thread',
      'start_options',
      'start_workspace',
      'reply',
      'stop_agent',
      'restart_agent',
      'clean_workspace',
      'review',
      'finish_review',
      'merges',
      'merge_log',
      'queue_merge',
      'land_merge',
      'merge_resolution',
      'retry_merge',
      'recheck_merge',
      'remove_merge',
      'usage',
      'code_map',
      'wait',
    ]);
    for (const tool of tools) expect(tool.inputSchema.type).toBe('object');
    const asked = tools
      .filter((t) => t.description.includes("the person's Confirm"))
      .map((t) => t.name);
    expect(asked).toEqual([
      'start_workspace',
      'restart_agent',
      'clean_workspace',
      'finish_review',
      'queue_merge',
      'land_merge',
      'merge_resolution',
      'retry_merge',
      'recheck_merge',
      'remove_merge',
    ]);
  });

  it('leaves out the tools of a service it does not have', async () => {
    const { services } = fakes();
    const mcp = server({ ...services, merges: undefined, monitor: undefined });
    const answer = (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, SCOUT)) as {
      result: { tools: { name: string }[] };
    };
    const names = answer.result.tools.map((t) => t.name);
    expect(names).not.toContain('queue_merge');
    expect(names).not.toContain('code_map');
    expect(names).toContain('workspaces');
  });
});

describe("Symbiote's MCP: what it reads", () => {
  it('gives an overview: the checkout, what needs the person, the queue', async () => {
    const { value, isError } = await call(server(fakes().services), 'overview');
    expect(isError).toBe(false);
    expect(value).toMatchObject({
      repository: 'trial',
      checkout: { branch: 'main', head: HEAD, changed: 1 },
      needsYou: [
        { workspace: 'fix/a', state: 'plan-ready' },
        { workspace: 'chore/c', state: 'needs-you', waitingFor: 'a permission' },
        { merge: 'm1', branch: 'feature/d', state: 'needs-you', message: 'a resolution' },
      ],
      workspaces: { 'plan-ready': 1, working: 1, 'needs-you': 1 },
      merges: [{ id: 'm1', branch: 'feature/d', into: 'main', state: 'needs-you' }],
    });
  });

  it('lists workspaces without their briefs; one workspace with its brief, changes, merge check', async () => {
    const mcp = server(fakes().services);
    const listed = await call(mcp, 'workspaces');
    expect(listed.text).not.toContain('A long text');
    expect(listed.value.workspaces).toEqual([
      expect.objectContaining({
        branch: 'fix/a',
        kind: 'fix',
        title: 'Title of fix/a',
        agent: { state: 'plan-ready', kind: 'codex' },
        ahead: 2,
      }),
      expect.objectContaining({ branch: 'feature/b' }),
      expect.objectContaining({ branch: 'chore/c' }),
    ]);
    const one = await call(mcp, 'workspace', { branch: 'fix/a' });
    expect(one.value).toMatchObject({
      branch: 'fix/a',
      brief: '# The brief of fix/a\n\nA long text.',
      commits: { count: 1, listed: [{ sha: HEAD, subject: 'Fix: the thing' }] },
      files: { count: 1, listed: [{ path: 'src/a.ts', status: 'modified' }] },
      merge: { into: 'main', clean: true },
    });
    const missing = await call(mcp, 'workspace', { branch: 'none/x' });
    expect(missing).toMatchObject({ isError: true, text: 'no workspace none/x' });
  });

  it("gives a thread's last entries, 20 unless asked, 100 at most", async () => {
    const mcp = server(fakes().services);
    const last = await call(mcp, 'thread', { branch: 'fix/a' });
    const entries = last.value.entries as { text: string }[];
    expect(entries).toHaveLength(20);
    expect(entries.at(-1)?.text).toBe('report 29 of fix/a');
    expect(
      ((await call(mcp, 'thread', { branch: 'fix/a', last: 5 })).value.entries as unknown[]).length,
    ).toBe(5);
    expect(await call(mcp, 'thread', { branch: 'fix/a', last: 500 })).toMatchObject({
      isError: true,
      text: 'last: a count from 1 to 100',
    });
  });

  it("checks its arguments, and gives a service's refusal in its words", async () => {
    const mcp = server(fakes().services);
    expect(await call(mcp, 'reply', { branch: 'fix/a' })).toMatchObject({
      isError: true,
      text: 'text: the message for the agent',
    });
    expect(await call(mcp, 'reply', { branch: 7, text: 'OK' })).toMatchObject({
      isError: true,
      text: "branch: a workspace's branch",
    });
    expect(await call(mcp, 'reply', { branch: 'gone/x', text: 'OK' })).toMatchObject({
      isError: true,
      text: 'no workspace gone/x',
    });
  });

  it("gives a merge's log, its last lines", async () => {
    const mcp = server(fakes().services);
    const log = await call(mcp, 'merge_log', { id: 'm1' });
    const lines = log.value.lines as { out: string }[];
    expect(lines).toHaveLength(60);
    expect(lines.at(-1)?.out).toBe('line 79');
    expect(await call(mcp, 'merge_log', { id: 'none' })).toMatchObject({
      isError: true,
      text: 'no merge none',
    });
  });

  it("says where the checkout's code is, by folder", async () => {
    const { value } = await call(server(fakes().services), 'code_map');
    expect(value).toMatchObject({
      commit: HEAD,
      folders: [
        { folder: 'src', files: 2, code: 120 },
        { folder: 'docs', files: 1, code: 20 },
      ],
    });
    const inside = await call(server(fakes().services), 'code_map', { folder: 'src' });
    expect(inside.value.folders).toEqual([
      { folder: 'src/a.ts', files: 1, code: 80, lines: 100 },
      { folder: 'src/b', files: 1, code: 40, lines: 50 },
    ]);
  });
});

describe("Symbiote's MCP: a branch's review (decision 363)", () => {
  it("answers the branch's graph: counts, findings word for word, the most-called changed symbols", async () => {
    const { services, calls } = fakes();
    const { value, isError } = await call(server(services), 'review', { branch: 'fix/a' });
    expect(isError).toBe(false);
    expect(calls).toContainEqual(['diffs.start', { base: BASE, head: HEAD }]);
    expect(value).toMatchObject({
      branch: 'fix/a',
      base: BASE,
      head: HEAD,
      into: 'main',
      page: 'http://127.0.0.1:4100/review/fix%2Fa/',
      stats: { filesChanged: 1, symbols: { added: 1, removed: 1, modified: 1 } },
      findings: [
        {
          id: 'f1',
          severity: 'error',
          rule: 'removed-still-referenced',
          symbol: 'src/math.ts#legacy',
          message: 'legacy was removed but is still used by 1 symbol: old',
        },
        { id: 'f2', severity: 'warning', message: 'triple is new and nothing references it' },
        { id: 'f3', severity: 'info' },
      ],
      changed: [
        {
          id: 'src/math.ts#add',
          kind: 'function',
          status: 'modified',
          users: 3,
          at: 'src/math.ts:1',
        },
        { id: 'src/math.ts#legacy', status: 'removed', users: 1 },
        { id: 'src/math.ts#triple', status: 'added', users: 0 },
      ],
    });
  });

  it('says an analysis still runs, and one that failed', async () => {
    const running = fakes({
      diff: () => ({ status: 'running', phase: 'references', elapsedMs: 4000 }),
    });
    expect(await call(server(running.services), 'review', { branch: 'fix/a' })).toMatchObject({
      isError: false,
      value: {
        branch: 'fix/a',
        analyzing: 'references',
        note: expect.stringContaining('call review again') as unknown,
      },
    });
    const failed = fakes({ diff: () => ({ status: 'failed', error: 'tsconfig not found' }) });
    expect(await call(server(failed.services), 'review', { branch: 'fix/a' })).toMatchObject({
      isError: true,
      text: 'the analysis of fix/a failed: tsconfig not found',
    });
    expect(await call(server(failed.services), 'review', { branch: 'nope' })).toMatchObject({
      isError: true,
      text: 'no branch nope',
    });
  });
});

describe("Symbiote's MCP: asks (decision 361)", () => {
  it('holds an asked call until the person confirms, then does it', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const pending = call(mcp, 'queue_merge', { branch: 'fix/a' });
    const id = await askOf(mcp);
    expect(mcp.asks().asks).toEqual([
      {
        id,
        tool: 'queue_merge',
        words: `Merge fix/a at ${HEAD.slice(0, 7)} into main`,
        by: { via: 'scout' },
        at: expect.any(String) as unknown,
        until: expect.any(String) as unknown,
      },
    ]);
    expect(calls.some((c) => c[0] === 'enqueue')).toBe(false);
    mcp.answer({ id, yes: true });
    const done = await pending;
    expect(done.isError).toBe(false);
    expect(done.value).toMatchObject({ branch: 'fix/a', into: 'main', state: 'queued' });
    expect(calls).toContainEqual(['enqueue', { branch: 'fix/a', into: 'main' }]);
    expect(mcp.asks().asks).toEqual([]);
  });

  it('does nothing when the person declines, or does not answer in time', async () => {
    const { services, calls } = fakes({ merges: [entry()] });
    const mcp = server(services, { askMs: 40 });
    const declined = call(mcp, 'land_merge', { id: 'm1' });
    mcp.answer({ id: await askOf(mcp), yes: false });
    expect(await declined).toMatchObject({
      isError: true,
      text: expect.stringContaining('The person declined') as unknown,
    });
    const unanswered = await call(mcp, 'land_merge', { id: 'm1' });
    expect(unanswered).toMatchObject({
      isError: true,
      text: expect.stringContaining('No answer') as unknown,
    });
    expect(calls.some((c) => c[0] === 'land')).toBe(false);
    expect(mcp.asks().asks).toEqual([]);
  });

  it('drops an ask its caller hung up on; one ask at a time per caller', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const controller = new AbortController();
    const hung = call(mcp, 'remove_merge', { id: 'm1' }, SCOUT, controller.signal);
    await askOf(mcp);
    expect(await call(mcp, 'remove_merge', { id: 'm1' })).toMatchObject({
      isError: true,
      text: expect.stringContaining('waits for the person') as unknown,
    });
    const other: McpCaller = { via: 'mcp', client: 'claude-code', folder: '/home/p/trial' };
    const theirs = call(mcp, 'remove_merge', { id: 'm1' }, other);
    await expect.poll(() => mcp.asks().asks.length).toBe(2);
    controller.abort();
    await expect(hung).rejects.toThrow();
    expect(mcp.asks().asks.map((a) => a.by)).toEqual([other]);
    mcp.answer({ id: mcp.asks().asks[0]?.id ?? '', yes: true });
    expect((await theirs).isError).toBe(false);
    expect(calls.filter((c) => c[0] === 'remove')).toEqual([['remove', 'm1']]);
    expect(() => mcp.answer({ id: 'none', yes: true })).toThrow('no ask none');
  });

  it('checks an asked call before asking: the person is asked only what can be done', async () => {
    const mcp = server(fakes().services);
    expect(await call(mcp, 'queue_merge', { branch: 'feature/b' })).toMatchObject({
      isError: true,
      text: 'feature/b has no approval',
    });
    expect(await call(mcp, 'land_merge', { id: 'none' })).toMatchObject({
      isError: true,
      text: 'no merge none',
    });
    expect(
      await call(mcp, 'finish_review', {
        branch: 'fix/a',
        event: 'request-changes',
        summary: 'Two things',
        comments: [{ symbol: 'src/other.ts#x', body: 'why?' }],
      }),
    ).toMatchObject({
      isError: true,
      text: 'comment 1: src/other.ts#x is not part of this change',
    });
    expect(
      await call(mcp, 'start_workspace', { kind: 'nope', branch: 'x/y', planFirst: true }),
    ).toMatchObject({
      isError: true,
    });
    expect(mcp.asks().asks).toEqual([]);
  });

  it('records a verdict through Scout, its comments checked, its code read at the reviewed side', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const pending = call(mcp, 'finish_review', {
      branch: 'fix/a',
      event: 'approve',
      summary: 'Looks right.',
      comments: [
        { symbol: 'src/math.ts#add', body: 'Nice', path: 'src/math.ts', line: 2, side: 'head' },
      ],
    });
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(
      `Approve fix/a at ${HEAD.slice(0, 7)}: it is to be merged into main (1 comment)`,
    );
    mcp.answer({ id, yes: true });
    expect((await pending).isError).toBe(false);
    const finish = calls.find((c) => c[0] === 'finish');
    expect(finish?.[1]).toBe('fix/a');
    expect(finish?.[2]).toMatchObject({
      event: 'approve',
      body: 'Looks right.',
      via: 'scout',
      comments: [
        {
          id: 'c1',
          symbol: 'src/math.ts#add',
          body: 'Nice',
          side: 'head',
          path: 'src/math.ts',
          line: 2,
        },
      ],
    });
    expect(calls).toContainEqual(['readFile', HEAD, 'src/math.ts']);
  });

  it('starts a workspace through Scout, or through symbiote mcp', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const request = {
      kind: 'fix',
      title: 'The button',
      branch: 'fix/the-button',
      parts: { happens: 'It does nothing' },
      planFirst: true,
      agent: 'codex',
    };
    const pending = call(mcp, 'start_workspace', request);
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(
      'Start fix/the-button, "The button", with Codex, plan first',
    );
    mcp.answer({ id, yes: true });
    expect((await pending).value).toMatchObject({ workspace: { branch: 'fix/the-button' } });
    expect(calls).toContainEqual(['start', { ...request, via: 'scout' }]);

    const other = call(
      mcp,
      'start_workspace',
      { ...request, branch: 'fix/two' },
      { via: 'mcp', client: 'codex' },
    );
    mcp.answer({ id: await askOf(mcp), yes: true });
    await other;
    expect(calls).toContainEqual(['start', { ...request, branch: 'fix/two', via: 'mcp' }]);
  });

  it('says what a clean-up removes, merged or not', async () => {
    const { services } = fakes();
    const mcp = server(services);
    const merged = call(mcp, 'clean_workspace', { branch: 'fix/a' });
    await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(
      "Clean up fix/a: its agent's sessions and its worktree, and its branch once merged",
    );
    mcp.answer({ id: mcp.asks().asks[0]?.id ?? '', yes: false });
    await merged;
    const unmerged = call(mcp, 'clean_workspace', { branch: 'fix/a', unmerged: true });
    await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(
      "Clean up fix/a: its agent's sessions and its worktree; its branch stays, not merged",
    );
    mcp.answer({ id: mcp.asks().asks[0]?.id ?? '', yes: false });
    await unmerged;
  });

  it('runs a merge action the service refuses as an error, after the yes', async () => {
    const mcp = server(fakes({ merges: [entry({ id: 'busy', state: 'merging' })] }).services);
    const pending = call(mcp, 'remove_merge', { id: 'busy' });
    mcp.answer({ id: await askOf(mcp), yes: true });
    expect(await pending).toMatchObject({ isError: true, text: 'it is merging' });
  });

  it('sends a message and stops an agent without asking', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    expect((await call(mcp, 'reply', { branch: 'fix/a', text: 'OK, go ahead' })).isError).toBe(
      false,
    );
    expect((await call(mcp, 'stop_agent', { branch: 'feature/b' })).isError).toBe(false);
    expect(calls).toContainEqual(['reply', { branch: 'fix/a', text: 'OK, go ahead' }]);
    expect(calls).toContainEqual(['stopAgent', 'feature/b']);
    expect(mcp.asks().asks).toEqual([]);
  });
});

describe("Symbiote's MCP: waiting for a change (decision 364)", () => {
  it("answers once a workspace's or a merge's state changes", async () => {
    const fake = fakes();
    const mcp = server(fake.services);
    const waiting = call(mcp, 'wait', { minutes: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.setWorkspaces([
      workspace('fix/a', 'working'),
      workspace('feature/b', 'ready'),
      workspace('chore/c', 'needs-you'),
    ]);
    fake.setQueue([entry({ branch: 'feature/d', state: 'landed' })]);
    const { value } = await waiting;
    expect(value.changed).toEqual([
      { workspace: 'fix/a', was: 'plan-ready', now: 'working' },
      { workspace: 'feature/b', was: 'working', now: 'ready' },
      { merge: 'm1', branch: 'feature/d', was: 'needs-you', now: 'landed' },
    ]);
  });

  it('answers that nothing changed after the minutes asked; 10 at most', async () => {
    const mcp = server(fakes().services, { minuteMs: 30 });
    expect((await call(mcp, 'wait', { minutes: 1 })).value).toEqual({ changed: [], waited: 1 });
    expect(await call(mcp, 'wait', { minutes: 11 })).toMatchObject({
      isError: true,
      text: 'minutes: from 1 to 10',
    });
  });
});
