// Symbiote's MCP as its clients read it (refactor/cli-services): `initialize` and `tools/list`, with
// every service and with none, for Nucleus and for an agent through `symbiote mcp`, with and
// without Nucleus's start that needs no Confirm. Kept in a file snapshot: a tool lost, or its words
// or schema changed, in a refactor changes it.
import type { McpCaller, WithoutConfirm } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import type { McpServices } from '../src/mcp-context.js';
import { symbioteMcp } from '../src/mcp.js';

/** A service whose every method answers `{ fake: <its name> }`; never a promise itself. */
function fake<T>(): T {
  return new Proxy(
    {},
    {
      get(_, key) {
        if (typeof key === 'symbol' || key === 'then' || key === 'toJSON') return undefined;
        return () => Promise.resolve({ fake: key });
      },
    },
  ) as T;
}

const bare: McpServices = {
  status: fake<McpServices['status']>(),
  readFile: () => Promise.resolve('text'),
  diffs: { start: () => undefined, status: () => undefined },
};
const everything: McpServices = {
  ...bare,
  name: 'tools',
  workspaces: fake(),
  reviews: fake(),
  merges: fake(),
  usage: fake(),
  monitor: fake(),
  nucleus: fake(),
  // mark_merged's commands named (MC3): listed.
  marks: {
    configured: () => true,
    preview: () => Promise.reject(new Error('unused')),
    mark: () => Promise.reject(new Error('unused')),
  },
};

const CALLERS: Record<string, McpCaller> = {
  nucleus: { via: 'nucleus' },
  agent: { via: 'mcp', client: 'claude-code', folder: '/w/fix-a' },
};

async function listed(
  services: McpServices,
  caller: McpCaller,
  withoutConfirm?: WithoutConfirm,
): Promise<unknown> {
  const mcp = symbioteMcp(services, {
    version: '0.0.0-tools',
    url: () => 'http://127.0.0.1:4100/',
    ...(withoutConfirm ? { withoutConfirm: () => Promise.resolve(withoutConfirm) } : {}),
  });
  try {
    const init = await mcp.handle(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      caller,
    );
    const tools = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, caller);
    return { initialize: init, 'tools/list': tools };
  } finally {
    mcp.close();
  }
}

describe("Symbiote's MCP tools as listed (refactor/cli-services)", () => {
  it('lists the same tools, words and schemas as before', async () => {
    const all: Record<string, unknown> = {};
    for (const [who, caller] of Object.entries(CALLERS)) {
      all[`everything, ${who}`] = await listed(everything, caller);
      all[`everything, ${who}, Hive on`] = await listed(everything, caller, 'hive');
      all[`everything, ${who}, the setting on`] = await listed(everything, caller, 'setting');
      all[`bare, ${who}`] = await listed(bare, caller);
    }
    await expect(JSON.stringify(all, null, 2) + '\n').toMatchFileSnapshot(
      '__snapshots__/mcp-tools.json',
    );
  });
});

/** The tools as listed with every service, mark_merged's commands named (MC3). */
async function everyTool() {
  const answer = (await symbioteMcp(everything, {}).handle(
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    CALLERS.nucleus ?? { via: 'nucleus' },
  )) as {
    result: {
      tools: {
        name: string;
        inputSchema: Record<string, unknown>;
        annotations?: { readOnlyHint?: unknown; destructiveHint?: unknown };
      }[];
    };
  };
  return answer.result.tools;
}

describe('What each tool is, and its arguments refused when unknown (fix-mcp-annotations, MC3 decision 997)', () => {
  const READS = [
    'overview',
    'workspaces',
    'workspace',
    'thread',
    'activity',
    'start_options',
    'suggest_settings',
    'review',
    'merges',
    'merge_log',
    'usage',
    'code_map',
    'wait',
  ];

  it('says of every tool whether it only reads; those that remove something are destructive', async () => {
    const tools = await everyTool();
    expect(tools).toHaveLength(26);
    for (const tool of tools) {
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe('boolean');
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(READS.includes(tool.name));
    }
    const destructive = tools
      .filter((t) => t.annotations?.destructiveHint === true)
      .map((t) => t.name);
    expect(destructive).toEqual(['stop_agent', 'clean_workspace', 'remove_merge']);
    // An acting tool says it destroys nothing unless it does: MCP's default is that it might.
    for (const tool of tools.filter((t) => !READS.includes(t.name))) {
      expect(typeof tool.annotations?.destructiveHint, tool.name).toBe('boolean');
    }
  });

  it('every schema refuses an argument it does not name', async () => {
    for (const tool of await everyTool()) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });

  it('a call with an argument its schema does not name is refused at once, naming it; nothing runs', async () => {
    const mcp = symbioteMcp(everything, { minuteMs: 60_000 });
    const started = Date.now();
    const answer = await mcp.handle(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'wait', arguments: { seconds: 1 } },
      },
      { via: 'nucleus' },
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(answer).toMatchObject({
      result: {
        content: [{ type: 'text', text: 'unknown argument: seconds (wait takes minutes)' }],
        isError: true,
      },
    });
    const none = await mcp.handle(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'overview', arguments: { all: true } },
      },
      { via: 'nucleus' },
    );
    expect(none).toMatchObject({
      result: { content: [{ text: 'unknown argument: all (overview takes none)' }], isError: true },
    });
    mcp.close();
  });
});
