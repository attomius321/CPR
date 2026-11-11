// An Approve that queues its merge (MC3, decision 991): the verdict recorded, then the approved
// commit's merge queued — the two steps the page's Approve and Merge into presses take, and Hive's
// landing (`hive-landing.ts`) — for Symbiote's MCP, on the person's one Confirm.
import type {
  BranchReviewInfo,
  FinishResult,
  LocalReview,
  MergeEntry,
  MergeStrategy,
} from '@symbiote/core';
import type { Merger } from './merges.js';
import type { BranchReviews } from './reviews.js';

/** Where an approval's merge goes, and how. */
export interface ApprovedMerge {
  into: string;
  strategy?: MergeStrategy;
}

/** The verdict, and its merge queued or why the queue refused it. */
export type Approved = FinishResult & { merge?: MergeEntry | { refused: string } };

/**
 * Records `review` on `info`'s branch (`read` gives its comments' code); then, with `merge`, queues
 * the approved commit's merge. A refusal of the queue is said and the verdict stands: it is what
 * the person approved.
 */
export async function approveAndQueue(
  { reviews, merges }: { reviews: Pick<BranchReviews, 'finish'>; merges: Pick<Merger, 'enqueue'> },
  info: BranchReviewInfo,
  review: LocalReview,
  read: (side: 'base' | 'head', path: string) => Promise<string>,
  merge?: ApprovedMerge,
): Promise<Approved> {
  const finished = await reviews.finish(info, review, read);
  if (!merge) return finished;
  try {
    const entry = await merges.enqueue({
      branch: info.branch,
      into: merge.into,
      ...(merge.strategy ? { strategy: merge.strategy } : {}),
    });
    return { ...finished, merge: entry };
  } catch (error) {
    return { ...finished, merge: { refused: (error as Error).message } };
  }
}
