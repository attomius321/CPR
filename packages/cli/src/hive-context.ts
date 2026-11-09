// What Hive's runner is given and what its steps share (decision 962): its options, `closed`
// (read live, as `ctx.closed`: set once the runner closes), the checks, reviews and messages in
// flight. A step's module takes a `Pick<>` of `HiveContext` (decision 963).
import type { GitRepo, MergeEntry, WorkspaceSummary } from '@symbiote/core';
import type { ChangeRequest } from '@symbiote/forge';
import type { Logger } from '@symbiote/log';
import type { HiveRecord } from './hive.js';
import type { HiveFile } from './hive-record.js';
import type { Confine, ReviewRun } from './hive-review.js';
import type { HivePacing } from './hive-pacing.js';
import type { HiveRequests } from './hive-request.js';
import type { Merger } from './merges.js';
import type { GroupRun, RunGroup, SpawnGroup } from './programs.js';
import type { BranchReviews, ReviewPlace } from './reviews.js';
import type { Workspaces } from './workspace-context.js';

/** How a branch is being landed (decision 717): merged, or in the merge queue. */
export type Landing = 'merged' | 'queued';

/**
 * What the gate saw: no request it awaits; not due a read yet; a read that failed; an end it
 * acted on (merged, closed, merged outside it, cannot merge); or the request open, as read.
 */
export type GateSeen =
  { seen: 'none' | 'not-due' | 'failed' | 'ended' } | { seen: 'open'; read: ChangeRequest };

/** What the runner asks of the workspaces (`workspaces.ts`). */
export type HiveWorkspaces = Pick<Workspaces, 'summaryOf' | 'reply' | 'stopAgent' | 'startAgent'>;

/** Why a check or a review was stopped before its end; a landing (decision 717) says which. */
export type Stop = 'off' | 'took-over' | 'close' | Landing;

/** A check this runner runs, and why it was stopped, if it was. */
export interface Running {
  run: GroupRun;
  stopped?: Stop;
}

/** A review this runner runs (HV3), and why it was stopped, if it was. */
export interface Reviewing {
  run: ReviewRun;
  stopped?: Stop;
}

/** The running reviewer's surroundings (HV3): Claude Code, how a rerun is confined, the limits. */
export interface HiveReviewer {
  /** Claude Code's program; null when there is none. */
  claude: () => Promise<string | null>;
  /** How a rerun is confined (bubblewrap); null where it cannot be: then nothing is reviewed. */
  confine: () => Promise<Confine | null>;
  run?: RunGroup;
  spawn?: SpawnGroup;
  reviewerMs?: number;
  rerunMs?: number;
}

/**
 * What Hive lands with (HV4, decision 767): the branch's review, where its approval is recorded,
 * and the merge queue it queues the approved commit in.
 */
export interface HiveLander {
  reviews: Pick<BranchReviews, 'resolve' | 'finish'>;
  merges: Pick<Merger, 'targets' | 'enqueue' | 'land' | 'remove'>;
  /** Landing by a pull or merge request, where the repository says so (HV8, decision 788). */
  requests?: HiveRequests;
}

/** How Hive's runner runs: its record, the workspaces it drives, its clock and timers, its check's
 * runner, the reviewer, the merge queue, the lander and the pacing gate. */
export interface HiveRunnerOptions {
  hive: HiveRecord;
  workspaces: HiveWorkspaces;
  now?: () => Date;
  /** Where `symbiote/config.json` is read: the check and the prompts. */
  root?: string;
  /** How often it looks while Hive is on, and while it is off (0: only when asked, tests). */
  interval?: number;
  offInterval?: number;
  /** Its process, as the lock names it. */
  pid?: number;
  /** How a check's command runs. */
  run?: RunGroup;
  /** The running reviewer's surroundings (HV3). */
  reviewer?: HiveReviewer;
  /**
   * The merge queue's entries (decision 717): a branch it has is being landed. Its file in
   * Symbiote's cache, read only (the merger's `list` would start a merge it finds queued).
   */
  merges?: () => Promise<MergeEntry[]>;
  /** How long a message taken may go without its prompt before Hive stops (decision 719). */
  unseenMs?: number;
  /**
   * What Hive lands with (HV4): with it, Hive approves and queues what it checked and reviewed,
   * and pushes the workspace's branch; without it (tests of the loop), landing waits as in HV3.
   */
  lander?: HiveLander;
  /** How long an entry the person's checkout refused waits before Hive lands it again. */
  landRetryMs?: number;
  /** How often an open pull or merge request is read (HV8). */
  requestPollMs?: number;
  /**
   * The gate before every agent Hive starts (HV5): usage and the budget. Without it (tests of
   * the loop), every start goes as before HV5.
   */
  pacing?: HivePacing;
  log?: Pick<Logger, 'info' | 'warn'>;
}

/** What `hiveRunner`'s steps share. */
export interface HiveContext {
  repo: GitRepo;
  cacheDir: string;
  hive: HiveRecord;
  workspaces: HiveWorkspaces;
  now: () => Date;
  root: string;
  run: RunGroup;
  reviewer: HiveReviewer;
  merges: () => Promise<MergeEntry[]>;
  unseenMs: number;
  lander: HiveLander | undefined;
  landRetryMs: number;
  requestPollMs: number;
  pacing: HivePacing | undefined;
  log: Pick<Logger, 'info' | 'warn'> | undefined;
  /** Set once the runner closes or is abandoned: a killed process writes nothing more. */
  closed: boolean;
  /** Each workspace's message or check in flight, by branch. */
  actions: Map<string, Promise<void>>;
  checks: Map<string, Running>;
  reviews: Map<string, Reviewing>;
  /** Writers Hive off must stop: tried again at each tick until stopped or gone. */
  toStop: Set<string>;
  /** Where a branch's review copies are, each review in a folder of its own (decision 675). */
  copiesOf: (branch: string) => string;
}

/** The one gate to the forge for a request Hive waits on (HV8): `watchRequest` in `hive-forge.ts`. */
export type WatchRequest = (
  where: ReviewPlace,
  given: HiveFile,
  known?: WorkspaceSummary,
  options?: { landing?: boolean },
) => Promise<GateSeen>;
