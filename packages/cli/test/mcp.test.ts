import type { IssueRecord, McpCaller, NucleusActivityLine } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { IssueRefused } from '../src/issue-classifier.js';
import { MCP_TOOLS } from '../src/mcp-tools.js';
import { parseSuggestRequest } from '../src/server-requests.js';
import { WorkspaceRefused } from '../src/workspace-record.js';
import {
  BASE,
  HEAD,
  NUCLEUS,
  SUGGESTION,
  TAKEN,
  askOf,
  call,
  entry,
  fakes,
  server,
  workspace,
  type Mcp,
} from './mcp-fakes.js';

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
      NUCLEUS,
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
      NUCLEUS,
    );
    expect((bare as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      '2025-06-18',
    );
  });

  it('answers ping, no notification, and refuses what it does not know', async () => {
    const mcp = server(fakes().services);
    expect(await mcp.handle({ jsonrpc: '2.0', id: 'p', method: 'ping' }, NUCLEUS)).toEqual({
      jsonrpc: '2.0',
      id: 'p',
      result: {},
    });
    expect(
      await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, NUCLEUS),
    ).toBeNull();
    expect(
      await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, NUCLEUS),
    ).toMatchObject({
      id: 3,
      error: { code: -32601 },
    });
    for (const wrong of [{}, [], null, 'text', { jsonrpc: '2.0', id: 4 }]) {
      expect(await mcp.handle(wrong, NUCLEUS)).toMatchObject({ id: null, error: { code: -32600 } });
    }
    expect(
      await mcp.handle(
        { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } },
        NUCLEUS,
      ),
    ).toMatchObject({ id: 5, error: { code: -32602, message: 'unknown tool: nope' } });
  });

  it('lists its tools, each with a schema; the asked ones say they ask', async () => {
    // mark_merged where the repository names its commands (MC3, decision 990).
    const marks = {
      configured: () => true,
      preview: () => Promise.reject(new Error('unused')),
      mark: () => Promise.reject(new Error('unused')),
    };
    const mcp = server({ ...fakes().services, marks });
    const answer = (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, NUCLEUS)) as {
      result: { tools: { name: string; description: string; inputSchema: { type: string } }[] };
    };
    const { tools } = answer.result;
    expect(tools.map((t) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
    expect(tools.map((t) => t.name)).toEqual([
      'overview',
      'workspaces',
      'workspace',
      'thread',
      'activity',
      'start_options',
      'suggest_settings',
      'start_workspace',
      'classify_issue',
      'start_from_issue',
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
      'mark_merged',
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
      'start_from_issue',
      'restart_agent',
      'clean_workspace',
      'finish_review',
      'queue_merge',
      'land_merge',
      'merge_resolution',
      'retry_merge',
      'recheck_merge',
      'mark_merged',
      'remove_merge',
    ]);
  });

  it("lists suggest_settings with start_workspace's brief and the documents' names (MC2, decision 583)", async () => {
    const mcp = server(fakes().services);
    const answer = (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, NUCLEUS)) as {
      result: {
        tools: {
          name: string;
          description: string;
          inputSchema: { properties: Record<string, unknown>; required?: string[] };
        }[];
      };
    };
    const tool = (name: string) => answer.result.tools.find((t) => t.name === name);
    const suggest = tool('suggest_settings');
    const start = tool('start_workspace');
    // Every field of a start, so one brief fits both and none is refused (MC3, decision 997);
    // the advisor reads the brief alone.
    const one = { ...start?.inputSchema.properties };
    delete one.workspaces;
    expect(suggest?.inputSchema).toEqual({
      type: 'object',
      properties: {
        ...one,
        documents: {
          type: 'array',
          items: { type: 'string' },
          description: expect.stringContaining('names') as unknown,
        },
      },
      required: ['kind', 'title', 'parts'],
      additionalProperties: false,
    });
    expect(suggest?.inputSchema.properties.kind).toEqual({
      type: 'string',
      enum: ['feature', 'fix', 'refactor', 'chore', 'spike'],
    });
    // What it costs and when to call it, for a client that reads only the description.
    expect(suggest?.description).toContain('starts nothing');
    expect(suggest?.description).toContain('only before a start the person asked for');
    expect(suggest?.description).not.toContain("the person's Confirm");
  });

  it('leaves out the tools of a service it does not have', async () => {
    const { services } = fakes();
    const mcp = server({ ...services, merges: undefined, monitor: undefined });
    const answer = (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, NUCLEUS)) as {
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

  it('leaves merged workspaces out of what needs the person, counted as merged (MC3, decision 993)', async () => {
    // Measured 2026-11-11: all 9 entries of needsYou were merged workspaces, each `ready`.
    const { services } = fakes({
      workspaces: [
        workspace('feature/v99', 'ready', { merged: true }),
        workspace('feature/v100', 'ready', { merged: true }),
        workspace('fix/a', 'ready'),
        workspace('chore/c', 'needs-you', {
          agent: { state: 'needs-you', waitingFor: 'a permission' },
        }),
        workspace('feature/b', 'working'),
      ],
      merges: [],
    });
    const { value } = await call(server(services), 'overview');
    expect(value.needsYou).toEqual([
      { workspace: 'fix/a', state: 'ready' },
      { workspace: 'chore/c', state: 'needs-you', waitingFor: 'a permission' },
    ]);
    expect(value.workspaces).toEqual({ merged: 2, ready: 1, 'needs-you': 1, working: 1 });
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
    // The list gives no paths; one workspace gives its worktree, where Scout reads (V80).
    expect(listed.text).not.toContain('/w/fix/a');
    const one = await call(mcp, 'workspace', { branch: 'fix/a' });
    expect(one.value).toMatchObject({
      branch: 'fix/a',
      worktree: '/w/fix/a',
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

  it("gives a workspace's activity as Markdown, within 60 KB (V84, decision 672)", async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const read = await call(mcp, 'activity', { branch: 'fix/a' });
    // The Markdown itself, not a JSON string of it.
    expect(read.text).toBe('---\nof: workspace\n---\n\n# Activity: fix/a\n');
    expect(calls).toContainEqual(['exportActivity', 'fix/a', 'markdown', { maxBytes: 60 * 1024 }]);
    expect(await call(mcp, 'activity', { branch: 'none/x' })).toMatchObject({
      isError: true,
      text: 'no workspace none/x',
    });
    expect(await call(mcp, 'activity', {})).toMatchObject({
      isError: true,
      text: "branch: a workspace's branch, or nucleus: true",
    });
    expect(await call(mcp, 'activity', { branch: 'fix/a', nucleus: true })).toMatchObject({
      isError: true,
      text: "branch: a workspace's branch, or nucleus: true",
    });
  });

  it("gives Nucleus's activity when it has one (V84)", async () => {
    const { services } = fakes();
    const without = await call(server(services), 'activity', { nucleus: true });
    expect(without).toMatchObject({ isError: true, text: 'nucleus: none in this Symbiote' });
    const asked: unknown[] = [];
    const mcp = server({
      ...services,
      nucleus: {
        exportActivity: (format, options) => {
          asked.push([format, options]);
          return Promise.resolve({
            text: '# Activity: Nucleus\n',
            name: 'a.md',
            type: 'text/markdown',
          });
        },
      },
    });
    expect((await call(mcp, 'activity', { nucleus: true })).text).toBe('# Activity: Nucleus\n');
    expect(asked).toEqual([['markdown', { maxBytes: 60 * 1024 }]]);
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
        by: { via: 'nucleus' },
        at: expect.any(String) as unknown,
        until: expect.any(String) as unknown,
      },
    ]);
    expect(calls.some((c) => c[0] === 'enqueue')).toBe(false);
    // The person's answer is answered once it is done: the page reads what changed then.
    expect(await mcp.answer({ id, yes: true })).toEqual({ asks: [] });
    expect(calls).toContainEqual(['enqueue', { branch: 'fix/a', into: 'main' }]);
    const done = await pending;
    expect(done.isError).toBe(false);
    expect(done.value).toMatchObject({ branch: 'fix/a', into: 'main', state: 'queued' });
    expect(calls).toContainEqual(['enqueue', { branch: 'fix/a', into: 'main' }]);
    expect(mcp.asks().asks).toEqual([]);
  });

  it('queues by fast-forward where the target can take it; a waiting one with a merge commit instead (V67)', async () => {
    const waiting = entry({
      state: 'needs-you',
      strategy: 'fast-forward',
      behind: 2,
      message: 'main has 2 commits fix/a does not: it cannot fast-forward.',
    });
    const { services, calls } = fakes({ merges: [waiting] });
    const mcp = server(services);
    const read = await call(mcp, 'merges', { branch: 'fix/a' });
    expect(read.value).toMatchObject({
      merges: [{ strategy: 'fast-forward', behind: 2, state: 'needs-you' }],
      targets: { strategy: 'merge', fastForward: ['main'] },
    });

    expect(
      await call(mcp, 'queue_merge', {
        branch: 'fix/a',
        into: 'release',
        strategy: 'fast-forward',
      }),
    ).toMatchObject({
      isError: true,
      text: 'release has commits fix/a does not: it cannot fast-forward (strategy merge: a merge commit)',
    });
    expect(await call(mcp, 'queue_merge', { branch: 'fix/a', strategy: 'squash' })).toMatchObject({
      isError: true,
      text: 'strategy: merge or fast-forward',
    });

    const instead = call(mcp, 'queue_merge', { branch: 'fix/a', strategy: 'merge' });
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(
      `Merge fix/a into main with a merge commit: it cannot fast-forward`,
    );
    await mcp.answer({ id, yes: true });
    expect((await instead).isError).toBe(false);
    expect(calls).toContainEqual(['mergeCommit', 'm1']);
  });

  it('asks to fast-forward by name (V67)', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const pending = call(mcp, 'queue_merge', { branch: 'fix/a', strategy: 'fast-forward' });
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(
      `Fast-forward main to fix/a at ${HEAD.slice(0, 7)}: no merge commit`,
    );
    await mcp.answer({ id, yes: true });
    await pending;
    expect(calls).toContainEqual([
      'enqueue',
      { branch: 'fix/a', into: 'main', strategy: 'fast-forward' },
    ]);
  });

  it('does nothing when the person declines, or does not answer in time', async () => {
    const { services, calls } = fakes({ merges: [entry()] });
    const mcp = server(services, { askMs: 40 });
    const declined = call(mcp, 'land_merge', { id: 'm1' });
    await mcp.answer({ id: await askOf(mcp), yes: false });
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
    // Kept on the person's bar, lapsed, for a late yes (MC3, decision 994).
    expect(mcp.asks().asks.map((a) => a.stage)).toEqual(['lapsed']);
  });

  it('drops an ask its caller hung up on; one ask at a time per caller', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const controller = new AbortController();
    const hung = call(mcp, 'remove_merge', { id: 'm1' }, NUCLEUS, controller.signal);
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
    await mcp.answer({ id: mcp.asks().asks[0]?.id ?? '', yes: true });
    expect((await theirs).isError).toBe(false);
    expect(calls.filter((c) => c[0] === 'remove')).toEqual([['remove', 'm1']]);
    await expect(mcp.answer({ id: 'none', yes: true })).rejects.toThrow('no ask none');
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
    // The approval queues its merge in the same Confirm (MC3, decision 991).
    expect(mcp.asks().asks[0]?.words).toBe(
      `Approve fix/a at ${HEAD.slice(0, 7)} and merge it into main (1 comment)`,
    );
    await mcp.answer({ id, yes: true });
    expect((await pending).isError).toBe(false);
    expect(calls).toContainEqual(['enqueue', { branch: 'fix/a', into: 'main' }]);
    const finish = calls.find((c) => c[0] === 'finish');
    expect(finish?.[1]).toBe('fix/a');
    expect(finish?.[2]).toMatchObject({
      event: 'approve',
      body: 'Looks right.',
      via: 'nucleus',
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
    await mcp.answer({ id, yes: true });
    expect((await pending).value).toMatchObject({ workspace: { branch: 'fix/the-button' } });
    expect(calls).toContainEqual(['start', { ...request, via: 'nucleus' }]);

    const other = call(
      mcp,
      'start_workspace',
      { ...request, branch: 'fix/two' },
      { via: 'mcp', client: 'codex' },
    );
    await mcp.answer({ id: await askOf(mcp), yes: true });
    await other;
    expect(calls).toContainEqual(['start', { ...request, branch: 'fix/two', via: 'mcp' }]);
  });

  it('names the model and the effort it starts with in the Confirm (MC2, decision 584)', async () => {
    const mcp = server(fakes().services);
    const request = {
      kind: 'fix',
      title: 'The button',
      branch: 'fix/the-button',
      parts: { happens: 'It does nothing' },
      planFirst: true,
      agent: 'codex',
    };
    const words = async (more: Record<string, unknown>) => {
      const pending = call(mcp, 'start_workspace', { ...request, ...more });
      const id = await askOf(mcp);
      const said = mcp.asks().asks[0]?.words;
      await mcp.answer({ id, yes: false });
      await pending;
      return said;
    };
    expect(await words({ model: 'gpt-6', effort: 'high' })).toBe(
      'Start fix/the-button, "The button", with Codex on gpt-6 at high, plan first',
    );
    expect(await words({ model: 'gpt-6' })).toBe(
      'Start fix/the-button, "The button", with Codex on gpt-6, plan first',
    );
    expect(await words({ effort: 'xhigh', planFirst: false })).toBe(
      'Start fix/the-button, "The button", with Codex at xhigh',
    );
  });

  it('says what a clean-up removes, merged or not', async () => {
    const { services } = fakes();
    const mcp = server(services);
    const merged = call(mcp, 'clean_workspace', { branch: 'fix/a' });
    await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(
      "Clean up fix/a: its agent's sessions and its worktree, and its branch once merged",
    );
    await mcp.answer({ id: mcp.asks().asks[0]?.id ?? '', yes: false });
    await merged;
    const unmerged = call(mcp, 'clean_workspace', { branch: 'fix/a', unmerged: true });
    await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(
      "Clean up fix/a: its agent's sessions and its worktree; its branch stays, not merged",
    );
    await mcp.answer({ id: mcp.asks().asks[0]?.id ?? '', yes: false });
    await unmerged;
  });

  it('runs a merge action the service refuses as an error, after the yes', async () => {
    const mcp = server(fakes({ merges: [entry({ id: 'busy', state: 'merging' })] }).services);
    const pending = call(mcp, 'remove_merge', { id: 'busy' });
    await mcp.answer({ id: await askOf(mcp), yes: true });
    expect(await pending).toMatchObject({ isError: true, text: 'it is merging' });
  });

  it('sends a message and stops an agent without asking', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    expect((await call(mcp, 'reply', { branch: 'fix/a', text: 'OK, go ahead' })).isError).toBe(
      false,
    );
    expect((await call(mcp, 'stop_agent', { branch: 'feature/b' })).isError).toBe(false);
    // Noted as Nucleus's (AR2, decision 741): its prompt reads as Nucleus's, not the person's.
    expect(calls).toContainEqual([
      'reply',
      { branch: 'fix/a', text: 'OK, go ahead', by: 'nucleus' },
    ]);
    expect(calls).toContainEqual(['stopAgent', 'feature/b']);
    expect(mcp.asks().asks).toEqual([]);
  });
});

describe("Symbiote's MCP: the advisor's proposal (MC2)", () => {
  it("gives the advisor start_workspace's brief and answers its suggestion unchanged, asking nothing (decision 582)", async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const start = {
      kind: 'feature',
      title: 'Search',
      branch: 'feature/search',
      parts: { goal: 'Find a commit by its message' },
      planFirst: false,
      agent: 'codex',
      effort: 'medium',
      model: 'gpt-6',
      from: 'main',
    };
    const answer = await call(mcp, 'suggest_settings', { ...start, documents: ['spec.pdf'] });
    expect(answer).toEqual({ text: JSON.stringify(SUGGESTION), isError: false, value: SUGGESTION });
    // The brief and the documents' names; the run's choices are not the advisor's to read.
    expect(calls).toEqual([
      [
        'suggest',
        {
          kind: 'feature',
          title: 'Search',
          parts: { goal: 'Find a commit by its message' },
          agent: 'codex',
          documents: ['spec.pdf'],
        },
      ],
    ]);
    expect(mcp.asks().asks).toEqual([]);

    // No agent named: the service's default, as a start's.
    await call(mcp, 'suggest_settings', { kind: 'spike', title: 'Try it', parts: {} });
    expect(calls.at(-1)).toEqual(['suggest', { kind: 'spike', title: 'Try it', parts: {} }]);
  });

  it('refuses a brief with the words of /api/workspaces/suggest, before the advisor runs', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const brief = { kind: 'fix', title: 'The button', parts: { happens: 'It does nothing' } };
    const cases: [Record<string, unknown>, string][] = [
      [{}, 'kind: feature, fix, refactor, chore or spike'],
      [{ ...brief, kind: 'epic' }, 'kind: feature, fix, refactor, chore or spike'],
      [{ ...brief, title: 7 }, "title: the work's name"],
      [{ ...brief, parts: { happens: 1 } }, 'parts: each a text'],
      [{ ...brief, parts: ['It does nothing'] }, 'parts: each a text'],
      [{ ...brief, agent: 7 }, 'agent: claude or codex'],
      [{ ...brief, agent: 'nope' }, 'agent: claude or codex'],
      [{ ...brief, documents: [{ id: 'd1', name: 'spec.pdf' }] }, "documents: each a file's name"],
    ];
    for (const [args, words] of cases) {
      // The endpoint's parser says the same for the same body.
      expect(() => parseSuggestRequest(JSON.stringify(args)), JSON.stringify(args)).toThrow(words);
      expect(await call(mcp, 'suggest_settings', args), JSON.stringify(args)).toEqual({
        text: words,
        isError: true,
        value: undefined,
      });
    }
    expect(calls).toEqual([]);
  });

  it("passes the advisor's refusal or failure through in its words, nothing in its place", async () => {
    for (const [refused, status] of [
      ['Codex declined the request', 502],
      ['Codex gave no answer within 20 s', 502],
      ['the answer was not one Symbiote can use', 502],
      ['Claude Code is not installed', 409],
    ] as const) {
      const mcp = server(
        fakes({ suggest: () => Promise.reject(new WorkspaceRefused(refused, status)) }).services,
      );
      expect(
        await call(mcp, 'suggest_settings', { kind: 'chore', title: 'Bump', parts: {} }),
      ).toEqual({ text: refused, isError: true, value: undefined });
    }
  });

  it('is left out without workspaces', async () => {
    const { services } = fakes();
    const mcp = server({ ...services, workspaces: undefined });
    const answer = (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, NUCLEUS)) as {
      result: { tools: { name: string }[] };
    };
    expect(answer.result.tools.map((t) => t.name)).not.toContain('suggest_settings');
  });
});

describe("Symbiote's MCP: classify_issue (HV9c, decision 1058)", () => {
  const listed = async (services: ReturnType<typeof fakes>['services']) =>
    (
      (await server(services).handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, NUCLEUS)) as {
        result: {
          tools: {
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
            annotations: Record<string, unknown>;
          }[];
        };
      }
    ).result.tools;

  it("is listed with the classifier: an issue's number, acting, with no Confirm", async () => {
    const tool = (await listed(fakes().services)).find((t) => t.name === 'classify_issue');
    expect(tool?.inputSchema).toEqual({
      type: 'object',
      properties: {
        number: { type: 'integer', minimum: 1, description: expect.any(String) as unknown },
      },
      required: ['number'],
      additionalProperties: false,
    });
    // It writes a record and starts nothing: acting, not destructive, never asked.
    expect(tool?.annotations).toEqual({ readOnlyHint: false, destructiveHint: false });
    expect(tool?.description).not.toContain("the person's Confirm");
    expect(tool?.description).toContain('starts nothing');
  });

  it('answers the decision at once: the reasons, the work, the brief, the cost', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const answer = await call(mcp, 'classify_issue', { number: 12 });
    expect(answer.isError).toBe(false);
    expect(answer.value).toEqual({
      issue: 12,
      url: 'https://github.com/acme/app/issues/12',
      title: 'The search ignores case',
      decision: 'take',
      held: ['new-dependency'],
      reasons: ['A clear bug with a reproduction.'],
      work: {
        kind: 'fix',
        title: 'Make the search ignore case',
        size: 'small',
        model: 'sonnet',
        effort: 'medium',
      },
      flags: ['new-dependency'],
      brief: TAKEN.brief,
      commentsLeftOut: 2,
      classifier: { model: 'opus', effort: 'high' },
      cost: 0.031,
      at: '2026-11-14T10:00:00.000Z',
      page: 'http://127.0.0.1:4100/issues?number=12',
    });
    expect(calls).toEqual([['classify', 12]]);
    expect(mcp.asks().asks).toEqual([]);
  });

  it('answers an ask with its question, a refusal with its word, a failure with why', async () => {
    const answers: Record<number, IssueRecord> = {
      3: {
        ...TAKEN,
        number: 3,
        decision: 'ask',
        held: undefined,
        brief: undefined,
        answer: { ...TAKEN.answer, decision: 'ask', question: 'Which browser?', flags: [] },
      } as unknown as IssueRecord,
      4: {
        ...TAKEN,
        number: 4,
        decision: 'refuse',
        refusal: 'unsafe',
        refusedBy: ['secrets'],
        held: undefined,
        brief: undefined,
        answer: { ...TAKEN.answer, decision: 'take', flags: ['secrets'] },
      } as unknown as IssueRecord,
      5: {
        ...TAKEN,
        number: 5,
        decision: 'failed',
        failed: 'reasons',
        held: undefined,
        brief: undefined,
        answer: undefined,
      } as unknown as IssueRecord,
    };
    const mcp = server(
      fakes({ classify: (number) => Promise.resolve(answers[number] as IssueRecord) }).services,
    );
    expect((await call(mcp, 'classify_issue', { number: 3 })).value).toMatchObject({
      decision: 'ask',
      question: 'Which browser?',
    });
    const refused = (await call(mcp, 'classify_issue', { number: 4 })).value;
    expect(refused).toMatchObject({
      decision: 'refuse',
      refusal: 'unsafe',
      refusedBy: ['secrets'],
    });
    expect(refused).not.toHaveProperty('work');
    expect(refused).not.toHaveProperty('brief');
    expect((await call(mcp, 'classify_issue', { number: 5 })).value).toMatchObject({
      decision: 'failed',
      failed: 'reasons',
    });
  });

  it("passes the classifier's refusal through in the page's words", async () => {
    const words = 'Hive mode is off: the classifier runs only while it is on';
    const mcp = server(
      fakes({ classify: () => Promise.reject(new IssueRefused(words, 409)) }).services,
    );
    expect(await call(mcp, 'classify_issue', { number: 12 })).toEqual({
      text: words,
      isError: true,
      value: undefined,
    });
  });

  it("refuses what is not an issue's number, before the classifier runs", async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    for (const number of [0, -1, 1.5, '12', null, 1e11]) {
      expect(await call(mcp, 'classify_issue', { number }), String(number)).toEqual({
        text: "number: an issue's number, as 12",
        isError: true,
        value: undefined,
      });
    }
    expect(calls).toEqual([]);
  });

  it('is left out without the classifier', async () => {
    const { services } = fakes();
    const tools = await listed({ ...services, issueClassifier: undefined });
    expect(tools.map((t) => t.name)).not.toContain('classify_issue');
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

describe("Symbiote's MCP: Nucleus's calls recorded (NU2, decision 607)", () => {
  const recorder = () => {
    const lines: NucleusActivityLine[] = [];
    return { lines, record: (line: NucleusActivityLine) => void lines.push(line) };
  };
  let clock = Date.parse('2026-10-30T10:00:00Z');
  const now = () => new Date((clock += 1000));

  it("a read: its arguments, its answer's start and its time", async () => {
    const { services } = fakes();
    const { lines, record } = recorder();
    const mcp = server(services, { record, now });
    await call(mcp, 'merges', { branch: 'fix/a' });
    expect(lines).toEqual([
      {
        at: expect.any(String) as unknown,
        session: 'symbiote',
        id: expect.stringMatching(/^m1-/) as unknown,
        tool: 'merges',
        source: 'symbiote',
        phase: 'start',
        input: '{"branch":"fix/a"}',
      },
      {
        at: expect.any(String) as unknown,
        session: 'symbiote',
        id: (lines[0] as { id?: string } | undefined)?.id,
        tool: 'merges',
        source: 'symbiote',
        phase: 'end',
        ms: 1000,
        output: expect.stringContaining('"merges"') as unknown,
      },
    ]);
  });

  it('a Confirm: asked, its end, and what the yes did', async () => {
    const { services } = fakes();
    const { lines, record } = recorder();
    const mcp = server(services, { record, now });
    const pending = call(mcp, 'queue_merge', { branch: 'fix/a' });
    const id = await askOf(mcp);
    expect(lines.at(-1)).toEqual({
      at: expect.any(String) as unknown,
      kind: 'confirm',
      ask: id,
      tool: 'queue_merge',
      words: `Merge fix/a at ${HEAD.slice(0, 7)} into main`,
      call: expect.stringMatching(/^m1-/) as unknown,
      stage: 'asked',
      until: expect.any(String) as unknown,
    });
    await mcp.answer({ id, yes: true });
    await pending;
    expect(lines.map((l) => ('kind' in l ? `${l.kind}` : l.phase))).toEqual([
      'start',
      'confirm',
      'confirm',
      'end',
    ]);
    expect(lines[2]).toMatchObject({
      kind: 'confirm',
      ask: id,
      stage: 'ended',
      answer: 'confirmed',
    });
    expect(lines[3]).toMatchObject({
      phase: 'end',
      output: expect.stringContaining('queued') as unknown,
    });
  });

  it('declined, and not answered in time', async () => {
    const { services } = fakes({ merges: [entry()] });
    const { lines, record } = recorder();
    const mcp = server(services, { askMs: 40, record });
    const declined = call(mcp, 'land_merge', { id: 'm1' });
    await mcp.answer({ id: await askOf(mcp), yes: false });
    await declined;
    await call(mcp, 'land_merge', { id: 'm1' });
    const ends = lines.filter((l) => 'kind' in l && l.kind === 'confirm' && l.stage === 'ended');
    expect(ends.map((l) => ('answer' in l ? l.answer : ''))).toEqual(['declined', 'expired']);
    const calls = lines.filter((l) => 'phase' in l && l.phase === 'end');
    expect(calls).toMatchObject([
      { failed: true, output: expect.stringContaining('The person declined') as unknown },
      { failed: true, output: expect.stringContaining('No answer') as unknown },
    ]);
  });

  it("records only Nucleus's calls", async () => {
    const { services } = fakes();
    const { lines, record } = recorder();
    const mcp = server(services, { record });
    await call(mcp, 'workspaces', {}, { via: 'mcp', client: 'claude-code' });
    expect(lines).toEqual([]);
  });
});

describe("Symbiote's MCP: Nucleus starts without a Confirm (NU8, decisions 782-787)", () => {
  const request = {
    kind: 'fix',
    title: 'The button',
    branch: 'fix/the-button',
    parts: { happens: 'It does nothing' },
    planFirst: true,
    agent: 'codex',
  };
  const recorder = () => {
    const lines: NucleusActivityLine[] = [];
    return { lines, record: (line: NucleusActivityLine) => void lines.push(line) };
  };
  /** The tools' descriptions and the instructions, as `caller` reads them. */
  async function texts(mcp: Mcp, caller: McpCaller = NUCLEUS) {
    const listed = (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, caller)) as {
      result: { tools: { name: string; description: string }[] };
    };
    const init = (await mcp.handle(
      { jsonrpc: '2.0', id: 2, method: 'initialize', params: {} },
      caller,
    )) as { result: { instructions: string } };
    return { tools: listed.result.tools, instructions: init.result.instructions };
  }

  it('starts at once with the setting on: no ask, recorded as started without one', async () => {
    const { services, calls } = fakes();
    const { lines, record } = recorder();
    const mcp = server(services, { record, withoutConfirm: () => Promise.resolve('setting') });
    const done = await call(mcp, 'start_workspace', request);
    expect(done.isError).toBe(false);
    expect(done.value).toMatchObject({
      workspace: { branch: 'fix/the-button' },
      withoutConfirm: 'setting',
    });
    expect(calls).toContainEqual(['start', { ...request, via: 'nucleus' }]);
    expect(mcp.asks().asks).toEqual([]);
    expect(lines.map((l) => ('kind' in l ? `${l.kind}` : l.phase))).toEqual([
      'start',
      'confirm',
      'end',
    ]);
    expect(lines[1]).toEqual({
      at: expect.any(String) as unknown,
      kind: 'confirm',
      ask: expect.any(String) as unknown,
      tool: 'start_workspace',
      words: 'Start fix/the-button, "The button", with Codex, plan first',
      call: (lines[0] as { id?: string }).id,
      stage: 'skipped',
      why: 'setting',
    });
    expect(lines[2]).toMatchObject({ phase: 'end' });
    expect(lines[2]).not.toHaveProperty('failed');
  });

  it('starts at once while Hive is on, and says so', async () => {
    const { services } = fakes();
    const mcp = server(services, { withoutConfirm: () => Promise.resolve('hive') });
    const done = await call(mcp, 'start_workspace', request);
    expect(done.value).toMatchObject({ withoutConfirm: 'hive' });
    expect(mcp.asks().asks).toEqual([]);
  });

  it('reads the setting at each call: off again, the start asks', async () => {
    let why: 'setting' | undefined = 'setting';
    const { services } = fakes();
    const mcp = server(services, { withoutConfirm: () => Promise.resolve(why) });
    await call(mcp, 'start_workspace', request);
    why = undefined;
    const pending = call(mcp, 'start_workspace', { ...request, branch: 'fix/two' });
    const id = await askOf(mcp);
    await mcp.answer({ id, yes: true });
    expect((await pending).value).not.toHaveProperty('withoutConfirm');
  });

  it('still checks the start first: a wrong brief starts nothing', async () => {
    const { services, calls } = fakes();
    const mcp = server(services, { withoutConfirm: () => Promise.resolve('setting') });
    const done = await call(mcp, 'start_workspace', { ...request, kind: 'nope' });
    expect(done.isError).toBe(true);
    expect(calls.some((c) => c[0] === 'start')).toBe(false);
  });

  it("asks the person's own agents through symbiote mcp, whatever the setting", async () => {
    const { services } = fakes();
    const mcp = server(services, { withoutConfirm: () => Promise.resolve('setting') });
    const pending = call(mcp, 'start_workspace', request, { via: 'mcp', client: 'codex' });
    const id = await askOf(mcp);
    await mcp.answer({ id, yes: true });
    expect((await pending).value).not.toHaveProperty('withoutConfirm');
  });

  it('still asks for every other asked tool', async () => {
    // Its entry another branch's: fix/a's approval queues it (MC3, decision 991).
    const { services } = fakes({ merges: [entry({ branch: 'fix/z' })] });
    const mcp = server(services, { withoutConfirm: () => Promise.resolve('setting') });
    const asked: [string, Record<string, unknown>][] = [
      ['restart_agent', { branch: 'fix/a' }],
      ['clean_workspace', { branch: 'fix/a' }],
      ['finish_review', { branch: 'fix/a', event: 'approve', summary: 'Good' }],
      ['queue_merge', { branch: 'fix/a' }],
      ['land_merge', { id: 'm1' }],
      ['retry_merge', { id: 'm1' }],
      ['recheck_merge', { id: 'm1' }],
      ['remove_merge', { id: 'm1' }],
    ];
    for (const [name, args] of asked) {
      const pending = call(mcp, name, args);
      const id = await askOf(mcp);
      expect(mcp.asks().asks[0]?.tool).toBe(name);
      await mcp.answer({ id, yes: false });
      expect((await pending).text).toContain('The person declined');
    }
  });

  it("says in start_workspace's description and the instructions, for Nucleus only", async () => {
    const before = await texts(server(fakes().services));
    const off = await texts(
      server(fakes().services, { withoutConfirm: () => Promise.resolve(undefined) }),
    );
    expect(off).toEqual(before);

    const on = server(fakes().services, { withoutConfirm: () => Promise.resolve('setting') });
    const nucleus = await texts(on);
    const start = nucleus.tools.find((t) => t.name === 'start_workspace');
    expect(start?.description).toContain("Starts at once, without the person's Confirm");
    expect(start?.description).not.toContain("Waits for the person's Confirm");
    expect(start?.description).toContain('Settings');
    for (const tool of nucleus.tools.filter((t) => t.name !== 'start_workspace')) {
      expect(tool.description).toBe(before.tools.find((t) => t.name === tool.name)?.description);
    }
    expect(nucleus.instructions).toContain('start_workspace starts at once');
    expect(nucleus.instructions).not.toBe(before.instructions);
    // Another caller reads today's texts.
    expect(await texts(on, { via: 'mcp', client: 'codex' })).toEqual(
      await texts(server(fakes().services), { via: 'mcp', client: 'codex' }),
    );

    const hive = await texts(
      server(fakes().services, { withoutConfirm: () => Promise.resolve('hive') }),
    );
    expect(hive.tools.find((t) => t.name === 'start_workspace')?.description).toContain(
      'Hive mode is on',
    );
  });

  it('has no tool that reads or changes the setting', () => {
    for (const tool of MCP_TOOLS) {
      expect(`${tool.name} ${tool.description}`).not.toMatch(/without a Confirm|nucleus-start/i);
    }
  });
});

describe("Symbiote's MCP: start_from_issue (HV10b, decisions 1011, 1012, 1061)", () => {
  async function listed(mcp: Mcp, caller: McpCaller = NUCLEUS) {
    const answer = (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, caller)) as {
      result: {
        tools: {
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
          annotations: Record<string, unknown>;
        }[];
      };
    };
    return answer.result.tools.find((t) => t.name === 'start_from_issue');
  }

  it("takes an issue's number and a start branch; asks for a Confirm unless Hive starts it at once", async () => {
    const tool = await listed(server(fakes().services));
    expect(tool?.inputSchema).toEqual({
      type: 'object',
      properties: {
        number: { type: 'integer', minimum: 1, description: expect.any(String) as unknown },
        from: { type: 'string', description: expect.any(String) as unknown },
      },
      required: ['number'],
      additionalProperties: false,
    });
    expect(tool?.annotations).toEqual({ readOnlyHint: false, destructiveHint: false });
    expect(tool?.description).toContain("the person's Confirm");
    expect(tool?.description).toContain('start_workspace');
    const hive = await listed(server(fakes().services, { withoutConfirm: () => Promise.resolve('hive') }));
    expect(hive?.description).toContain("Starts at once, without the person's Confirm: Hive mode is on.");
  });

  it("starts Nucleus's at once while Hive is on: by Nucleus, from the branch given", async () => {
    const { services, calls } = fakes();
    const mcp = server(services, { withoutConfirm: () => Promise.resolve('hive') });
    const done = await call(mcp, 'start_from_issue', { number: 12, from: 'release' });
    expect(done.isError).toBe(false);
    expect(done.value).toMatchObject({
      workspace: { branch: 'fix/12-the-search-ignores-case', issue: { number: 12 } },
      withoutConfirm: 'hive',
    });
    expect(calls).toContainEqual(['startFromIssue', 12, { by: 'nucleus', from: 'release' }]);
    expect(mcp.asks().asks).toEqual([]);
  });

  it("asks the person's own agents through symbiote mcp, and starts on their yes", async () => {
    const { services, calls } = fakes();
    const mcp = server(services, { withoutConfirm: () => Promise.resolve('hive') });
    const pending = call(mcp, 'start_from_issue', { number: 12 }, { via: 'mcp', client: 'codex' });
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe('Start a Hive workspace from issue #12');
    await mcp.answer({ id, yes: true });
    expect((await pending).value).toMatchObject({ workspace: { issue: { number: 12 } } });
    expect(calls).toContainEqual(['startFromIssue', 12, { by: 'mcp' }]);
  });

  it("answers a refusal in the start's words, and a wrong number before anything runs", async () => {
    const { services, calls } = fakes({
      startFromIssue: () => Promise.reject(new Error('Issue #12 is not taken: the classifier refused it')),
    });
    const mcp = server(services, { withoutConfirm: () => Promise.resolve('hive') });
    const refused = await call(mcp, 'start_from_issue', { number: 12 });
    expect(refused).toMatchObject({
      isError: true,
      text: 'Issue #12 is not taken: the classifier refused it',
    });
    const wrong = await call(mcp, 'start_from_issue', { number: 'twelve' });
    expect(wrong).toMatchObject({ isError: true, text: "number: an issue's number, as 12" });
    expect(calls.filter((c) => c[0] === 'startFromIssue')).toHaveLength(1);
  });
});
