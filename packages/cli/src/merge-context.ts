// What the merger is given and what its steps share (decision 962): its options, the queue, the
// merge worktree and the logs, and the two things every step writes with: `set` and `fresh`; the
// refusal they throw, and how they write a commit, a count and an output's end. A step's module
// takes a `Pick<>` of `MergerContext` (decision 963).
import type { AgentEfforts, AgentModels, GitRepo, AgentKind, MergeEntry } from '@symbiote/core';
import type { MergerAgent } from './merge-agent.js';
import type { MergeLogs } from './merge-log.js';
import { mergeQueue } from './merge-queue.js';
import type { RunCheck } from './programs.js';

/** A symbol a side changed, as Symbiote's analysis names it. */
export interface ChangedSymbol {
  path: string;
  name: string;
  kind: string;
  status: string;
}

/** The symbols `to` changed against `from` in `files` (V26c): Symbiote's analysis of those files.
 * */
export type ChangedSymbols = (
  from: string,
  to: string,
  files: readonly string[],
) => Promise<ChangedSymbol[]>;

/** A request the server answers with `status` and the message. */
export class MergeRefused extends Error {
  override name = 'MergeRefused';
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 409,
  ) {
    super(message);
  }
}

/** Lines of a check's output kept with its entry. */
const OUTPUT_LINES = 60;

export const short = (sha: string) => sha.slice(0, 7);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const lastLines = (text: string) =>
  text.replace(/\n+$/, '').split('\n').slice(-OUTPUT_LINES).join('\n');

/** How the merger runs: its clock, its check's runner, the agent and its levels, the analysis. */
export interface MergerOptions {
  now?: () => Date;
  runCheck?: RunCheck;
  /** Where `symbiote/config.json` is read. */
  root?: string;
  /** Each change of an entry, as it is written (`symbiote merge` prints them). */
  onChange?: (entry: MergeEntry) => void;
  /** The merger agent of `kind` (`merge.agent`, else the default), when installed (V26c). */
  mergerAgent?: (kind?: AgentKind) => Promise<MergerAgent | null>;
  /** An agent's effort levels (V46d): Claude Code's `--help`, Codex's models; null unread. */
  levels?: (kind: AgentKind) => Promise<AgentEfforts | null>;
  /** An agent's models (V47); null unread. */
  models?: (kind: AgentKind) => Promise<AgentModels | null>;
  /** The symbols a side changed in the conflicting files; Symbiote's analysis by default. */
  changedSymbols?: ChangedSymbols;
  /**
   * A drain stopped by what no entry holds (its lock or the queue's file cannot be written): the
   * next kick tries again, and nothing else says it (fix/e2e-flakes: `symbiote view` logs it).
   */
  onError?: (error: unknown) => void;
}

/** What `merger`'s steps share. */
export interface MergerContext {
  repo: GitRepo;
  cacheDir: string;
  now: () => Date;
  runCheck: RunCheck;
  root: string;
  onChange: ((entry: MergeEntry) => void) | undefined;
  mergerAgent: (kind?: AgentKind) => Promise<MergerAgent | null>;
  levels: (kind: AgentKind) => Promise<AgentEfforts | null>;
  models: (kind: AgentKind) => Promise<AgentModels | null>;
  changedSymbols: ChangedSymbols;
  queue: ReturnType<typeof mergeQueue>;
  /** The merger's own worktree, where every merge is made. */
  worktree: string;
  logs: MergeLogs;
  /** Sets an entry's fields (`undefined` removes one); the entry as it now is. */
  set: (id: string, fields: Partial<MergeEntry>) => Promise<MergeEntry>;
  /** The fields a merge leaves behind, cleared when it is merged again. */
  fresh: Partial<MergeEntry>;
}
