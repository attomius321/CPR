// History (V78): the finished workspaces — cleaned up, their records kept — and what became of
// their branches, read from Symbiote's own files and git, never from an agent (decision 572).
import type { FinishedWorkspace, WorkspaceOutcome } from '@symbiote/core';
import type { WorkspaceFile } from './workspace-record.js';

/** A record Clean up finished. */
export type FinishedRecord = WorkspaceFile & { finished: string };

/** What became of a finished workspace's branch, as History says it. */
export interface WorkspaceEnd {
  outcome: WorkspaceOutcome;
  into?: string;
  end?: string;
}

/**
 * The commit a finished workspace ended at (decision 573): the tip Clean up recorded (V78), else
 * its branch's tip while the branch is kept, else its review's last Approve; null when none is
 * known.
 */
export function endOf(
  workspace: WorkspaceFile,
  branchTip: string | null,
  approved: string | null,
): string | null {
  return workspace.tip ?? branchTip ?? approved;
}

/** The commit of a review's last Approve; null without one. */
export function approvedHead(verdicts: readonly { event: string; head: string }[]): string | null {
  return verdicts.findLast((v) => v.event === 'approve')?.head || null;
}

/** A finished record as History lists it. */
export function finishedEntry(workspace: FinishedRecord, ended: WorkspaceEnd): FinishedWorkspace {
  const agent = workspace.agent;
  return {
    branch: workspace.branch,
    ...(workspace.kind ? { kind: workspace.kind } : {}),
    ...(workspace.title ? { title: workspace.title } : {}),
    brief: workspace.brief,
    created: workspace.created,
    finished: workspace.finished,
    ...(workspace.by ? { by: workspace.by } : {}),
    ...(workspace.via ? { via: workspace.via } : {}),
    planFirst: workspace.planFirst,
    ...(agent
      ? {
          agent: {
            kind: agent.kind,
            ...(agent.model ? { model: agent.model } : {}),
            ...(agent.effort ? { effort: agent.effort } : {}),
          },
        }
      : {}),
    ...ended,
  };
}

/** Newest finished first; one time, by branch. */
export const byFinished = (a: FinishedWorkspace, b: FinishedWorkspace) =>
  b.finished.localeCompare(a.finished) || a.branch.localeCompare(b.branch);

/** `task` on each of `items`, `at` most at once, the answers in their order. */
export async function eachLimited<T, R>(
  items: readonly T[],
  at: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const answers = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      answers[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(at, items.length) }, worker));
  return answers;
}
