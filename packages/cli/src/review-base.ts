// Where a branch's review starts (V65): the one rule Review, a workspace's changes, its count and
// its merge check share (decision 187), from the workspace's record when the branch has one.
import { forkPoint, isAncestor, isCommit, type GitRepo, type RefList } from '@symbiote/core';
import type { WorkspaceFile } from './workspace-record.js';

/** What of a workspace's record decides where its review starts. */
export type ReviewedWorkspace = Pick<WorkspaceFile, 'base' | 'branch' | 'from' | 'against'>;

export interface ReviewBase {
  /** The commit the review starts at; the tip itself once merged into `since`. */
  base: string;
  /** The branch `base` is the fork point with; absent when it is the commit the workspace started at. */
  since?: string;
  /** The branch an approval merges into: the one reviewed against; absent on the default branch. */
  into?: string;
}

/** Every branch name: local ones, and remote ones by name, sorted. */
export function branchNames(refs: RefList): string[] {
  return [...new Set([...refs.branches.map((b) => b.name), ...refs.remotes.map((r) => r.branch)])]
    .filter((name) => name !== 'HEAD')
    .sort();
}

/** Whether `refs` name a branch `name`, locally or on a remote. */
export function hasBranch(refs: RefList, name: string): boolean {
  return (
    name !== 'HEAD' &&
    (refs.branches.some((b) => b.name === name) || refs.remotes.some((r) => r.branch === name))
  );
}

/**
 * The branch `branch` is reviewed against and an approval merges into (V65, decision 473): the
 * one its workspace picked, else the one it started from, else the default branch `main`; each
 * only while it is a branch and not `branch` itself.
 */
export function reviewedAgainst(
  refs: RefList,
  branch: string,
  main: string | null,
  workspace: ReviewedWorkspace | null,
): { into?: string; picked: boolean } {
  const other = (name: string | null | undefined): name is string =>
    !!name && name !== branch && hasBranch(refs, name);
  if (other(workspace?.against)) return { into: workspace.against, picked: true };
  if (other(workspace?.from)) return { into: workspace.from, picked: false };
  return other(main) ? { into: main, picked: false } : { picked: false };
}

/**
 * Where `branch`'s review starts at `tip` (V65). Without a workspace, the fork point with the
 * default branch `main` (V15). A workspace's: the fork point with the branch picked to review it
 * against (decision 472); else the commit it started at, moved to the fork point with the branch
 * it started from (`from`, else `main`) once it took that branch in (decision 471). An approval
 * merges into the branch reviewed against (decision 473). Null without a common ancestor, or
 * without a default branch and a workspace.
 */
export async function reviewBase(
  repo: GitRepo,
  refs: RefList,
  branch: string,
  tip: string,
  main: string | null,
  workspace: ReviewedWorkspace | null,
): Promise<ReviewBase | null> {
  const { into, picked } = reviewedAgainst(refs, branch, main, workspace);
  const fork = into ? await forkPoint(repo, tip, into, refs) : null;
  if (!workspace || picked) return fork && into ? { base: fork, since: into, into } : null;
  const started = workspace.base;
  // A start commit git no longer has (rebased, then collected) leaves the fork point.
  const taken =
    fork &&
    (fork === started ||
      !(await isCommit(repo, started)) ||
      (await isAncestor(repo, started, fork)));
  if (fork && into && taken) return { base: fork, since: into, into };
  return { base: started, ...(into ? { into } : {}) };
}
