// Symbiote's MCP (MC1): its tools for Nucleus and for the person's own agents (`symbiote mcp`), served
// by `symbiote view` at `/api/mcp`. Types only; the CLI answers the calls and holds the asks.

/**
 * What was made through Symbiote's tools (MC1, decision 362): by Nucleus, or through `symbiote mcp`.
 * Records from before NU1 say `scout`, Nucleus's name then: read as `nucleus` (decision 590).
 */
export type McpVia = 'nucleus' | 'mcp';

/** Who calls a tool: Nucleus, or an agent through `symbiote mcp`, with its name and folder. */
export type McpCaller = { via: 'nucleus' } | { via: 'mcp'; client?: string; folder?: string };

/**
 * What became of one action of an ask that holds several (MC3, decision 987): being done, done,
 * failed, declined (unticked, or the whole ask declined), or not done because it could not be
 * (checked before asking).
 */
export type McpItemOutcome = 'running' | 'done' | 'failed' | 'declined' | 'cant';

/** One action of an ask that holds several (MC3): its row in the Confirm. */
export interface McpAskItem {
  id: string;
  /** What it acts on: a branch. */
  name: string;
  /** The rest of what it does, in words: "“V104 — …”, with Claude Code on opus at xhigh". */
  words: string;
  /** Checked before asking: why it cannot be done; it is not done. */
  cant?: string;
  /** Once confirmed: what became of it, and why it failed. */
  outcome?: McpItemOutcome;
  error?: string;
}

/** A tool's call waiting for the person's Confirm or Decline (MC1, decision 361). */
export interface McpAsk {
  id: string;
  tool: string;
  /** What it will do, in words: "Merge feature/x at abc1234 into main"; a batch's, "Start 3 workspaces". */
  words: string;
  by: McpCaller;
  /** When it was asked, and when it is dropped unanswered: nothing done. */
  at: string;
  until: string;
  /** Several actions in one Confirm (MC3, decision 987), each ticked unless it cannot be done. */
  items?: McpAskItem[];
  /**
   * Past waiting (MC3): `lapsed`, unanswered by `until` and kept until `kept` for a late Confirm
   * or a Dismiss (decision 994); `doing`, confirmed and its items being done; `done`, its results
   * kept to be read (something failed or could not be done) until the person closes them.
   */
  stage?: 'lapsed' | 'doing' | 'done';
  kept?: string;
  /** A single ask confirmed late that failed: why (MC3). */
  failed?: string;
}

/** `GET /api/mcp/asks`: the open asks, oldest first. */
export interface McpAsks {
  asks: McpAsk[];
}

/**
 * `POST /api/mcp/answer`: Confirm or Decline; `items`, a batch's ticked items (all when absent).
 * To a lapsed ask, no is Dismiss; to a done one, either closes it (MC3).
 */
export interface McpAnswer {
  id: string;
  yes: boolean;
  items?: string[];
}
