// A merge landed (V26): the target moved by fast-forward where it is checked out or by its ref,
// pushed when asked; a target behind its upstream brought up first.
import {
  fetchBranch,
  fastForwardBranch,
  isAncestor,
  listRefs,
  listWorktrees,
  MergeStepRefused,
  pushBranch,
  pushCommit,
  upstreamOf,
  type MergeEntry,
} from '@symbiote/core';
import { type MergerContext, MergeRefused, short } from './merge-context.js';
import type { MergeTargetSteps } from './merge-targets.js';
import { readMergeConfig } from './merge-config.js';

/** The merger's land steps. */
export function mergeLand(
  {
    fresh,
    logs,
    now,
    repo,
    root,
    set,
  }: Pick<MergerContext, 'fresh' | 'logs' | 'now' | 'repo' | 'root' | 'set'>,
  { tipOf }: Pick<MergeTargetSteps, 'tipOf'>,
) {
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
    // Read before landing: the landing may bring another config file into `root`. Hive's
    // landings push whatever it says (decision 768).
    const pushing = entry.by === 'hive' || readMergeConfig(root).push;
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
    const pushed = await push(into, merge, entry.by === 'hive');
    log.out(
      pushed.ok
        ? `Pushed to ${pushed.remote}\n`
        : `Not pushed${pushed.remote ? ` to ${pushed.remote}` : ''}: ${pushed.error}\n`,
    );
    log.end(true);
    return set(id, { pushed });
  }

  /** Where a branch is pushed and fetched: its upstream, else `origin`, else the first remote. */
  async function remoteOf(branch: string): Promise<{ remote: string; branch: string } | null> {
    const upstream = await upstreamOf(repo, branch);
    if (upstream) return { remote: upstream.remote, branch: upstream.branch };
    const refs = await listRefs(repo);
    const remote = refs.remotes.some((r) => r.remote === 'origin')
      ? 'origin'
      : refs.remotes[0]?.remote;
    return remote ? { remote, branch } : null;
  }

  /**
   * Pushes the landed branch to its upstream, else to `origin`; Hive's as a network run that never
   * waits on a prompt (decision 768).
   */
  async function push(
    into: string,
    sha: string,
    hive = false,
  ): Promise<NonNullable<MergeEntry['pushed']>> {
    const to = await remoteOf(into);
    if (!to) return { ok: false, remote: '', error: 'no remote to push to' };
    const { remote, branch } = to;
    const result = await (hive ? pushBranch : pushCommit)(repo, { remote, sha, branch });
    return result.ok ? { ok: true, remote } : { ok: false, remote, error: result.error };
  }

  /**
   * A Hive entry's target brought up to its remote before the merge (decision 768): fetched, and
   * fast-forwarded when it is behind, in the checkout that has it as a landing is. Diverged: the
   * entry fails, saying so, and false; never a force or a rebase. A fetch that fails is said, and
   * the merge goes on on the local tip (its push will say what the remote thinks of it).
   */
  async function syncTarget(entry: MergeEntry, local: string): Promise<boolean> {
    const log = logs.of(entry.id);
    const { into } = entry;
    const to = await remoteOf(into);
    if (!to) return true;
    const name = `${to.remote}/${to.branch}`;
    let theirs: string | null;
    try {
      theirs = await fetchBranch(repo, to.remote, to.branch);
    } catch (error) {
      log.out(`Not fetched from ${to.remote}: ${(error as Error).message}\n`);
      return true;
    }
    if (!theirs || theirs === local || (await isAncestor(repo, theirs, local))) return true;
    if (await isAncestor(repo, local, theirs)) {
      const holder = (await listWorktrees(repo)).find((w) => w.branch === into && !w.prunable);
      try {
        await fastForwardBranch(repo, {
          branch: into,
          to: theirs,
          from: local,
          ...(holder ? { checkedOut: holder.path } : {}),
        });
        log.out(`${into} brought up to ${name} (${short(theirs)})\n`);
      } catch (error) {
        if (!(error instanceof MergeStepRefused)) throw error;
        log.out(`${into} was not brought up to ${name}: ${error.message}\n`);
      }
      return true;
    }
    const message = `${into} and ${name} have diverged: Hive never forces or rebases; bring them together, then Hive lands it again`;
    log.out(`${message}\n`);
    log.end(false);
    await set(entry.id, { ...fresh, state: 'failed', message, diverged: name });
    return false;
  }

  return { landEntry, syncTarget };
}

export type MergeLandSteps = ReturnType<typeof mergeLand>;
