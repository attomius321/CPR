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
