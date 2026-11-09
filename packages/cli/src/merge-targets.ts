// Where a branch merges into (V26, V65): its tip, its workspace's and review's records, the
// targets offered and the one picked.
import { dirname, join } from 'node:path';
import {
  defaultBranch,
  listRefs,
  tipsIn,
  type MergeTargets,
  type RefList,
  type Verdict,
} from '@symbiote/core';
import { readReview, reviewPath, reviewPlace } from './reviews.js';
import { readWorkspace, workspacePath, type WorkspaceFile } from './workspace-record.js';
import { branchNames } from './review-base.js';
import type { MergerContext } from './merge-context.js';
import { readMergeConfig } from './merge-config.js';

/** The merger's targets steps. */
export function mergeTargets({
  cacheDir,
  queue,
  repo,
  root,
}: Pick<MergerContext, 'cacheDir' | 'queue' | 'repo' | 'root'>) {
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

  return { tipOf, recordsOf, targets };
}

export type MergeTargetSteps = ReturnType<typeof mergeTargets>;
