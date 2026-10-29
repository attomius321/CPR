import type { McpAsk, McpVia } from '@symbiote/core';

/** The agents' MCP clients by the names they introduce themselves with. */
const CLIENTS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex-mcp-client': 'Codex',
};

/** Who asks (MC1): Nucleus, or an agent through `symbiote mcp` and the folder it runs in. */
export function askedBy(ask: McpAsk): string {
  if (ask.by.via === 'scout') return 'Scout';
  const client = ask.by.client ? (CLIENTS[ask.by.client] ?? ask.by.client) : undefined;
  const folder = ask.by.folder?.replace(/\/+$/, '').split('/').at(-1);
  if (!client) return 'An agent';
  return folder ? `${client} in ${folder}` : client;
}

/** How long the ask waits for the person, in minutes rounded up; then nothing is done. */
export function askLeft(ask: McpAsk, now: number): string {
  const ms = Date.parse(ask.until) - now;
  return ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min left` : 'under a minute left';
}

/** Whether one of `asks` is `via`'s: the sidenav marks Nucleus while it waits on the person. */
export function asksBy(asks: readonly McpAsk[], via: McpVia): boolean {
  return asks.some((ask) => ask.by.via === via);
}
