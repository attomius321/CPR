// One queued entry merged (V26, V67): reset to the target's tip, merged or fast-forwarded,
// resolved when it conflicts, checked, and landed when the check passes.
import {
  abortMerge,
  commitsBetween,
  isAncestor,
  listRefs,
  mergeInWorktree,
  resetMergeWorktree,
  type MergeCheckStep,
  type MergeEntry,
} from '@symbiote/core';
import { type MergerContext, short, plural, lastLines } from './merge-context.js';
import type { MergeTargetSteps } from './merge-targets.js';
import type { MergeLandSteps } from './merge-land.js';
import type { MergeResolveSteps } from './merge-resolve.js';
import { projectCheck } from './merge-config.js';

/** Why `into` cannot fast-forward to `branch`'s approved commit (V67, decision 486). */
export const cannotFastForward = (into: string, branch: string, behind: number) =>
  `${into} has ${plural(behind, 'commit')} ${branch} does not: it cannot fast-forward. Merge with a merge commit, or bring ${into} into the branch and review it again`;

/** The merger's run steps. */
export function mergeRun(
  {
    fresh,
    logs,
    now,
    queue,
    repo,
    root,
    runCheck,
    set,
    worktree,
  }: Pick<
    MergerContext,
    'fresh' | 'logs' | 'now' | 'queue' | 'repo' | 'root' | 'runCheck' | 'set' | 'worktree'
  >,
  {
    tipOf,
    landEntry,
    syncTarget,
    resolve,
  }: Pick<MergeTargetSteps, 'tipOf'> &
    Pick<MergeLandSteps, 'landEntry' | 'syncTarget'> &
    Pick<MergeResolveSteps, 'resolve'>,
) {
  /**
   * Merges, checks and, when the check passed, lands one entry, always on `into`'s tip as it is
   * now: a merge checked again whose target moved since is merged again.
   */
  async function mergeOne(entry: MergeEntry): Promise<void> {
    const { id, merge, base } = entry;
    let tip = tipOf(await listRefs(repo), entry.into);
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
    if (entry.by === 'hive' && tip?.local) {
      if (!(await syncTarget(entry, tip.sha))) return;
      tip = tipOf(await listRefs(repo), entry.into);
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
    // The merge step's time (V93, decision 881): the worktree's reset and the merge.
    const merging = Date.now();
    await resetMergeWorktree(repo, worktree, tip.sha);
    log.out(`Symbiote's merge worktree at ${entry.into} (${short(tip.sha)})\n`);
    const outcome = await mergeInWorktree(worktree, entry.head, entry.title, { keep: true });
    if ('conflicts' in outcome) {
      const n = outcome.conflicts.length;
      log.out(
        `${plural(n, 'file')} conflict${n === 1 ? 's' : ''}: ${outcome.conflicts.join(', ')}\n`,
      );
      if (entry.by === 'hive') {
        // No merger agent for Hive's merges (decision 769): its writer merges the target in.
        log.end(false);
        await abortMerge(worktree);
        await set(id, {
          state: 'needs-you',
          conflicts: outcome.conflicts,
          message: `${outcome.conflicts.join(', ')} conflict${n === 1 ? 's' : ''} with ${entry.into}: Hive asks ${entry.branch}'s agent to merge ${entry.into} in`,
          again: undefined,
        });
        return;
      }
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
    await set(id, { conflicts: undefined, again: undefined, mergeMs: Date.now() - merging });
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
    const merging = Date.now();
    await resetMergeWorktree(repo, worktree, head);
    log.out(`Symbiote's merge worktree at ${short(head)}\n`);
    log.end(true);
    await set(id, { mergeMs: Date.now() - merging });
    await checkMerge(id, tip, head, false);
  }

  /**
   * Runs the check on a merge. A clean one that passed lands; a resolved one (V26c) waits for
   * the person's review either way, its check's result with it.
   */
  async function checkMerge(id: string, base: string, merged: string, resolved: boolean) {
    const log = logs.of(id);
    const check = await projectCheck(repo, root, base);
    const hive = (await queue.read()).find((e) => e.id === id)?.by === 'hive';
    if (!check && hive && !resolved) {
      // Hive lands without a check when the project has none (decision 767).
      log.out('No check to run: Hive lands it\n');
      await landEntry(await set(id, { state: 'ready', merge: merged }));
      return;
    }
    if (!check) {
      const message = resolved
        ? 'no check to run: review the resolution, then Approve lands it'
        : 'no check to run: set merge.checks in symbiote/config.json, or Land once you have checked it';
      log.out(`${message.charAt(0).toUpperCase()}${message.slice(1)}\n`);
      await set(id, { state: resolved ? 'needs-you' : 'ready', merge: merged, message });
      return;
    }
    // When it started and each command's time (V93, decision 881): the Merge page's clock and
    // steps; written as each command ends.
    const at = now().toISOString();
    const steps: MergeCheckStep[] = [];
    await set(id, { state: 'checking', merge: merged, check: { ...check, started: at, steps } });
    const started = Date.now();
    let output = '';
    for (const command of check.commands) {
      log.step('check', command);
      const begun = Date.now();
      // A runner that does not stream gives its output at the end.
      let streamed = false;
      const result = await runCheck(command, worktree, (chunk) => {
        streamed = true;
        log.out(chunk);
      });
      if (!streamed) log.out(result.output);
      log.end(result.code === 0);
      output += result.output;
      steps.push({ command, ms: Date.now() - begun, ok: result.code === 0 });
      if (result.code !== 0) {
        await set(id, {
          state: resolved ? 'needs-you' : 'failed',
          check: {
            ...check,
            started: at,
            steps: [...steps],
            ok: false,
            ms: Date.now() - started,
            failed: command,
            output: lastLines(output),
          },
        });
        return;
      }
      if (steps.length < check.commands.length) {
        await set(id, { check: { ...check, started: at, steps: [...steps] } });
      }
    }
    const passed = await set(id, {
      state: resolved ? 'needs-you' : 'ready',
      check: {
        ...check,
        started: at,
        steps: [...steps],
        ok: true,
        ms: Date.now() - started,
        output: lastLines(output),
      },
    });
    if (!resolved) await landEntry(passed);
  }

  return { mergeOne };
}
