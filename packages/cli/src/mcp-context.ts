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
import type { Merger } from './merges.js';
import type { BranchReviews } from './reviews.js';
import type { UsageService } from './usage.js';
import type { PageAgent } from './page-agent.js';
import type { Workspaces } from './workspace-context.js';
import type { Args } from './mcp-tools.js';

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
}

/** An asked call's way to the person: its words, then what to do on the yes. */
interface Prepared {
  words: string;
  act: () => Promise<unknown>;
}

/** An ask held for the person (decision 361). */
export interface Held {
  ask: McpAsk;
  settle(answer: 'yes' | 'no' | 'expired' | 'gone'): void;
  /** Once what it asked is done, or not done: the person's answer is answered then. */
  finished: Promise<void>;
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
  /** The asks waiting for the person, by ID. */
  held: Map<string, Held>;
  exclusive: <T>(words: string, task: () => Promise<T>) => Promise<T>;
}

/** A tool that runs at once: its value. */
export type McpRead = (args: Args, caller: McpCaller, signal: AbortSignal) => Promise<unknown>;

/** A tool that asks the person first: its words, and what it does once they confirm. */
export type McpAsking = (args: Args, caller: McpCaller, signal: AbortSignal) => Promise<Prepared>;
