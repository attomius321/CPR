// The Overview's day (V91): what Symbiote and git recorded since a time, Hive's workspaces and their
// costs. Types only.
import type { WorkKind } from './workspaces.js';
import type { HiveStep, HiveLanding, HiveRequest, HiveSpend, HivePush } from './hive.js';

/**
 * One event of a workspace's day (V91, decision 852), as recorded: an entry of its thread (`asks`,
 * `report`, the person's `prompt`) or a line of Hive's log of it (`check`, `review`, `landed`,
 * `stuck`…, decision 695's kinds).
 */
export interface DayEvent {
  at: string;
  branch: string;
  source: 'thread' | 'hive';
  kind: string;
  /** A thread entry's words: a report's or a prompt's first line, a question; at most 200. */
  text?: string;
  /** A Hive event's fields as written: `round`, `ok`, `verdict`, `kept`, `cost`, `note`… */
  data?: Record<string, unknown>;
}

/** A merge into the default branch (V91, decision 855): git's first-parent merge commit. */
export interface DayMerge {
  sha: string;
  /** Its committer's time. */
  at: string;
  subject: string;
  into: string;
  /** The branch merged: the merger's subject (`Merge <branch>: …`), else its second parent's. */
  branch?: string;
  /** In `origin/<into>`: pushed. Absent without that remote branch. */
  pushed?: boolean;
}

/**
 * A writer's session total by Claude Code's own count (decision 856): a transcript's `cost-state`
 * line, timed by the nearest line before it with a `timestamp` (the turn's end).
 */
export interface CostPoint {
  /** The transcript it is of: its index in the writer's transcripts. */
  transcript: number;
  at: string;
  total: number;
}

/** A Hive workspace's record as the Overview reads it (V91, decisions 852, 856). */
export interface HiveDayRecord {
  branch: string;
  title?: string;
  kind?: WorkKind;
  /** When Hive started it: its brief. */
  started: string;
  step: HiveStep;
  round: number;
  rounds: number;
  note?: string;
  landings?: HiveLanding[];
  pushed?: HivePush;
  request?: HiveRequest;
  /** Each running review: its round, the defects it proved (findings kept), its cost. */
  reviews: { round: number; kept: number; cost?: number }[];
  /** What it spent in all (HV5), and its budget. */
  spend: HiveSpend;
  /**
   * Its writer's totals since `since`, and each transcript's last one before it (the day's
   * baseline); absent when its transcripts were not read.
   */
  writer?: CostPoint[];
  /** Cleaned up (V77): no longer listed. */
  finished?: string;
}

/**
 * `GET /api/workspaces/day?since=` (V91, decision 852): what Symbiote and git recorded since
 * `since` (the page's local midnight, six days back): read, never written.
 */
export interface WorkspaceDay {
  since: string;
  /** The default branch, merged into; null when there is none. */
  into: string | null;
  /** Oldest first. */
  events: DayEvent[];
  /** Oldest first. */
  merges: DayMerge[];
  /** Each workspace's start, open and finished: a merge's or a landing's time to it. */
  started: Record<string, string>;
  /** Each Hive record in flight, or touched since `since`. */
  hive: HiveDayRecord[];
}
