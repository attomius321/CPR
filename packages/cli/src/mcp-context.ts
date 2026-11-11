// What Symbiote's MCP is given and what its tools share (decision 962): the services, the options
// and their times, the asks held for the person, the one-at-a-time rule. A family of tools takes a
// `Pick<>` of `McpContext` (decision 963).
import type {
  McpAsk,
  McpCaller,
  NucleusActivityLine,
  RepoStatus,
  WithoutConfirm,
} from '@symbiote/core';
import type { CodeMap } from '@symbiote/monitor';
import type { DiffStatus, Pair } from './diffs.js';
import type { MarkMerged } from './mark-merged.js';
import type { Merger } from './merges.js';
import type { BranchReviews } from './reviews.js';
import type { UsageService } from './usage.js';
import type { PageAgent } from './page-agent.js';
import type { Workspaces } from './workspace-context.js';
import type { Args } from './mcp-tools.js';
import type { Recording } from './mcp-confirm.js';

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
    | 'suggest'
    | 'changes'
    | 'merge'
    | 'thread'
    | 'exportActivity'
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
    | 'mergeCommit'
    | 'remove'
    | 'approve'
    | 'requestChanges'
    | 'log'
  >;
  usage?: Pick<UsageService, 'report'>;
  /** Merged work marked in the docs (MC3, decision 990), where the repository sets `merged`. */
  marks?: Pick<MarkMerged, 'configured' | 'preview' | 'mark'>;
  monitor?: { map(): Promise<CodeMap> };
  /** Nucleus (NU2): its activity, taken out (V84). */
  nucleus?: Pick<PageAgent, 'exportActivity'>;
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
  /**
   * Records one of Nucleus's calls (NU2, decision 607): its start and end, and a Confirm asked and
   * its end. Only Nucleus's calls; never throws.
   */
  record?: (line: NucleusActivityLine) => void;
  /**
   * Why Nucleus's `start_workspace` goes without the person's Confirm now (NU8, decisions 783,
   * 784): Hive mode on, or the person's setting; undefined: it asks. Read at each call and listing.
   */
  withoutConfirm?: () => Promise<WithoutConfirm | undefined>;
  /** Each ask held or let go (V94a): the page's stream sends the asks then. */
  onAsks?: () => void;
  /** How long a lapsed ask is kept for a late yes (MC3, decision 994): 24 hours. */
  keepMs?: number;
}

/** One action of a batch (MC3, decision 987): what it acts on, its words, what doing it gives. */
export interface PreparedItem {
  name: string;
  words: string;
  /** Checked before asking: why it cannot be done; it is not done. */
  cant?: string;
  act: () => Promise<Record<string, unknown>>;
}

/**
 * An asked call's way to the person: its words, then what to do on the yes; or a batch's items,
 * done in order on the yes, each said `did` once done (`started`, `cleaned`).
 */
export type Prepared =
  | { words: string; act: () => Promise<unknown> }
  | { words: string; items: PreparedItem[]; did: string };

/** An ask held for the person (decision 361): waiting, then lapsed, being done or done (MC3). */
export interface Held {
  ask: McpAsk;
  /** The person's answer while it waits; `items`, a batch's ticked ones. */
  settle(answer: 'yes' | 'no' | 'expired' | 'gone', items?: readonly string[]): void;
  /** Once what it asked is done, or not done: the person's answer is answered then. */
  finished: Promise<void>;
  /** For a late yes (MC3): the call prepared again, its record, and what makes it the same ask. */
  again: () => Promise<Prepared>;
  recording: Recording | null;
  same: string;
  /** Once lapsed: when it goes. */
  keep?: ReturnType<typeof setTimeout>;
}

/** What became of a lapsed ask (MC3, decision 994), for `overview`; kept as long as it is. */
export interface Lapsed {
  words: string;
  asked: string;
  now: 'waiting' | 'done' | 'failed' | 'dismissed';
  results?: Record<string, unknown>[];
  /** When it is forgotten. */
  until: number;
}

/** What `symbioteMcp`'s tools share. */
export interface McpContext {
  services: McpServices;
  options: McpOptions;
  url: () => string;
  now: () => Date;
  askMs: number;
  analysisMs: number;
  pollMs: number;
  minuteMs: number;
  /** The asks waiting for the person, by ID; lapsed, being done and done ones too (MC3). */
  held: Map<string, Held>;
  /** What became of lapsed asks, by ID (MC3). */
  lapsed: Map<string, Lapsed>;
  keepMs: number;
  exclusive: <T>(words: string, task: () => Promise<T>) => Promise<T>;
}

/** A tool that runs at once: its value. */
export type McpRead = (args: Args, caller: McpCaller, signal: AbortSignal) => Promise<unknown>;

/** A tool that asks the person first: its words, and what it does once they confirm. */
export type McpAsking = (args: Args, caller: McpCaller, signal: AbortSignal) => Promise<Prepared>;
