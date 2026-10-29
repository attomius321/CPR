// Symbiote's MCP (MC1): its tools for Nucleus and for the person's own agents (`symbiote mcp`), served
// by `symbiote view` at `/api/mcp`. Types only; the CLI answers the calls and holds the asks.

/** What was made through Symbiote's tools (MC1, decision 362): by Nucleus, or through `symbiote mcp`. */
export type McpVia = 'scout' | 'mcp';

/** Who calls a tool: Nucleus, or an agent through `symbiote mcp`, with its name and folder. */
export type McpCaller = { via: 'scout' } | { via: 'mcp'; client?: string; folder?: string };

/** A tool's call waiting for the person's Confirm or Decline (MC1, decision 361). */
export interface McpAsk {
  id: string;
  tool: string;
  /** What it will do, in words: "Merge feature/x at abc1234 into main". */
  words: string;
  by: McpCaller;
  /** When it was asked, and when it is dropped unanswered: nothing done. */
  at: string;
  until: string;
}

/** `GET /api/mcp/asks`: the open asks, oldest first. */
export interface McpAsks {
  asks: McpAsk[];
}

/** `POST /api/mcp/answer`. */
export interface McpAnswer {
  id: string;
  yes: boolean;
}
