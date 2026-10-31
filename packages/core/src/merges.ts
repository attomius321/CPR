// Symbiote's merger (V26): approved branches merged in a worktree of Symbiote's own, checked, and
// landed by fast-forward. What `symbiote view`'s server answers and the viewer reads. Types only.
import type { AgentKind } from './workspaces.js';

/** Where a queued merge is. */
export const MERGE_STATES = [
  /** Waiting for its turn: one merge at a time per repository. */
  'queued',
  /** `git merge --no-ff` in Symbiote's merge worktree. */
  'merging',
  /** It conflicted: the merger agent answers each region (V26c). */
  'resolving',
  /** The check runs on the merge. */
  'checking',
  /**
   * A resolution to review (`resolution`), a conflict nobody resolved (`conflicts`), or what
   * needs the person (`message`).
   */
  'needs-you',
  /** Merged and checked: to land. No check, or a refused landing, waits for Land. */
  'ready',
  /** The target branch is at the merge. */
  'landed',
  /** The check failed (`check.output`), or git did (`message`). */
  'failed',
] as const;
export type MergeState = (typeof MERGE_STATES)[number];

/**
 * How a merge lands (V67): `merge`, a merge commit (`--no-ff`, V26a); `fast-forward`, the target
 * moved to the approved commit itself, no new commit, when the target's tip is in it.
 */
export const MERGE_STRATEGIES = ['merge', 'fast-forward'] as const;
export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

/** The check of a merge: its commands, where they came from, and how they ended. */
export interface MergeCheckRun {
  commands: string[];
  /** `symbiote/config.json (merge.checks)`, or the guess's source (V24b). */
  source: string;
  /** Absent while it runs. */
  ok?: boolean;
  /** How long it took in all. */
  ms?: number;
  /** The command that failed. */
  failed?: string;
  /** The last 60 lines of its output. */
  output?: string;
}

/** A conflict region as the merger agent was given it (V26c). */
export interface MergeConflict {
  path: string;
  /** Its first line in the conflicted file, 1-based. */
  line: number;
  /** The target's side, the ancestor's (null when git did not write it), the branch's side. */
  ours: string[];
  base: string[] | null;
  theirs: string[];
  /**
   * The lines its prompt showed above and below it, which stay in the file
   * (fix/merge-viewer-on-conflict). Absent on a merge resolved before.
   */
  around?: { before: string[]; after: string[] };
}

/** A conflict region and what the merger agent answered for it (V26c). */
export interface MergeRegion extends MergeConflict {
  /** The text written in its place. */
  text: string;
  /** The agent's line on what it kept. */
  note?: string;
}

/** How the merger agent resolved a merge's conflicts, for the person to review (V26c). */
export interface MergeResolution {
  agent: AgentKind;
  model?: string;
  /** Empty when it said the person must decide (`needsYou`). */
  regions: MergeRegion[];
  needsYou?: string;
  /**
   * The regions it was given when it asked (`needsYou`), in its prompt's order: the person reads
   * them to answer (fix/merge-viewer-on-conflict).
   */
  asked?: MergeConflict[];
  /** Its run: tokens in and out, when the agent says, and how long it took. */
  usage?: { input: number; output: number };
  ms: number;
}

/** A queue entry (V26a). */
export interface MergeEntry {
  id: string;
  branch: string;
  /** The approved commit (the Approve verdict's `head`): what is merged, not the branch's tip. */
  head: string;
  /** The branch merged into. */
  into: string;
  /** The merge commit's subject: `Merge <branch>: <title>`. */
  title: string;
  /** `fast-forward` (V67); absent: a merge commit. */
  strategy?: 'fast-forward';
  state: MergeState;
  /** When it was queued, and when its state last changed. */
  queued: string;
  updated: string;
  /** `into`'s tip the merge was made on. */
  base?: string;
  /** The merge commit; a fast-forward's, the approved commit (V67). */
  merge?: string;
  /**
   * A fast-forward `into` can no longer take (V67): its commits the approved commit lacks. It
   * waits for the person (`needs-you`): a merge commit instead, or Remove.
   */
  behind?: number;
  /** Conflicting paths. */
  conflicts?: string[];
  /** Conflicting files the merger agent was not given, and why (V46c). */
  unresolvable?: { path: string; kind: 'deleted' | 'submodule' | 'binary' }[];
  /** The merger agent's resolution (V26c): reviewed before the merge lands. */
  resolution?: MergeResolution;
  /**
   * The person's words on an earlier resolution, for the next run, and that run's texts; or their
   * answer to what the agent `asked` (fix/merge-viewer-on-conflict).
   */
  again?: { comments: string; previous: string[]; asked?: string };
  /** Queued to run its failed check again on `merge`, its resolution kept (fix/fix-merger). */
  recheck?: true;
  /** Absent: none was found or set, and the merge waits for Land. */
  check?: MergeCheckRun;
  /** Why it waits or failed, in git's words where git said it. */
  message?: string;
  /** When it landed, and how the push went (`merge.push`). */
  landed?: string;
  pushed?: { ok: true; remote: string } | { ok: false; remote: string; error: string };
}

/** `GET /api/merges`. */
export interface MergeList {
  merges: MergeEntry[];
  /** Another Symbiote process is merging in this repository: the queue is shown, it merges. */
  elsewhere?: true;
}

/** `GET /api/merges/targets?branch=`: what Merge into ▾ offers, and why Merge is not offered. */
export interface MergeTargets {
  /** Branches to merge into: local ones, and remote ones by their name; never the branch itself. */
  branches: string[];
  /**
   * Preselected: the branch the workspace is reviewed against (V65), its `from`, the verdict's
   * `into`, else the default branch.
   */
  into: string | null;
  /** The approved commit, when the last verdict approves. */
  head?: string;
  /** The strategy preselected (V67): `merge.strategy`, else `merge`. */
  strategy: MergeStrategy;
  /** Of `branches`, those whose tip is in the approved commit: they can fast-forward (V67). */
  fastForward?: string[];
  /** Why it cannot be merged now; absent when it can. */
  blocked?: string;
  /** Its entry in the queue, unless landed or removed. */
  entry?: MergeEntry;
}

/**
 * A step of a merge as its log names it (V46a): the merge, the merger agent, one check command,
 * the landing.
 */
export type MergeStep = 'merge' | 'resolve' | 'check' | 'land';

/** One of the merger agent's events as a merge's log keeps it (V46b). */
export type MergeAgentEvent =
  /** It started: the agent's version and model, when it says. */
  | { start: string }
  /** A piece of its thinking's summary, as it comes. */
  | { think: string }
  /** A piece of what it writes. */
  | { say: string }
  /** A tool it called, with its main input: a path, a pattern, a command. */
  | { tool: string; input: string }
  /** What the tool gave back, by its size. */
  | { result: string }
  /** A line of Symbiote's on the run, such as why its thinking is not shown. */
  | { note: string };

/**
 * A line of a merge's log (V46a, decision 313), in `state/<repo>/merges/<id>.jsonl`: a step
 * starts, what it writes, an agent's event, the step ends, or the entry runs again and why. `at`
 * is when, in ms.
 */
export type MergeLogLine = LogLine<MergeStep>;

/**
 * A line of a log of steps (V46a; Hive's runs since decision 695), its steps of type `S`: a step
 * starts, what it writes, an agent's event, the step ends, or it runs again and why.
 */
export type LogLine<S extends string> = { at: number } & (
  | { step: S; title: string }
  | { out: string }
  | { agent: MergeAgentEvent }
  | { end: { ok: boolean; ms: number } }
  | { run: string }
);

/** Lines of a log from a byte offset, and the offset to read on from. */
export interface LogRead<S extends string> {
  lines: LogLine<S>[];
  next: number;
}

/** Lines of a merge's log from a byte offset, and the offset to read on from. */
export type MergeLogRead = LogRead<MergeStep>;

/** `POST /api/merges`. */
export interface MergeRequest {
  branch: string;
  into: string;
  /** Absent: `merge.strategy`, else a merge commit (V67). */
  strategy?: MergeStrategy;
}
