// Symbiote's merger (V26a, decisions 142–146, 149): an approved commit merged with `--no-ff` in a
// worktree of Symbiote's own, or the approved commit itself to fast-forward to (V67), the
// project's check run on it, and the target branch moved by fast-forward. No agent and no tokens;
// one merge at a time per repository.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeGit,
  commitsBetween,
  commitSubject,
  isAncestor,
  listRefs,
  EFFORT_LEVEL,
  MERGE_STRATEGIES,
  MODEL_ID,
  type GitRepo,
  type MergeEntry,
  type MergeList,
  type MergeLogRead,
  type MergeRequest,
  type MergeTargets,
  type EffortChange,
  type AgentLevels,
  type ModelChange,
  type WorkspaceReplied,
  type WorkspaceReply,
} from '@symbiote/core';
import {
  AGENT_NAMES,
  effortOnProblem,
  effortWordProblem,
  modelProblem,
  modelWordProblem,
} from './agent-levels.js';
import { mergeLogs } from './merge-log.js';
import { mergeQueue } from './merge-queue.js';
import { runShell } from './programs.js';
import { fillPrompt, PromptRefused, readPrompts, writeConfig } from './prompts.js';
import {
  type MergerOptions,
  type MergerContext,
  MergeRefused,
  short,
  lastLines,
  type ChangedSymbols,
} from './merge-context.js';
import { mergeTargets } from './merge-targets.js';
import { mergeLand } from './merge-land.js';
import { mergeResolve } from './merge-resolve.js';
import { mergeRun, cannotFastForward } from './merge-run.js';
import { readMergeConfig, isStrategy, modelOf } from './merge-config.js';

/** States in which a merge runs: never removed, merged again after a stop. */
const RUNNING = new Set<MergeEntry['state']>(['merging', 'resolving', 'checking']);

/** A failed check's characters sent to an agent at most, as Hive sends them (AR2). */
const SENT_CHARS = 6_000;

/** Symbiote's own analysis of only `files` (others ignored), without context around them. */
function analyzedSymbols(repo: GitRepo, cacheDir: string): ChangedSymbols {
  return async (from, to, files) => {
    const wanted = new Set(files);
    const ignore = (path: string) =>
      path.endsWith('/') ? !files.some((f) => f.startsWith(path)) : !wanted.has(path);
    const analysis = await analyzeGit({
      cwd: repo.root,
      base: from,
      head: to,
      mergeBase: false,
      depth: 0,
      cacheDir,
      ignore,
    });
    return analysis.changes.flatMap((change) => {
      const decl = change.head ?? change.base;
      if (!decl) return [];
      const hash = change.id.indexOf('#');
      return [
        {
          path: change.id.slice(0, hash),
          name: change.id.slice(hash + 1),
          kind: decl.kind,
          status: change.status,
        },
      ];
    });
  };
}

/** What the server and `symbiote merge` need of the merger. */
export interface Merger {
  list(): Promise<MergeList>;
  /** Merge into ▾ for a branch: the branches, the one preselected, and why not, if not. */
  targets(branch: string): Promise<MergeTargets>;
  /** Queues the approved commit of `branch`; starts merging unless `start` is false. */
  enqueue(request: MergeRequest, options?: { start?: boolean }): Promise<MergeEntry>;
  /** Lands a `ready` merge. */
  land(id: string): Promise<MergeEntry>;
  /** Queues a failed or stopped merge again. */
  retry(id: string): Promise<MergeEntry>;
  /** Approves the merger agent's resolution (V26c): the merge lands, whatever its check said. */
  approve(id: string): Promise<MergeEntry>;
  /** Asks the merger agent again, with the person's words on its resolution (V26c). */
  requestChanges(id: string, comments: string): Promise<MergeEntry>;
  /** Runs a resolution's failed check again on the same merge; the agent is not asked. */
  recheck(id: string): Promise<MergeEntry>;
  /**
   * A merge's failed check in words for its branch's agent (AR2, decision 742): `merge.failed`
   * filled with the command and its last lines. Refused when its check did not fail.
   */
  failure(id: string): Promise<{ branch: string; text: string }>;
  /** Queues a fast-forward its target can no longer take as a merge commit instead (V67). */
  mergeCommit(id: string): Promise<MergeEntry>;
  /** Takes an entry out of the queue (not while it merges or checks), with its log. */
  remove(id: string): Promise<void>;
  /** An entry's log from byte `from` (V46a); null when there is no such entry. */
  log(id: string, from?: number): Promise<MergeLogRead | null>;
  /** The merger's agent's effort levels and `merge.effort` (V46d), as Nucleus's are listed. */
  efforts(): Promise<AgentLevels>;
  /** Sets `merge.effort`, one of the merger's agent's levels; null removes it. */
  setEffort(change: EffortChange): Promise<AgentLevels>;
  /** Sets `merge.model` (V47), one of the merger's agent's models; null removes it. */
  setModel(change: ModelChange): Promise<AgentLevels>;
  /** Resolves once nothing in the queue can go further. */
  idle(): Promise<void>;
}

/** Merges of `repo`, queued in Symbiote's cache; reviews and workspaces read where Symbiote keeps
 * them. */
/**
 * Sends a merge's failed check to its branch's agent (AR2, decision 742), as the merger's
 * message: noted in the thread, so its prompt reads as Symbiote's (`merge.failed`).
 */
export async function sendFailure(
  merges: Pick<Merger, 'failure'>,
  reply: (request: WorkspaceReply) => Promise<WorkspaceReplied>,
  id: string,
): Promise<WorkspaceReplied> {
  const { branch, text } = await merges.failure(id);
  return reply({ branch, text, by: 'merger', key: 'merge.failed' });
}

export function merger(
  repo: GitRepo,
  cacheDir: string,
  {
    now = () => new Date(),
    runCheck = runShell,
    root = repo.root,
    onChange,
    mergerAgent = () => Promise.resolve(null),
    levels = () => Promise.resolve(null),
    models = () => Promise.resolve(null),
    changedSymbols = analyzedSymbols(repo, cacheDir),
  }: MergerOptions = {},
): Merger {
  const stateDir = join(cacheDir, 'state', repo.id);
  const queue = mergeQueue(stateDir);
  const worktree = join(cacheDir, 'worktrees', repo.id, 'merge');
  // Each entry's log (V46a), beside the queue.
  const logs = mergeLogs(join(stateDir, 'merges'));

  /** Sets an entry's fields (`undefined` removes one); the entry as it now is. */
  function set(id: string, fields: Partial<MergeEntry>): Promise<MergeEntry> {
    return queue
      .change((merges) => {
        const entry = merges.find((e) => e.id === id);
        if (!entry) throw new MergeRefused(`no merge ${id}`, 404);
        Object.assign(entry, fields, { updated: now().toISOString() });
        for (const key of Object.keys(fields) as (keyof MergeEntry)[]) {
          if (fields[key] === undefined) delete entry[key];
        }
        return { ...entry };
      })
      .then((entry) => {
        onChange?.(entry);
        return entry;
      });
  }

  /** The fields a merge leaves behind, cleared when it is merged again. */
  const fresh: Partial<MergeEntry> = {
    base: undefined,
    merge: undefined,
    conflicts: undefined,
    unresolvable: undefined,
    resolution: undefined,
    check: undefined,
    message: undefined,
    recheck: undefined,
    behind: undefined,
    diverged: undefined,
    mergeMs: undefined,
  };

  // Its steps, each over what it reads: where a branch merges into, landing, resolving, merging.
  const ctx: MergerContext = {
    repo,
    cacheDir,
    now,
    runCheck,
    root,
    onChange,
    mergerAgent,
    levels,
    models,
    changedSymbols,
    queue,
    worktree,
    logs,
    set,
    fresh,
  };
  const { tipOf, recordsOf, targets } = mergeTargets(ctx);
  const land = mergeLand(ctx, { tipOf });
  const { landEntry } = land;
  const resolving = mergeResolve(ctx, { recordsOf });
  const { efforts } = resolving;
  const { mergeOne } = mergeRun(ctx, { ...land, ...resolving, tipOf });

  /**
   * States that hold a branch: a later merge into it waits until they land or are removed. A
   * failure or a resolution waiting for the person may still land (Retry, Approve) and move the
   * branch; a merge started meanwhile would be made and checked on a tip about to move.
   */
  const holding = new Set<MergeEntry['state']>([
    'merging',
    'resolving',
    'checking',
    'ready',
    'needs-you',
    'failed',
  ]);

  async function drain(): Promise<void> {
    const release = await queue.lock();
    if (!release) return;
    try {
      // A process that stopped mid-merge left its entry merging or checking: merged again.
      const kept = await queue.change((merges) => {
        for (const e of merges) {
          if (!RUNNING.has(e.state)) continue;
          e.state = 'queued';
          logs.of(e.id).run('Symbiote stopped during the merge: merging again');
        }
        return new Set(merges.map((e) => e.id));
      });
      // Logs of entries removed by another process, or while none ran.
      await logs.prune(kept);
      for (;;) {
        const merges = await queue.read();
        const next = merges.find(
          (e, i) =>
            e.state === 'queued' &&
            !merges.some((o, j) => j !== i && o.into === e.into && holding.has(o.state)),
        );
        if (!next) return;
        try {
          await mergeOne(next);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // The step that threw ends with what it said.
          const log = logs.of(next.id);
          log.out(`${message}\n`);
          log.end(false);
          await set(next.id, { state: 'failed', message });
        }
      }
    } finally {
      await release();
    }
  }

  let running: Promise<void> | null = null;
  let again = false;
  /** Starts merging, or has the running drain look at the queue again. */
  function kick(): void {
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        await drain();
      } while (again);
    })()
      // What failed is in its entry; a lock or queue file that cannot be written waits for the next
      // kick.
      .catch(() => undefined)
      .finally(() => (running = null));
  }

  async function entryOf(id: string): Promise<MergeEntry> {
    const entry = (await queue.read()).find((e) => e.id === id);
    if (!entry) throw new MergeRefused(`no merge ${id}`, 404);
    return entry;
  }

  return {
    async list() {
      const merges = await queue.read();
      // Queued by another process, or left by one that stopped: merged here.
      if (merges.some((e) => e.state === 'queued' || RUNNING.has(e.state))) kick();
      const elsewhere = !running && existsSync(queue.lockFile) && (await queue.lockedElsewhere());
      // Whether a landing is pushed (V93): the Merge page's Land says so.
      const push = readMergeConfig(root).push;
      return {
        merges,
        ...(elsewhere ? { elsewhere: true as const } : {}),
        ...(push ? { push: true as const } : {}),
      };
    },

    async targets(branch) {
      const found: MergeTargets & { tip?: string } = await targets(branch);
      delete found.tip;
      return found;
    },

    async enqueue({ branch, into, strategy, by }, { start = true } = {}) {
      if (typeof branch !== 'string' || branch === '') throw new MergeRefused('which branch?', 400);
      if (into === branch) throw new MergeRefused(`cannot merge ${branch} into itself`, 400);
      if (strategy !== undefined && !isStrategy(strategy)) {
        throw new MergeRefused(`strategy: ${MERGE_STRATEGIES.join(' or ')}`, 400);
      }
      const found = await targets(branch);
      if (found.blocked || !found.head)
        throw new MergeRefused(found.blocked ?? 'not approved', 409);
      if (!found.branches.includes(into)) throw new MergeRefused(`no branch ${into}`, 400);
      if (found.entry) throw new MergeRefused(`${branch} is already queued`, 409);
      // A request that names none takes merge.strategy (decision 488).
      const fastForward = (strategy ?? found.strategy) === 'fast-forward';
      if (fastForward && !found.fastForward?.includes(into)) {
        const tip = tipOf(await listRefs(repo), into)?.sha ?? found.head;
        // The approved commit already in it: it lands at its turn, saying so.
        if (!(await isAncestor(repo, found.head, tip))) {
          const { count } = await commitsBetween(repo, found.head, tip, 1);
          throw new MergeRefused(cannotFastForward(into, branch, count), 409);
        }
      }
      const { workspace } = await recordsOf(branch);
      const title = workspace?.title ?? (await commitSubject(repo, found.head));
      const at = now().toISOString();
      const entry: MergeEntry = {
        id: randomUUID(),
        branch,
        head: found.head,
        into,
        title: `Merge ${branch}: ${title}`,
        ...(fastForward ? { strategy: 'fast-forward' as const } : {}),
        ...(by === 'hive' ? { by } : {}),
        state: 'queued',
        queued: at,
        updated: at,
      };
      await queue.change((merges) => void merges.push(entry));
      if (start) kick();
      return entry;
    },

    async land(id) {
      const entry = await entryOf(id);
      if (entry.state !== 'ready')
        throw new MergeRefused(`${entry.branch} is not ready to land`, 409);
      const after = await landEntry(entry);
      kick();
      return after;
    },

    async retry(id) {
      const entry = await entryOf(id);
      if (!['failed', 'needs-you'].includes(entry.state)) {
        throw new MergeRefused(`${entry.branch} is ${entry.state}: nothing to retry`, 409);
      }
      const after = await set(id, { ...fresh, again: undefined, state: 'queued' });
      logs.of(id).run('Retry');
      kick();
      return after;
    },

    async approve(id) {
      const entry = await entryOf(id);
      if (entry.state !== 'needs-you' || !entry.resolution || !entry.merge) {
        throw new MergeRefused(`${entry.branch} has no resolution: nothing to approve`, 409);
      }
      // A failed check does not refuse it: the person read what failed and decided (decision 242).
      const after = await landEntry(await set(id, { state: 'ready', message: undefined }));
      kick();
      return after;
    },

    async requestChanges(id, comments) {
      if (comments.trim() === '') throw new MergeRefused('say what to change', 400);
      const entry = await entryOf(id);
      const regions = entry.resolution?.regions ?? [];
      // A question the agent asked is answered the same way (fix/merge-viewer-on-conflict).
      const asked = entry.resolution?.needsYou;
      if (entry.state !== 'needs-you' || (regions.length === 0 && !asked)) {
        throw new MergeRefused(`${entry.branch} has no resolution to change`, 409);
      }
      const after = await set(id, {
        ...fresh,
        // The files asked about stay listed while it runs again.
        conflicts: entry.conflicts,
        state: 'queued',
        again:
          regions.length === 0 && asked
            ? { comments, previous: [], asked }
            : { comments, previous: regions.map((r) => r.text) },
      });
      logs.of(id).run(`${regions.length === 0 ? 'Answer' : 'Request changes'}: ${comments.trim()}`);
      kick();
      return after;
    },

    async recheck(id) {
      const entry = await entryOf(id);
      const resolved =
        entry.state === 'needs-you' && entry.merge && (entry.resolution?.regions.length ?? 0) > 0;
      if (!resolved || entry.check?.ok !== false) {
        throw new MergeRefused(`${entry.branch} has no failed check to run again`, 409);
      }
      const after = await set(id, { state: 'queued', recheck: true, message: undefined });
      logs.of(id).run('Check again');
      kick();
      return after;
    },

    async failure(id) {
      const entry = await entryOf(id);
      const check = entry.check;
      if (check?.ok !== false || !check.failed) {
        throw new MergeRefused(`${entry.branch}'s merge has no failed check to send`, 409);
      }
      const text = fillPrompt(readPrompts(root).text['merge.failed'], {
        branch: entry.branch,
        at: short(entry.head),
        into: entry.into,
        command: check.failed,
        output: lastLines(check.output ?? '').slice(-SENT_CHARS),
      });
      return { branch: entry.branch, text };
    },

    async mergeCommit(id) {
      const entry = await entryOf(id);
      if (entry.state !== 'needs-you' || entry.strategy !== 'fast-forward' || !entry.behind) {
        throw new MergeRefused(
          `${entry.branch} has no fast-forward waiting: nothing to merge`,
          409,
        );
      }
      const after = await set(id, { ...fresh, strategy: undefined, state: 'queued' });
      logs.of(id).run('Merge commit instead');
      kick();
      return after;
    },

    async remove(id) {
      const entry = await entryOf(id);
      if (RUNNING.has(entry.state)) {
        throw new MergeRefused(`${entry.branch} is ${entry.state}: wait for it`, 409);
      }
      await queue.change((merges) => {
        merges.splice(
          merges.findIndex((e) => e.id === id),
          1,
        );
      });
      await logs.remove(id);
      kick();
    },

    async log(id, from = 0) {
      if (!(await queue.read()).some((e) => e.id === id)) return null;
      return logs.read(id, from);
    },

    efforts,

    async setEffort({ effort }) {
      if (effort !== null) {
        if (typeof effort !== 'string' || !EFFORT_LEVEL.test(effort)) {
          throw new MergeRefused(effortWordProblem(effort), 400);
        }
        const agent = await mergerAgent(readMergeConfig(root).agent);
        if (!agent)
          throw new MergeRefused(
            'the merger needs Claude Code or Codex: neither is installed',
            409,
          );
        const model = modelOf(agent.kind, readMergeConfig(root));
        const problem = effortOnProblem(
          effort,
          AGENT_NAMES[agent.kind],
          model ? (await models(agent.kind))?.models : undefined,
          model,
          await levels(agent.kind),
        );
        if (problem) throw new MergeRefused(problem, 400);
      }
      try {
        await writeConfig(root, ['merge', 'effort'], effort ?? undefined);
      } catch (error) {
        if (error instanceof PromptRefused) throw new MergeRefused(error.message, error.status);
        throw error;
      }
      return efforts();
    },

    async setModel({ model }) {
      if (model !== null) {
        if (typeof model !== 'string' || !MODEL_ID.test(model)) {
          throw new MergeRefused(modelWordProblem(model), 400);
        }
        const agent = await mergerAgent(readMergeConfig(root).agent);
        if (!agent) {
          throw new MergeRefused(
            'the merger needs Claude Code or Codex: neither is installed',
            409,
          );
        }
        const problem = modelProblem(
          model,
          AGENT_NAMES[agent.kind],
          (await models(agent.kind))?.models,
        );
        if (problem) throw new MergeRefused(problem, 400);
      }
      try {
        await writeConfig(root, ['merge', 'model'], model ?? undefined);
      } catch (error) {
        if (error instanceof PromptRefused) throw new MergeRefused(error.message, error.status);
        throw error;
      }
      return efforts();
    },

    async idle() {
      await queue.written();
      while (running) await running;
    },
  };
}
