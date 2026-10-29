import type { BranchReviewList, BranchReviewSummary, Commit, RefList } from '@symbiote/core';
import type { MenuChoice } from './checkout.js';
import { VIA_NAMES as VIA } from '../workspaces/workspaces.js';
import { tip, type TipAttributes, type TipTone } from '../ui/tip.js';

/** One entry of a row's "Review" submenu (V15). */
export interface ReviewChoice extends MenuChoice {
  /** The ref to review (`POST /api/reviews`). */
  review: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A review's last verdict in words (V16), or its marks when it has none. */
function outcome(review: BranchReviewSummary): string {
  const { verdict } = review;
  if (verdict?.event === 'approve') {
    return verdict.merged && verdict.into ? `approved · merged into ${verdict.into}` : 'approved';
  }
  if (verdict?.event === 'request-changes') return 'changes requested';
  return `${review.marks} reviewed`;
}

/** How far a branch's review is, as the Review submenu says it. */
function reviewNote(review: BranchReviewSummary | undefined, ref: string): string | null {
  if (!review) return null;
  const at = review.refs.find((r) => r.name === ref);
  if (!at) return outcome(review);
  if (at.since > 0) return `${outcome(review)} · ${plural(at.since, 'commit')} since`;
  const decided =
    review.verdict && review.verdict.head === at.tip && review.verdict.event !== 'comment';
  return decided ? outcome(review) : `${review.marks} reviewed · in progress`;
}

/**
 * What a row offers to review: each branch on it once (its local branch, else a remote's), with
 * how far its review is. The default branch is offered for its unpushed commits (V16): disabled
 * without an upstream or with nothing unpushed, and as a remote branch (what was pushed).
 */
export function reviewChoices(
  commit: Commit,
  refs: RefList,
  list: BranchReviewList,
): ReviewChoice[] {
  const seen = new Set<string>();
  const choices: ReviewChoice[] = [];
  const branches = [
    ...commit.refs
      .filter((r) => r.kind === 'branch')
      .map((r) => ({ name: r.name, branch: r.name })),
    ...commit.refs.flatMap((r) => {
      const remote = r.kind === 'remote' ? refs.remotes.find((x) => x.name === r.name) : undefined;
      return remote ? [{ name: remote.name, branch: remote.branch }] : [];
    }),
  ];
  for (const { name, branch } of branches) {
    if (seen.has(branch)) continue;
    seen.add(branch);
    const ref = { kind: name === branch ? ('branch' as const) : ('remote' as const), name };
    const label = name === branch ? `Review branch ${name}` : `Review ${name}`;
    const review = list.reviews.find((r) => r.branch === branch);
    if (branch === list.defaultBranch) {
      const local = refs.branches.find((b) => b.name === name);
      const why = !local
        ? `the default branch as pushed: review ${branch}`
        : !local.upstream
          ? 'no upstream to compare it with'
          : !local.ahead
            ? 'no unpushed commits'
            : null;
      if (why) {
        choices.push({ label, ref, note: 'default branch', review: name, disabled: why });
        continue;
      }
      const unpushed = plural(local?.ahead ?? 0, 'unpushed commit');
      choices.push({ label, ref, note: reviewNote(review, name) ?? unpushed, review: name });
      continue;
    }
    choices.push({
      label,
      ref,
      note: reviewNote(review, name) ?? 'not reviewed yet',
      review: name,
    });
  }
  return choices;
}

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
 */
export function reviewMarks(list: BranchReviewList | null): {
  marks: Map<string, ReviewMark>;
  added: Map<string, string[]>;
} {
  const marks = new Map<string, ReviewMark>();
  const added = new Map<string, string[]>();
  for (const review of list?.reviews ?? []) {
    for (const ref of review.refs) marks.set(ref.name, markOf(review, ref.tip, ref.since));
    for (const sha of review.added) added.set(sha, [...(added.get(sha) ?? []), review.branch]);
  }
  return { marks, added };
}

function markOf(review: BranchReviewSummary, tip: string, since: number): ReviewMark {
  if (since > 0)
    return {
      mark: `+${since}`,
      title: `${plural(since, 'commit')} since your review`,
      tone: 'since',
    };
  const verdict = review.verdict?.head === tip ? review.verdict : undefined;
  if (verdict?.event === 'approve') {
    // Through Nucleus or symbiote mcp, on the person's Confirm (MC1).
    const approved = `Approved${verdict.via ? ` through ${VIA[verdict.via]}` : ''}`;
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
