import type { BranchReviewList, Commit, RefList } from '@cpr/core';
import type { MenuChoice } from './checkout.js';

/** One entry of a row's "Review" submenu (V15). */
export interface ReviewChoice extends MenuChoice {
  /** The ref to review (`POST /api/reviews`). */
  review: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What a row offers to review: each branch on it once (its local branch, else a remote's),
 * with how far its review is; the default branch disabled, since others start from it.
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
    if (branch === list.defaultBranch) {
      choices.push({
        label,
        ref,
        note: 'default branch',
        review: name,
        disabled: 'nothing to compare it with: other branches start from it',
      });
      continue;
    }
    const review = list.reviews.find((r) => r.branch === branch);
    const since = review?.refs.find((r) => r.name === name)?.since;
    const note = !review
      ? 'not reviewed yet'
      : since === undefined
        ? `${review.marks} reviewed`
        : `${review.marks} reviewed · ${since === 0 ? 'up to date' : `${plural(since, 'commit')} since`}`;
    choices.push({ label, ref, note, review: name });
  }
  return choices;
}

/** What the commits page shows of reviews: commits since review by ref, branches by new commit. */
export function reviewMarks(list: BranchReviewList | null): {
  since: Map<string, number>;
  added: Map<string, string[]>;
} {
  const since = new Map<string, number>();
  const added = new Map<string, string[]>();
  for (const review of list?.reviews ?? []) {
    for (const ref of review.refs) since.set(ref.name, ref.since);
    for (const sha of review.added) added.set(sha, [...(added.get(sha) ?? []), review.branch]);
  }
  return { since, added };
}
