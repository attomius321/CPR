// Hive mode (HV1–HV8): a workspace's steps, its landing and request, the pacing gate's pause and
// budget, its checks and reviews, the logs of its runs, as the server answers and the viewer reads
// them. Types only.
import type { LogLine, LogRead, MergeEntry } from './merges.js';

/**
 * Where Hive is with a workspace it drives (HV2, decision 653): its writer's turn, the check
 * Symbiote runs, the running review of a commit the check passed on (HV3, decision 674), landing
 * asked of the person; `stuck` at the round cap; `landed` once merged.
 */
/**
 * Where Hive is with a workspace (HV2, HV3); `answered` (HV4): a spike that ended without commits,
 * its answer its report, nothing to land.
 */
export type HiveStep =
  'writing' | 'checking' | 'reviewing' | 'landing' | 'stuck' | 'landed' | 'answered';

/**
 * A landing Hive tried (HV4, decisions 767–769): its approval queued through the merge queue, and
 * how it ended. In flight while it has no `outcome`.
 */
export interface HiveLanding {
  round: number;
  /** The commit approved and queued. */
  at: string;
  /** The branch it lands in: the one the workspace started from. */
  into: string;
  /** The merge queue's entry; a request's number, `#12` or `!12` (HV8). */
  entry: string;
  /** Landed through a pull or merge request (HV8): the person's merge on the forge is awaited. */
  via?: 'request';
  queued: string;
  /** The queue's state as Hive last read it, while in flight; and why it waits, if it says. */
  state?: MergeEntry['state'];
  message?: string;
  /** Hive's last Land of an entry the person's checkout refused (decision 770). */
  tried?: string;
  ended?: string;
  outcome?:
    | 'landed'
    | 'conflict'
    | 'check-failed'
    | 'cannot-fast-forward'
    | 'diverged'
    | 'failed'
    | 'refused'
    | 'closed';
  /** Conflicting files; the command that failed and its output's end. */
  files?: string[];
  failed?: string;
  output?: string;
  /** The merge's log, kept beside Hive's record once its entry is removed. */
  log?: string;
  /** Landed: the merge, and the target's push. */
  merge?: string;
  pushed?: MergeEntry['pushed'];
}

/**
 * Hive's pull or merge request of a workspace (HV8, decisions 788–791): opened at landing when the
 * repository's Hive lands by request, watched until the person merges or closes it on the forge.
 */
export interface HiveRequest {
  forge: 'github' | 'gitlab';
  number: number;
  url: string;
  /** The branch it merges into: the one the workspace started from. */
  into: string;
  /** The commit it was opened or last updated for, and when it was opened. */
  at: string;
  opened: string;
  state: 'open' | 'merged' | 'closed';
  /** The forge says it cannot be merged: a conflict with `into`. */
  conflict?: true;
  /** When Hive last read it, and why that read failed, if it did. */
  read?: string;
  error?: string;
  /** Merged: the merge's commit, when the forge says it. */
  merge?: string;
  /** Symbiote's graph review on it (790): of which commit, how many findings, where; or why not. */
  review?: { at: string; posted: number; url?: string; error?: string; tries?: number };
  /** Merged: the start branch brought up to the forge's, or why not (770). */
  pulled?: { at: string; ok: boolean; error?: string };
}

/** How Hive lands a repository's workspaces (HV8, decision 788): the merge queue, or a request. */
export type HiveLandsBy = 'queue' | 'request';

/**
 * `GET /api/hive/landing` (HV8, decision 793): how Hive lands, and with a request, the forge and
 * project `origin` names and whether a token is found; why not, when it cannot.
 */
export interface HiveLandingSetting {
  by: HiveLandsBy;
  /** How a workspace from an issue lands (HV10c, `hive.issues.lands`): a request by default. */
  issues?: HiveLandsBy;
  forge?: { kind: 'github' | 'gitlab'; host: string; project: string };
  token: boolean;
  /** Why a request could not be opened now: no `origin`, no forge, no token. */
  why?: string;
}

/** An ecosystem a repository's root files name, and its hosts (HV10, decision 1052). */
export interface WriterEcosystem {
  name: string;
  files: string[];
  hosts: string[];
}

/**
 * `GET /api/hive/sandbox` (HV10b): the network an issue's writer gets in Claude Code's sandbox,
 * read from the main checkout's root files: each ecosystem and its hosts, the repository's own
 * (`hive.sandbox.allowedDomains`), and the list in force.
 */
export interface HiveSandboxSetting {
  ecosystems: WriterEcosystem[];
  allowedDomains: string[];
  hosts: string[];
}

/**
 * Hive holds its next start of an agent (HV5, decisions 797–800): a window of Claude's subscription
 * at or over the threshold (`usage`), until it resets; or usage that could not be read for 15 min
 * (`unknown`), until a read succeeds. Kept in Hive's record of each workspace it held (`paused`).
 */
export interface HivePause {
  reason: 'usage' | 'unknown';
  /** The window over the threshold: its length (300: 5 hours, 10,080: a week), a model's scope. */
  minutes?: number;
  scope?: string;
  /** Its use, in percent, when Hive paused. */
  percent?: number;
  /** The threshold it paused at (`hive.usage.pauseAt`). */
  pauseAt: number;
  /** When Hive goes on: the window's reset; absent when not known. */
  until?: string;
  /** Why usage is not known: the read's words. */
  why?: string;
  /** When Hive paused. */
  since: string;
}

/**
 * What a Hive workspace spent (HV5, decision 801), in US dollars at list price by Claude Code's own
 * count: its writer's sessions (absent when no count could be read) and its running reviews.
 */
export interface HiveSpend {
  writer?: number;
  reviews: number;
  /** Running reviews with a cost. */
  reviewed: number;
  total: number;
  /** `hive.budget`, when set. */
  budget?: number;
}

/**
 * `GET /api/hive/pacing` (HV5, decisions 797–801): the threshold (`false`: Hive does not pause by
 * usage), the budget per workspace (null: none), whether usage is read (`SYMBIOTE_USAGE=off`: no),
 * and Hive's pause now, if any.
 */
export interface HivePacingSetting {
  pauseAt: number | false;
  budget: number | null;
  read: boolean;
  pause?: HivePause;
}

/** `GET /api/hive/state` (HV4): what turning Hive mode on or off concerns. */
export interface HiveState {
  on: boolean;
  /** When Hive was turned on, while it is on (V92). */
  since?: string;
  /**
   * The check Hive would run now (V92, decision 872): the default checkout's, as the runner finds
   * it (`merge.checks`, else one guessed from the repository), and where from; absent: none.
   */
  check?: { commands: string[]; source: string };
  /** Open workspaces started in normal mode and not merged: Hive does not turn on (decision 772). */
  normal: { branch: string; title?: string }[];
  /** Hive's workspaces writing, checking, reviewing or landing: what Hive off stops (771). */
  flight: {
    branch: string;
    step: HiveStep;
    title?: string;
    /** Waiting for the person's merge of this request on the forge (HV8): Hive off leaves it open. */
    request?: { forge: 'github' | 'gitlab'; number: number };
  }[];
}

/** Hive's push of a workspace's branch to `origin` (HV4, decision 768). */
export interface HivePush {
  at: string;
  /** The commit pushed. */
  sha: string;
  ok: boolean;
  error?: string;
}

/**
 * A defect Hive's running reviewer reported with a test of its own (HV3, decision 678), and what
 * Symbiote's rerun of that test on a fresh copy of the commit made of it.
 */
export interface HiveFinding {
  /** The defect, in the reviewer's words. */
  defect: string;
  /** The failing test's name, as its command's output prints it. */
  test: string;
  /** The command that runs it from the repository's root. */
  command: string;
  /** Its files, repo-relative: kept beside Hive's record for the writer. */
  files: string[];
  /** Kept: its test failed on Symbiote's rerun. Dropped otherwise, with why. */
  kept: boolean;
  why?: string;
  /** The rerun's exit code (null: it did not end by itself) and its output's last lines. */
  code?: number | null;
  output?: string;
}

/**
 * A running review Hive ran (HV3, decisions 674–679): `approved` when it proved no defect,
 * `changes` when a finding was kept, `failed` when the reviewer gave no answer, `unavailable` when
 * it could not run (Claude Code's sandbox missing, say; why in `error`).
 */
export interface HiveReview {
  round: number;
  /** The commit reviewed. */
  at: string;
  verdict: 'approved' | 'changes' | 'failed' | 'unavailable';
  ms: number;
  /** Its cost by Claude Code's own count, in US dollars at list price. */
  cost?: number;
  /** The reviewer's summary, and what it ran. */
  summary?: string;
  ran?: string;
  error?: string;
  /** The model and level it was asked on. */
  model?: string;
  effort?: string;
  findings: HiveFinding[];
  /** Its log beside Hive's record (decision 695): its id, absent when nothing was written. */
  log?: string;
}

/** One command of a check Hive ran, as it ended (decision 693). */
export interface HiveCheckStep {
  command: string;
  ok: boolean;
  ms: number;
}

/** A check Hive ran on a workspace's branch (decision 654). */
export interface HiveCheck {
  round: number;
  /** The commit it ran on. */
  at: string;
  ok: boolean;
  ms: number;
  /** The command that failed. */
  failed?: string;
  /** The last lines of its output. */
  output?: string;
  /**
   * Since decision 693: when it started, the repository's check commands it ran, each one that
   * ran and how it ended, and its log beside Hive's record (decision 695).
   */
  started?: string;
  commands?: string[];
  steps?: HiveCheckStep[];
  log?: string;
}

/**
 * A step of a Hive run's log (decision 695): one of the check's commands; in a running review, an
 * install command in its copy, the reviewer, a finding's rerun.
 */
export type HiveLogStep = 'check' | 'install' | 'review' | 'rerun' | 'merge' | 'resolve' | 'land';

/** A line of a Hive run's log, in the merge log's format (V46a). */
export type HiveLogLine = LogLine<HiveLogStep>;

/** `GET /api/workspaces/hive/log`'s lines from a byte offset, and the offset to read on from. */
export type HiveLogRead = LogRead<HiveLogStep>;

/**
 * What Hive runs now on a workspace (decisions 693, 697), while Hive is on: the check — its
 * commands, the one running and since when, those ended, and the time of the last passing check
 * of the same commands in the repository, when there is one — or the running review — what it
 * runs now and the reviewer's last tool call, from its log.
 */
export type HiveLive =
  | {
      kind: 'check';
      started: string;
      commands: string[];
      /** The index of the command running, and since when. */
      step: number;
      since: string;
      /** The commands ended, in order. */
      done: { ok: boolean; ms: number }[];
      log?: string;
      /** The last passing check of the same commands: its time and each command's. */
      expected?: { ms: number; steps: number[] };
    }
  | {
      kind: 'review';
      started: string;
      log?: string;
      /** What it runs now, from its log: an install, the reviewer, a rerun; its title, since when. */
      phase?: HiveLogStep;
      title?: string;
      since?: string;
      /** The reviewer's last tool call: "Bash: pnpm vitest run …". */
      doing?: string;
    };

/** A workspace Hive drives, as its card reads it (HV2). */
export interface WorkspaceHive {
  step: HiveStep;
  /** The writer's round, and how many before Hive stops for the person. */
  round: number;
  rounds: number;
  /** Hive's last check. */
  check?: HiveCheck;
  /** Hive's last running review (HV3): its round, commit, verdict and how many findings it kept. */
  review?: Pick<HiveReview, 'round' | 'at' | 'verdict'> & { kept: number };
  /** Why it stopped for the person, or what it landed without (no check found). */
  note?: string;
  /** What it runs now, while Hive is on and checks or reviews (decision 697). */
  live?: HiveLive;
  /** Hive is off: the step waits for it (decision 655). */
  paused?: true;
  /** Hive holds its next start for usage (HV5): from its record's `paused`. */
  pause?: HivePause;
  /**
   * Hive is off, whatever the step (HV3): landing is the person's as for any workspace, from its
   * review, not by Land.
   */
  off?: true;
  /** The landing in flight, or the last one (HV4). */
  landing?: HiveLanding;
  /** The branch's last push to `origin` (HV4). */
  pushed?: HivePush;
  /** Its pull or merge request (HV8). */
  request?: HiveRequest;
}

/**
 * `GET /api/workspaces/hive?branch=` (HV3, decision 681): what Hive did with a workspace, for its
 * Review tab: each round's check and running review, and whether Land is asked.
 */
export interface WorkspaceHiveDetail {
  branch: string;
  step: HiveStep;
  round: number;
  rounds: number;
  /** Hive mode, now: Land only while it is on. */
  on: boolean;
  /** The commit checked and reviewed: the one Land approves. */
  checked?: string;
  note?: string;
  checks: HiveCheck[];
  reviews: HiveReview[];
  /** What it runs now, while Hive is on and checks or reviews (decision 697). */
  live?: HiveLive;
  /** Where the kept findings' tests are, beside Hive's record (`r<round>/<path>` below it). */
  tests: string;
  /** Each landing Hive tried, the last in flight while it has no outcome (HV4). */
  landings?: HiveLanding[];
  /** The branch's last push to `origin` (HV4). */
  pushed?: HivePush;
  /** Its pull or merge request (HV8). */
  request?: HiveRequest;
  /** Hive holds its next start for usage (HV5): from its record's `paused`. */
  pause?: HivePause;
  /** What it spent (HV5), and its budget. */
  spend?: HiveSpend;
}
