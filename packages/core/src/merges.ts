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

/** A conflict region and what the merger agent answered for it (V26c). */
export interface MergeRegion {
  path: string;
  /** Its first line in the conflicted file, 1-based. */
  line: number;
  /** The target's side, the ancestor's (null when git did not write it), the branch's side. */
  ours: string[];
  base: string[] | null;
  theirs: string[];
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
  state: MergeState;
  /** When it was queued, and when its state last changed. */
  queued: string;
  updated: string;
  /** `into`'s tip the merge was made on. */
  base?: string;
  /** The merge commit. */
  merge?: string;
  /** Conflicting paths. */
  conflicts?: string[];
  /** Conflicting files the merger agent was not given, and why (V46c). */
  unresolvable?: { path: string; kind: 'deleted' | 'submodule' | 'binary' }[];
  /** The merger agent's resolution (V26c): reviewed before the merge lands. */
  resolution?: MergeResolution;
  /** The person's words on an earlier resolution, for the next run, and that run's texts. */
  again?: { comments: string; previous: string[] };
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
  /** Preselected: the workspace's `from`, the verdict's `into`, else the default branch. */
  into: string | null;
  /** The approved commit, when the last verdict approves. */
  head?: string;
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
export type MergeLogLine = { at: number } & (
  | { step: MergeStep; title: string }
  | { out: string }
  | { agent: MergeAgentEvent }
  | { end: { ok: boolean; ms: number } }
  | { run: string }
);

/** Lines of a merge's log from a byte offset, and the offset to read on from. */
export interface MergeLogRead {
  lines: MergeLogLine[];
  next: number;
}

/** `POST /api/merges`. */
export interface MergeRequest {
  branch: string;
  into: string;
}
