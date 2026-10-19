// CPR's merger (V26): approved branches merged in a worktree of CPR's own, checked, and landed by
// fast-forward. What `cpr view`'s server answers and the viewer reads. Types only.

/** Where a queued merge is. */
export const MERGE_STATES = [
  /** Waiting for its turn: one merge at a time per repository. */
  'queued',
  /** `git merge --no-ff` in CPR's merge worktree. */
  'merging',
  /** The check runs on the merge. */
  'checking',
  /** It conflicts (`conflicts`), or what git said needs the person (`message`). */
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
  /** `cpr/config.json (merge.checks)`, or the guess's source (V24b). */
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
  /** Conflicting paths (state `needs-you`). */
  conflicts?: string[];
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
  /** Another CPR process is merging in this repository: the queue is shown, it merges. */
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

/** `POST /api/merges`. */
export interface MergeRequest {
  branch: string;
  into: string;
}
