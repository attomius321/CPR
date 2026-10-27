// Symbiote's merger (V26a, decisions 142–146, 149): an approved commit merged with `--no-ff` in a
// worktree of Symbiote's own, or the approved commit itself to fast-forward to (V67), the
// project's check run on it, and the target branch moved by fast-forward. No agent and no tokens;
// one merge at a time per repository.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  abortMerge,
  analyzeGit,
  commitResolution,
  commitsBetween,
  commitSubject,
  conflictKinds,
  defaultBranch,
  mergeBase,
  fastForwardBranch,
  isAncestor,
  listRefs,
  listWorktrees,
  mergeInWorktree,
  MergeStepRefused,
  pushCommit,
  resetMergeWorktree,
  tipsIn,
  upstreamOf,
  EFFORT_LEVEL,
  MERGE_STRATEGIES,
  MODEL_ID,
  type AgentEfforts,
  type AgentModels,
  type GitRepo,
  type MergeCheckRun,
  type AgentKind,
  type MergeEntry,
  type MergeList,
  type MergeLogRead,
  type MergeConflict,
  type MergeRegion,
  type MergeRequest,
  type MergeStrategy,
  type MergeTargets,
  type RefList,
  type ScoutEffortChange,
  type ScoutEfforts,
  type ScoutModelChange,
  type Verdict,
} from '@symbiote/core';
import { guessCheck, treeAt } from './check.js';
import { CONFIG_FILES } from './plugins.js';
import { readReview, reviewPath, reviewPlace } from './reviews.js';
import { readWorkspace, workspacePath, type WorkspaceFile } from './workspace-record.js';
import { branchNames } from './review-base.js';
import {
  AGENT_NAMES,
  effortOnProblem,
  effortWordProblem,
  levelsOn,
  modelProblem,
  modelWordProblem,
} from './agent-levels.js';
import {
  aroundOf,
  applyAnswer,
  conflictRegions,
  mergerInstructions,
  mergerPrompt,
  parseAnswer,
  type ConflictRegion,
  type MergerAgent,
  type MergerAnswer,
  type MergerInput,
} from './merge-agent.js';
import { mergeLogs } from './merge-log.js';
import { mergeQueue } from './merge-queue.js';
import { runShell, type RunCheck } from './programs.js';
import { PromptRefused, readPrompts, writeConfig } from './prompts.js';

/**
 * What `symbiote/config.json` says of merges: `merge.checks` (one command or several),
 * `merge.push`, `merge.strategy` (V67), and the merger agent's `merge.agent` and `merge.model`
 * (V26c) and `merge.effort` (V46d).
 */
export interface MergeConfig {
  checks?: string[];
  push: boolean;
  strategy?: MergeStrategy;
  agent?: AgentKind;
  model?: string;
  effort?: string;
}

/** The merge section of the config file in `root`; anything unknown is ignored. */
export function readMergeConfig(root: string): MergeConfig {
  const file = configFile(root);
  if (!file) return { push: false };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch {
    return { push: false };
  }
  const merge = (value as { merge?: unknown } | null)?.merge;
  const v = (merge && typeof merge === 'object' ? merge : {}) as {
    checks?: unknown;
    push?: unknown;
    strategy?: unknown;
    agent?: unknown;
    model?: unknown;
    effort?: unknown;
  };
  const listed =
    typeof v.checks === 'string' ? [v.checks] : Array.isArray(v.checks) ? v.checks : [];
  const checks = listed.filter((c): c is string => typeof c === 'string' && c.trim() !== '');
  return {
    ...(checks.length > 0 ? { checks } : {}),
    push: v.push === true,
    ...(isStrategy(v.strategy) ? { strategy: v.strategy } : {}),
    ...(v.agent === 'claude' || v.agent === 'codex' ? { agent: v.agent } : {}),
    ...(typeof v.model === 'string' && v.model !== '' ? { model: v.model } : {}),
    ...(typeof v.effort === 'string' && EFFORT_LEVEL.test(v.effort) ? { effort: v.effort } : {}),
  };
}

const configFile = (root: string) => CONFIG_FILES.find((name) => existsSync(join(root, name)));

const isStrategy = (value: unknown): value is MergeStrategy =>
  (MERGE_STRATEGIES as readonly unknown[]).includes(value);

/** The model the merger asks Claude Code on without `merge.model` (V26c). */
const MERGER_CLAUDE_MODEL = 'sonnet';

/** The model the merger agent of `kind` is asked on: `merge.model`, else Symbiote's for Claude Code. */
const modelOf = (kind: AgentKind, config: MergeConfig): string | undefined =>
  config.model ?? (kind === 'claude' ? MERGER_CLAUDE_MODEL : undefined);

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

/** States in which a merge runs: never removed, merged again after a stop. */
const RUNNING = new Set<MergeEntry['state']>(['merging', 'resolving', 'checking']);

/** Lines of a check's output kept with its entry. */
const OUTPUT_LINES = 60;

const short = (sha: string) => sha.slice(0, 7);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** `4.0 s`, `1 min 21 s`: as the page says a time. */
const seconds = (ms: number) => {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
};
/** Tokens, short: `950`, `3.1K`. */
const tokens = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}K`);

const lastLines = (text: string) =>
  text.replace(/\n+$/, '').split('\n').slice(-OUTPUT_LINES).join('\n');

/** Why `into` cannot fast-forward to `branch`'s approved commit (V67, decision 486). */
const cannotFastForward = (into: string, branch: string, behind: number) =>
  `${into} has ${plural(behind, 'commit')} ${branch} does not: it cannot fast-forward. Merge with a merge commit, or bring ${into} into the branch and review it again`;

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

/**
 * Writes the merger agent's answer into the merge's worktree (V26c): in each conflicted file, each
 * region's text in place of its markers, in the answer's order; the regions as the entry keeps
 * them, each with its note.
 */
async function writeAnswer(
  worktree: string,
  perFile: { path: string; text: string; regions: ConflictRegion[] }[],
  answer: Extract<MergerAnswer, { texts: string[] }>,
): Promise<MergeRegion[]> {
  const regions = conflictsOf(perFile);
  let n = 0;
  for (const file of perFile) {
    const texts = file.regions.map((_, i) => answer.texts[n + i] ?? '');
    n += file.regions.length;
    await writeFile(join(worktree, file.path), applyAnswer(file.text, file.regions, texts));
  }
  return regions.map((region, i) => {
    const note = answer.notes[i];
    return { ...region, text: answer.texts[i] ?? '', ...(note ? { note } : {}) };
  });
}

/**
 * The regions as the agent was given them, in its prompt's order: each with the lines around it,
 * which stay in the file (fix/merge-viewer-on-conflict).
 */
function conflictsOf(
  perFile: { path: string; text: string; regions: ConflictRegion[] }[],
): MergeConflict[] {
  return perFile.flatMap((file) =>
    file.regions.map((region) => ({
      path: file.path,
      line: region.start + 1,
      ours: region.ours,
      base: region.base,
      theirs: region.theirs,
      around: aroundOf(file.text, region, { inFile: true }),
    })),
  );
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
  /** Queues a fast-forward its target can no longer take as a merge commit instead (V67). */
  mergeCommit(id: string): Promise<MergeEntry>;
  /** Takes an entry out of the queue (not while it merges or checks), with its log. */
  remove(id: string): Promise<void>;
  /** An entry's log from byte `from` (V46a); null when there is no such entry. */
  log(id: string, from?: number): Promise<MergeLogRead | null>;
  /** The merger's agent's effort levels and `merge.effort` (V46d), as Scout's are listed. */
  efforts(): Promise<ScoutEfforts>;
  /** Sets `merge.effort`, one of the merger's agent's levels; null removes it. */
  setEffort(change: ScoutEffortChange): Promise<ScoutEfforts>;
  /** Sets `merge.model` (V47), one of the merger's agent's models; null removes it. */
  setModel(change: ScoutModelChange): Promise<ScoutEfforts>;
  /** Resolves once nothing in the queue can go further. */
  idle(): Promise<void>;
}

/** Merges of `repo`, queued in Symbiote's cache; reviews and workspaces read where Symbiote keeps
 * them. */
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
  }: {
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
  } = {},
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
  };

  /** A branch's tip: the local branch's, else a remote's (`origin` first); null when none. */
  function tipOf(refs: RefList, branch: string): { sha: string; local: boolean } | null {
    const local = refs.branches.find((b) => b.name === branch);
    if (local) return { sha: local.sha, local: true };
    const remote = refs.remotes
      .filter((r) => r.branch === branch)
      .sort((a, b) => Number(b.remote === 'origin') - Number(a.remote === 'origin'))[0];
    return remote ? { sha: remote.sha, local: false } : null;
  }

  /** The branch's last verdict and its workspace's record, where Symbiote keeps them. */
  async function recordsOf(branch: string): Promise<{
    verdict?: Verdict;
    workspace: WorkspaceFile | null;
  }> {
    const where = await reviewPlace(repo, cacheDir);
    const review = await readReview(reviewPath(where.dir, branch, where.reviewer));
    const workspace = await readWorkspace(
      workspacePath(join(dirname(where.dir), 'workspaces'), branch),
    );
    const verdict = review?.verdicts.at(-1);
    return { ...(verdict ? { verdict } : {}), workspace };
  }

  async function targets(branch: string): Promise<MergeTargets & { tip?: string }> {
    const refs = await listRefs(repo);
    const branches = branchNames(refs).filter((name) => name !== branch);
    const { verdict, workspace } = await recordsOf(branch);
    const preselected = [
      workspace?.against,
      workspace?.from,
      verdict?.into,
      await defaultBranch(repo, refs),
    ];
    const into = preselected.find((name) => name && branches.includes(name)) ?? null;
    const entry = (await queue.read()).find((e) => e.branch === branch && e.state !== 'landed');
    const tip = refs.branches.find((b) => b.name === branch)?.sha;
    const approved = verdict?.event === 'approve' ? verdict.head : undefined;
    const strategy = readMergeConfig(root).strategy ?? 'merge';
    // The targets whose tip is in the approved commit (V67): one git call for every branch.
    let fastForward: string[] | undefined;
    if (approved) {
      const tips = await tipsIn(repo, approved);
      fastForward = branches.filter((name) => tips.has(tipOf(refs, name)?.sha ?? ''));
    }
    const blocked = !tip
      ? `no branch ${branch}`
      : !approved
        ? `${branch} is not approved: approve its review in Symbiote first`
        : tip !== approved
          ? `${branch} has commits after the approved commit ${approved.slice(0, 7)}: they were not reviewed`
          : undefined;
    return {
      branches,
      into,
      ...(approved ? { head: approved } : {}),
      strategy,
      ...(fastForward ? { fastForward } : {}),
      ...(blocked ? { blocked } : {}),
      ...(entry ? { entry } : {}),
      ...(tip ? { tip } : {}),
    };
  }

  /**
   * The check of a merge: `merge.checks`, else the command guessed from `into`'s tip (V24b), a
   * package script after its package manager's install.
   */
  async function checkOf(base: string): Promise<Pick<MergeCheckRun, 'commands' | 'source'> | null> {
    const { checks } = readMergeConfig(root);
    if (checks) return { commands: checks, source: `${configFile(root)} (merge.checks)` };
    const guess = await guessCheck(await treeAt(repo, base));
    if (!guess) return null;
    // A package script needs the dependencies, which Symbiote's worktree does not have at first.
    if (guess.source.startsWith('package.json')) {
      const manager = guess.command.split(' ')[0] ?? 'npm';
      return {
        commands: [`${manager} install`, guess.command],
        source: `${guess.source}, after an install`,
      };
    }
    return { commands: [guess.command], source: guess.source };
  }

  /**
   * Merges, checks and, when the check passed, lands one entry, always on `into`'s tip as it is
   * now: a merge checked again whose target moved since is merged again.
   */
  async function mergeOne(entry: MergeEntry): Promise<void> {
    const { id, merge, base } = entry;
    const tip = tipOf(await listRefs(repo), entry.into);
    const recheck = entry.recheck && merge && base ? { merge, base } : null;
    if (recheck && tip?.sha === recheck.base) {
      // The same merge checked again: another merge may have used the worktree since.
      await resetMergeWorktree(repo, worktree, recheck.merge);
      await set(id, { recheck: undefined, check: undefined });
      await checkMerge(id, recheck.base, recheck.merge, true);
      return;
    }
    const log = logs.of(id);
    const fastForward = entry.strategy === 'fast-forward';
    log.step(
      'merge',
      fastForward
        ? `Fast-forward ${entry.into} to ${short(entry.head)}`
        : `Merge ${entry.branch} into ${entry.into}`,
    );
    if (recheck && tip) {
      log.out(
        `${entry.into} moved since the merge (now ${short(tip.sha)}): merging again on its tip\n`,
      );
    }
    if (!tip) {
      log.out(`No branch ${entry.into}\n`);
      log.end(false);
      await set(id, { ...fresh, state: 'failed', message: `no branch ${entry.into}` });
      return;
    }
    if (fastForward) return fastForwardOne(entry, tip.sha);
    // Asked again, the files asked about stay listed until the merge says which conflict.
    await set(id, {
      ...fresh,
      ...(entry.again ? { conflicts: entry.conflicts } : {}),
      state: 'merging',
      base: tip.sha,
    });
    await resetMergeWorktree(repo, worktree, tip.sha);
    log.out(`Symbiote's merge worktree at ${entry.into} (${short(tip.sha)})\n`);
    const outcome = await mergeInWorktree(worktree, entry.head, entry.title, { keep: true });
    if ('conflicts' in outcome) {
      const n = outcome.conflicts.length;
      log.out(
        `${plural(n, 'file')} conflict${n === 1 ? 's' : ''}: ${outcome.conflicts.join(', ')}\n`,
      );
      log.end(true);
      const merged = await resolve(entry, tip.sha, outcome.conflicts);
      if (merged) await checkMerge(id, tip.sha, merged, true);
      return;
    }
    if ('error' in outcome) {
      log.out(`${outcome.error}\n`);
      log.end(false);
      await set(id, { state: 'failed', message: outcome.error, conflicts: undefined });
      return;
    }
    if ('upToDate' in outcome) {
      log.out(`Already in ${entry.into}: nothing to merge\n`);
      log.end(true);
      await set(id, {
        state: 'landed',
        landed: now().toISOString(),
        message: `already in ${entry.into}`,
        conflicts: undefined,
        again: undefined,
      });
      return;
    }
    log.out(`Merged ${short(entry.head)}: ${short(outcome.merged)}\n`);
    log.end(true);
    await set(id, { conflicts: undefined, again: undefined });
    await checkMerge(id, tip.sha, outcome.merged, false);
  }

  /**
   * A fast-forward (V67, decisions 485–487): nothing merged. The approved commit itself is
   * checked in the merge worktree, then landed as a merge is. A target no longer in it waits for
   * the person, saying how far it moved: never a merge commit unasked.
   */
  async function fastForwardOne(entry: MergeEntry, tip: string): Promise<void> {
    const { id, into, branch, head } = entry;
    const log = logs.of(id);
    if (await isAncestor(repo, head, tip)) {
      log.out(`Already in ${into}: nothing to fast-forward\n`);
      log.end(true);
      await set(id, {
        ...fresh,
        state: 'landed',
        landed: now().toISOString(),
        message: `already in ${into}`,
        again: undefined,
      });
      return;
    }
    if (!(await isAncestor(repo, tip, head))) {
      const { count: behind } = await commitsBetween(repo, head, tip, 1);
      log.out(
        `${into} has ${plural(behind, 'commit')} ${branch} does not (now ${short(tip)}): it cannot fast-forward\n`,
      );
      log.end(false);
      await set(id, {
        ...fresh,
        state: 'needs-you',
        base: tip,
        behind,
        message: cannotFastForward(into, branch, behind),
      });
      return;
    }
    await set(id, { ...fresh, state: 'merging', base: tip });
    log.out(`${into} (${short(tip)}) is in ${short(head)}: no merge commit\n`);
    await resetMergeWorktree(repo, worktree, head);
    log.out(`Symbiote's merge worktree at ${short(head)}\n`);
    log.end(true);
    await checkMerge(id, tip, head, false);
  }

  /**
   * Runs the check on a merge. A clean one that passed lands; a resolved one (V26c) waits for
   * the person's review either way, its check's result with it.
   */
  async function checkMerge(id: string, base: string, merged: string, resolved: boolean) {
    const log = logs.of(id);
    const check = await checkOf(base);
    if (!check) {
      const message = resolved
        ? 'no check to run: review the resolution, then Approve lands it'
        : 'no check to run: set merge.checks in symbiote/config.json, or Land once you have checked it';
      log.out(`${message.charAt(0).toUpperCase()}${message.slice(1)}\n`);
      await set(id, { state: resolved ? 'needs-you' : 'ready', merge: merged, message });
      return;
    }
    await set(id, { state: 'checking', merge: merged, check: { ...check } });
    const started = Date.now();
    let output = '';
    for (const command of check.commands) {
      log.step('check', command);
      // A runner that does not stream gives its output at the end.
      let streamed = false;
      const result = await runCheck(command, worktree, (chunk) => {
        streamed = true;
        log.out(chunk);
      });
      if (!streamed) log.out(result.output);
      log.end(result.code === 0);
      output += result.output;
      if (result.code !== 0) {
        await set(id, {
          state: resolved ? 'needs-you' : 'failed',
          check: {
            ...check,
            ok: false,
            ms: Date.now() - started,
            failed: command,
            output: lastLines(output),
          },
        });
        return;
      }
    }
    const passed = await set(id, {
      state: resolved ? 'needs-you' : 'ready',
      check: { ...check, ok: true, ms: Date.now() - started, output: lastLines(output) },
    });
    if (!resolved) await landEntry(passed);
  }

  /** Each side's title: a workspace's title and goal, else its last commit's subject. */
  async function sidesOf(entry: MergeEntry, base: string): Promise<MergerInput['sides']> {
    const { workspace } = await recordsOf(entry.branch);
    const goal = workspace?.parts?.goal?.trim().split('\n')[0];
    const branch = workspace?.title
      ? `${workspace.title}${goal ? ` — ${goal}` : ''}`
      : await commitSubject(repo, entry.head);
    return { into: await commitSubject(repo, base), branch };
  }

  /** The symbols both sides changed in `files` since their merge base; none when unknown. */
  async function bothChanged(
    base: string,
    head: string,
    files: string[],
  ): Promise<NonNullable<MergerInput['symbols']>> {
    try {
      const ancestor = await mergeBase(repo, base, head);
      if (!ancestor) return [];
      const [ours, theirs] = await Promise.all([
        changedSymbols(ancestor, base, files),
        changedSymbols(ancestor, head, files),
      ]);
      return ours.flatMap((o) => {
        const t = theirs.find((x) => x.path === o.path && x.name === o.name);
        return t
          ? [{ path: o.path, name: o.name, kind: o.kind, into: o.status, branch: t.status }]
          : [];
      });
    } catch {
      return [];
    }
  }

  /**
   * The merger agent's resolution of a conflicted merge left in the worktree (V26c): its answer
   * written between each region's markers and the merge committed, its SHA; else the merge
   * aborted and the entry at `needs-you`, saying why, and null.
   */
  async function resolve(
    entry: MergeEntry,
    base: string,
    conflicts: string[],
  ): Promise<string | null> {
    const { id } = entry;
    const log = logs.of(id);
    log.step('resolve', 'Merger agent');
    /** `said`: the log's words, when they are not the entry's message. */
    const stop = async (message: string, fields: Partial<MergeEntry> = {}, said = message) => {
      log.out(`${said.charAt(0).toUpperCase()}${said.slice(1)}\n`);
      log.end(false);
      await abortMerge(worktree);
      await set(id, { state: 'needs-you', conflicts, message, again: undefined, ...fields });
      return null;
    };
    const kinds = await conflictKinds(worktree);
    const kept = [...kinds].filter(([, kind]) => kind !== 'text');
    if (kept.length > 0) {
      const words = {
        deleted: 'is deleted on one side',
        submodule: 'is a submodule',
        binary: 'is binary',
      };
      return stop(
        `${kept.map(([path, kind]) => `${path} ${words[kind as keyof typeof words]}`).join('; ')}: not given to the merger agent. Merge ${entry.into} into ${entry.branch}, resolve it there, and review it again`,
        {
          unresolvable: kept.map(([path, kind]) => ({ path, kind: kind as keyof typeof words })),
        },
      );
    }
    const config = readMergeConfig(root);
    const agent = await mergerAgent(config.agent);
    if (!agent) {
      return stop(
        `${entry.head.slice(0, 7)} conflicts with ${entry.into}: merge ${entry.into} into ${entry.branch}, resolve it there, and review it again (no merger agent: install Claude Code or Codex)`,
      );
    }
    const model = modelOf(agent.kind, config);
    await set(id, { state: 'resolving', conflicts });
    const files = await Promise.all(
      conflicts.map(async (path) => ({ path, text: await readFile(join(worktree, path), 'utf8') })),
    );
    const rules = await readFile(join(root, 'symbiote', 'merge.md'), 'utf8').catch(() => undefined);
    const analysed = Date.now();
    const symbols = await bothChanged(base, entry.head, conflicts);
    log.out(
      `Symbols both sides changed in ${conflicts.join(', ')}: ${symbols.length} (${seconds(Date.now() - analysed)})\n`,
    );
    const prompt = mergerPrompt({
      branch: entry.branch,
      into: entry.into,
      head: entry.head,
      base,
      sides: await sidesOf(entry, base),
      files,
      symbols,
      ...(rules ? { rules } : {}),
      ...(entry.again ? { again: entry.again } : {}),
    });
    const regionCount = files.reduce((n, f) => n + conflictRegions(f.text).length, 0);
    log.out(
      `Asking ${AGENT_NAMES[agent.kind]}${model ? ` (${model})` : ''}: ${plural(regionCount, 'region')} in ${plural(files.length, 'file')}, ${prompt.length.toLocaleString('en-US')} characters\n`,
    );
    const effort = await effortOf(agent.kind, config.effort, model, (line) => log.out(line));
    const run = await agent.run({
      cwd: worktree,
      prompt,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      instructions: mergerInstructions(readPrompts(root).text.merger),
      // What it does as it works (V46b), in its step.
      onEvent: (event) => log.agent(event),
    });
    if (!run.ok) return stop(`the merger agent did not answer: ${run.error}`);
    log.out(
      `Answered in ${seconds(run.ms)}${run.usage ? ` · ${tokens(run.usage.input)} tokens in, ${tokens(run.usage.output)} out` : ''}\n`,
    );
    const about = {
      agent: agent.kind,
      ...(model ? { model } : {}),
      ...(run.usage ? { usage: run.usage } : {}),
      ms: run.ms,
    };
    const perFile = files.map((file) => ({ ...file, regions: conflictRegions(file.text) }));
    const count = perFile.reduce((n, f) => n + f.regions.length, 0);
    const answer = parseAnswer(run.text, count);
    if ('needsYou' in answer) {
      // What it asked about is kept for the person to read and answer.
      const asked = conflictsOf(perFile);
      return stop(
        `the merger agent: ${answer.needsYou}`,
        { resolution: { ...about, regions: [], needsYou: answer.needsYou, asked } },
        `it says you must decide: ${answer.needsYou}`,
      );
    }
    if ('error' in answer) return stop(`the merger agent's answer: ${answer.error}`);
    const regions = await writeAnswer(worktree, perFile, answer);
    let merged: string;
    try {
      merged = await commitResolution(worktree, conflicts, entry.title);
    } catch (error) {
      if (error instanceof MergeStepRefused) return stop(error.message);
      throw error;
    }
    log.out(
      `Wrote ${plural(regions.length, 'region')} in ${plural(perFile.length, 'file')}; committed the merge ${short(merged)}\n`,
    );
    log.end(true);
    await set(id, { conflicts, resolution: { ...about, regions }, again: undefined });
    return merged;
  }

  /**
   * The level the merger agent is asked at (V46d): `merge.effort` when the agent takes it on
   * `model` (V47: that model's levels when the agent lists it, its default's otherwise), none
   * otherwise, as Scout's (the project's file may name another agent's level). `say` is told which.
   */
  async function effortOf(
    kind: AgentKind,
    effort: string | undefined,
    model: string | undefined,
    say: (line: string) => void,
  ): Promise<string | undefined> {
    if (!effort) return undefined;
    const name = AGENT_NAMES[kind];
    const on = model ? (await models(kind))?.models.find((m) => m.id === model) : undefined;
    if (on && !on.efforts) {
      say(`merge.effort is ${effort}, which ${on.name} does not take: its own level\n`);
      return undefined;
    }
    const listed = (on?.efforts ?? (await levels(kind)))?.levels;
    if (!listed) {
      say(`Symbiote cannot read ${name}'s effort levels: its own level\n`);
      return undefined;
    }
    if (!listed.includes(effort)) {
      say(`merge.effort is ${effort}, which ${on?.name ?? name} does not list: its own level\n`);
      return undefined;
    }
    say(`Effort: ${effort} (merge.effort)\n`);
    return effort;
  }

  async function efforts(): Promise<ScoutEfforts> {
    const config = readMergeConfig(root);
    const agent = await mergerAgent(config.agent);
    const about = {
      ...(config.effort ? { effort: config.effort } : {}),
      ...(config.model ? { model: config.model } : {}),
      file: readPrompts(root).file,
    };
    if (!agent) return { agents: [], ...about };
    const [fallback, listed] = await Promise.all([levels(agent.kind), models(agent.kind)]);
    // Its levels on the model it runs on (V47).
    const efforts = levelsOn(listed?.models, modelOf(agent.kind, config), fallback);
    // Without merge.model: Symbiote's for Claude Code (V26c), Codex's configured one.
    const fixed = agent.kind === 'claude' ? MERGER_CLAUDE_MODEL : listed?.default;
    const by = agent.kind === 'claude' ? ('symbiote' as const) : ('agent' as const);
    return {
      agents: [
        {
          kind: agent.kind,
          ...(efforts ? { efforts } : {}),
          ...(listed ? { models: listed.models } : {}),
          ...(listed && fixed ? { defaultModel: { id: fixed, by } } : {}),
        },
      ],
      ...about,
    };
  }

  /** Moves `into` to the merge, or says why not; merged again when `into` moved meanwhile. */
  async function landEntry(entry: MergeEntry): Promise<MergeEntry> {
    const { id, into, merge, base } = entry;
    if (!merge || !base) throw new MergeRefused('nothing merged to land', 409);
    const log = logs.of(id);
    log.step('land', `Land in ${into}`);
    const refs = await listRefs(repo);
    const tip = tipOf(refs, into);
    if (!tip || tip.sha !== base || !(await isAncestor(repo, base, merge))) {
      // A fast-forward merged nothing: its target just moved (V67).
      const fastForward = entry.strategy === 'fast-forward';
      const moved = fastForward ? `${into} moved` : `${into} moved since the merge`;
      const again = fastForward ? 'fast-forwarding again from' : 'merging again on';
      log.out(`${moved} (now ${tip ? short(tip.sha) : 'gone'})\n`);
      log.end(false);
      log.run(`${again.charAt(0).toUpperCase()}${again.slice(1)} ${into}'s tip`);
      return set(id, { ...fresh, state: 'queued', message: `${moved}: ${again} its tip` });
    }
    // Read before landing: the landing may bring another config file into `root`.
    const { push: pushing } = readMergeConfig(root);
    const holder = (await listWorktrees(repo)).find((w) => w.branch === into && !w.prunable);
    try {
      await fastForwardBranch(repo, {
        branch: into,
        to: merge,
        from: tip.local ? base : null,
        ...(holder ? { checkedOut: holder.path } : {}),
      });
    } catch (error) {
      if (error instanceof MergeStepRefused) {
        const where = holder ? ` in ${holder.path}` : '';
        log.out(`${into} was not moved${where}: ${error.message}\n`);
        log.end(false);
        return set(id, {
          state: 'ready',
          message: `${into} was not moved${where}: ${error.message}`,
        });
      }
      log.end(false);
      throw error;
    }
    log.out(
      holder
        ? `${into} fast-forwarded to ${short(merge)} in ${holder.path}\n`
        : `${into} set to ${short(merge)}: checked out nowhere\n`,
    );
    const landed = await set(id, {
      state: 'landed',
      landed: now().toISOString(),
      message: undefined,
    });
    if (!pushing) {
      log.end(true);
      return landed;
    }
    const pushed = await push(into, merge);
    log.out(
      pushed.ok
        ? `Pushed to ${pushed.remote}\n`
        : `Not pushed${pushed.remote ? ` to ${pushed.remote}` : ''}: ${pushed.error}\n`,
    );
    log.end(true);
    return set(id, { pushed });
  }

  /** Pushes the landed branch to its upstream, else to `origin`. */
  async function push(into: string, sha: string): Promise<NonNullable<MergeEntry['pushed']>> {
    const upstream = await upstreamOf(repo, into);
    const refs = await listRefs(repo);
    const remote =
      upstream?.remote ??
      (refs.remotes.some((r) => r.remote === 'origin') ? 'origin' : refs.remotes[0]?.remote);
    if (!remote) return { ok: false, remote: '', error: 'no remote to push to' };
    const result = await pushCommit(repo, { remote, sha, branch: upstream?.branch ?? into });
    return result.ok ? { ok: true, remote } : { ok: false, remote, error: result.error };
  }

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
      return { merges, ...(elsewhere ? { elsewhere: true as const } : {}) };
    },

    async targets(branch) {
      const found: MergeTargets & { tip?: string } = await targets(branch);
      delete found.tip;
      return found;
    },

    async enqueue({ branch, into, strategy }, { start = true } = {}) {
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
