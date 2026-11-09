// A workspace against the default branch: its tips, where a workspace's review and commits start,
// whether its end is in the default branch (V65, V77). Read once per list of refs; ancestry and
// known commits kept, as they never change.
import {
  defaultBranch,
  git,
  isAncestor,
  isCommit,
  type WorkspaceAgainst,
  type RefList,
} from '@symbiote/core';
import type { WorkspaceFile } from './workspace-record.js';
import { branchNames, reviewBase } from './review-base.js';
import { readReview, reviewPath, type ReviewPlace } from './reviews.js';
import { approvedHead, endOf, type WorkspaceEnd } from './workspace-history.js';
import type { WorkspacesContext } from './workspace-context.js';

/** What the person can review a workspace against (V65), and what it is reviewed against. */
export function againstOf(workspace: WorkspaceFile, refs: RefList): WorkspaceAgainst {
  return {
    ...(workspace.against ? { against: workspace.against } : {}),
    ...(workspace.from ? { from: workspace.from } : {}),
    base: workspace.base,
    branches: branchNames(refs).filter((name) => name !== workspace.branch),
  };
}

/** The default branch's lookups over `repo`. */
export function workspaceTrunk({ repo }: Pick<WorkspacesContext, 'repo'>) {
  /**
   * The default branch for one read of the refs: looked up once (a git run per remote) for all
   * the workspaces of a list.
   */
  const mains = new WeakMap<RefList, Promise<string | null>>();

  function mainOf(refs: RefList): Promise<string | null> {
    let main = mains.get(refs);
    if (!main) {
      main = defaultBranch(repo, refs);
      mains.set(refs, main);
    }
    return main;
  }

  /** The default branch's tips, local and remotes'. */
  async function trunkOf(refs: RefList): Promise<string[]> {
    const name = await mainOf(refs);
    if (!name) return [];
    return [
      ...refs.branches.filter((b) => b.name === name).map((b) => b.sha),
      ...refs.remotes.filter((r) => r.branch === name).map((r) => r.sha),
    ];
  }

  /** Where a workspace's review starts and what it merges into (V65), as Review computes it. */
  async function baseOf(workspace: WorkspaceFile, refs: RefList, tip: string) {
    return reviewBase(repo, refs, workspace.branch, tip, await mainOf(refs), workspace);
  }

  /**
   * Where a workspace's commits start (decision 187): where its review starts (V65); the commit
   * it started at once merged (the fork point is then its tip, which a branch without commits yet
   * also is). `since` names the branch the base is the fork point with.
   */
  async function changesBase(
    workspace: WorkspaceFile,
    refs: RefList,
    tip: string,
  ): Promise<{ base: string; since?: string }> {
    const found = await baseOf(workspace, refs, tip);
    if (found?.since && (found.base !== tip || found.base === workspace.base)) {
      return { base: found.base, since: found.since };
    }
    return { base: workspace.base };
  }

  /** Ancestry answers by commit and tip, and commits known to git (V77): neither ever changes. */
  const ancestry = new Map<string, Promise<boolean>>();

  const known = new Set<string>();

  const inHistoryOf = (commit: string, tip: string) => {
    const key = `${commit}:${tip}`;
    let answer = ancestry.get(key);
    if (!answer) {
      answer = isAncestor(repo, commit, tip);
      ancestry.set(key, answer);
      answer.catch(() => ancestry.delete(key));
    }
    return answer;
  };

  const hasCommit = async (sha: string) => {
    if (known.has(sha)) return true;
    const has = await isCommit(repo, sha);
    if (has) known.add(sha);
    return has;
  };

  /**
   * What became of a finished workspace's branch (V77): the commit it ended at (decision 565),
   * when git has it, and whether the default branch `into` holds it — a branch with no commit of
   * its own (its end its base) is not merged.
   */
  async function endedAt(
    where: ReviewPlace,
    workspace: WorkspaceFile,
    refs: RefList,
    into: string | null,
    /** The default branch's newer commits, read once for the whole list: an end among them is in it. */
    recent?: ReadonlySet<string>,
  ): Promise<WorkspaceEnd> {
    const kept = refs.branches.find((b) => b.name === workspace.branch)?.sha ?? null;
    const review =
      workspace.tip || kept
        ? null
        : await readReview(reviewPath(where.dir, workspace.branch, where.reviewer));
    const named = endOf(workspace, kept, review ? approvedHead(review.verdicts) : null);
    // In the default branch first: a commit it holds is one git has, so most ends cost one run
    // (V77: 299 ms for the person's 97 before, two runs each). A name git lacks is not merged.
    let merged = workspace.merged === true;
    let inTrunk = named !== null && named !== workspace.base && recent?.has(named) === true;
    if (named && named !== workspace.base && !inTrunk) {
      for (const tip of new Set(await trunkOf(refs))) {
        if (await inHistoryOf(named, tip).catch(() => false)) {
          inTrunk = true;
          break;
        }
      }
    }
    merged ||= inTrunk;
    const end = named && (inTrunk || named === kept || (await hasCommit(named))) ? named : null;
    const at = end ? { end } : {};
    if (merged) return { outcome: 'merged', ...(into ? { into } : {}), ...at };
    return { outcome: kept ? 'kept' : 'gone', ...at };
  }

  /**
   * The default branch's commits since `since` (V77), in one git run: from Node each run costs
   * about 3 ms to start, one after another (85 ancestry checks took 280 ms on WSL). Whatever it
   * lists is in the default branch; what it does not is asked on its own.
   */
  async function trunkSince(refs: RefList, since: string): Promise<Set<string>> {
    const tips = [...new Set(await trunkOf(refs))];
    if (tips.length === 0) return new Set();
    const listed = await git(repo.root, ['rev-list', `--since=${since}`, ...tips, '--']);
    return new Set(listed.split('\n').filter(Boolean));
  }

  return { mainOf, trunkOf, baseOf, changesBase, inHistoryOf, hasCommit, endedAt, trunkSince };
}

export type WorkspaceTrunk = ReturnType<typeof workspaceTrunk>;
