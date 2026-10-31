import type { BranchReviewList, BranchReviewSummary } from '@symbiote/core';
import { viaName } from '../workspaces/workspaces.js';
import { tip, type TipAttributes, type TipTone } from '../ui/tip.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A reviewed branch's mark on its badges (V16), what it means, and its colour. */
export interface ReviewMark {
  mark: string;
  title: string;
  tone: 'since' | 'approved' | 'changes' | 'progress';
}

const REVIEW_TONES: Record<ReviewMark['tone'], TipTone | undefined> = {
  since: 'info',
  approved: 'ok',
  changes: 'bad',
  progress: undefined,
};

/** A review mark's tooltip (V54): what it means, after a dot of its colour. */
export const reviewTip = (mark: ReviewMark): TipAttributes =>
  tip(mark.title, { tone: REVIEW_TONES[mark.tone] });

/**
 * What the commits page shows of reviews: each reviewed branch's mark by ref name — "+2" commits
 * since the review, else its verdict at the tip ("✓", "✗"), else "…" — and branches by new commit.
 * An approval through Nucleus names it `nucleus` (Alpha Ceph in Hive mode).
 */
export function reviewMarks(
  list: BranchReviewList | null,
  nucleus = 'Nucleus',
): {
  marks: Map<string, ReviewMark>;
  added: Map<string, string[]>;
} {
  const marks = new Map<string, ReviewMark>();
  const added = new Map<string, string[]>();
  for (const review of list?.reviews ?? []) {
    for (const ref of review.refs) marks.set(ref.name, markOf(review, ref.tip, ref.since, nucleus));
    for (const sha of review.added) added.set(sha, [...(added.get(sha) ?? []), review.branch]);
  }
  return { marks, added };
}

function markOf(
  review: BranchReviewSummary,
  tip: string,
  since: number,
  nucleus: string,
): ReviewMark {
  if (since > 0)
    return {
      mark: `+${since}`,
      title: `${plural(since, 'commit')} since your review`,
      tone: 'since',
    };
  const verdict = review.verdict?.head === tip ? review.verdict : undefined;
  if (verdict?.event === 'approve') {
    // Through Nucleus or symbiote mcp, on the person's Confirm (MC1).
    const approved = `Approved${verdict.via ? ` through ${viaName(verdict.via, nucleus)}` : ''}`;
    const title =
      verdict.merged && verdict.into ? `${approved} · merged into ${verdict.into}` : approved;
    return { mark: '✓', title, tone: 'approved' };
  }
  if (verdict?.event === 'request-changes') {
    return { mark: '✗', title: 'Changes requested', tone: 'changes' };
  }
  if (verdict?.event === 'comment') {
    return { mark: '…', title: 'Commented, no verdict yet', tone: 'progress' };
  }
  return { mark: '…', title: 'Review in progress', tone: 'progress' };
}
