import type { BranchReviewList } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { reviewMarks } from '../src/history/branchReviews.js';
import { rowBadges } from '../src/history/commits.js';

const sha = (c: string) => c.repeat(40);
const LIST: BranchReviewList = {
  defaultBranch: 'main',
  reviewer: 'ada@example.com',
  place: 'repository',
  reviews: [
    {
      branch: 'agent',
      base: sha('a'),
      head: sha('d'),
      updated: '2026-10-14T09:00:00Z',
      marks: 12,
      refs: [
        { name: 'agent', tip: sha('b'), since: 2 },
        { name: 'origin/agent', tip: sha('b'), since: 2 },
      ],
      added: [sha('b'), sha('e')],
    },
    {
      branch: 'topic',
      base: sha('a'),
      head: sha('c'),
      updated: '2026-10-14T09:00:00Z',
      marks: 3,
      refs: [{ name: 'origin/topic', tip: sha('c'), since: 0 }],
      added: [],
    },
  ],
};
describe('reviewMarks', () => {
  const verdict = (
    event: 'approve' | 'request-changes' | 'comment',
    head: string,
    merged = false,
  ) => ({
    event,
    head,
    at: '2026-10-14T10:00:00Z',
    comments: 1,
    ...(event === 'approve' ? { into: 'main' } : {}),
    merged,
  });
  const withVerdicts: BranchReviewList = {
    ...LIST,
    reviews: [
      { ...LIST.reviews[0]!, verdict: verdict('request-changes', sha('d')) },
      { ...LIST.reviews[1]!, verdict: verdict('approve', sha('c')) },
    ],
  };

  it('marks a branch with commits since its review "+n", else by its verdict at the tip', () => {
    const { marks, added } = reviewMarks(withVerdicts);
    expect(marks.get('agent')).toEqual({
      mark: '+2',
      title: '2 commits since your review',
      tone: 'since',
    });
    expect(marks.get('origin/topic')).toEqual({ mark: '✓', title: 'Approved', tone: 'approved' });
    // Once the agent merged the approved commit (V17).
    const merged = reviewMarks({
      ...LIST,
      reviews: [{ ...LIST.reviews[1]!, verdict: verdict('approve', sha('c'), true) }],
    });
    expect(merged.marks.get('origin/topic')).toEqual({
      mark: '✓',
      title: 'Approved · merged into main',
      tone: 'approved',
    });
    // Through Nucleus, on the person's Confirm (MC1).
    const nucleus = reviewMarks({
      ...LIST,
      reviews: [
        { ...LIST.reviews[1]!, verdict: { ...verdict('approve', sha('c')), via: 'nucleus' } },
      ],
    });
    expect(nucleus.marks.get('origin/topic')?.title).toBe('Approved through Nucleus');
    expect(added.get(sha('e'))).toEqual(['agent']);
    expect(added.has(sha('c'))).toBe(false);
    // Reviewed at the tip with changes requested; reviewed with no verdict yet.
    const at = (event: 'request-changes' | 'comment' | null) =>
      reviewMarks({
        ...LIST,
        reviews: [{ ...LIST.reviews[1]!, ...(event ? { verdict: verdict(event, sha('c')) } : {}) }],
      }).marks.get('origin/topic');
    expect(at('request-changes')).toEqual({
      mark: '✗',
      title: 'Changes requested',
      tone: 'changes',
    });
    expect(at('comment')).toEqual({
      mark: '…',
      title: 'Commented, no verdict yet',
      tone: 'progress',
    });
    expect(at(null)).toEqual({ mark: '…', title: 'Review in progress', tone: 'progress' });
  });

  it("puts a branch's mark on its badge, HEAD's too", () => {
    const { marks } = reviewMarks(withVerdicts);
    expect(
      rowBadges(
        [
          { kind: 'head', name: 'HEAD' },
          { kind: 'branch', name: 'agent' },
          { kind: 'remote', name: 'origin/agent' },
        ],
        'agent',
        marks,
      ),
    ).toEqual([
      {
        kind: 'head',
        label: 'HEAD → agent',
        title: 'HEAD: the branch agent is checked out',
        review: { mark: '+2', title: '2 commits since your review', tone: 'since' },
      },
      {
        kind: 'remote',
        label: 'origin/agent',
        review: { mark: '+2', title: '2 commits since your review', tone: 'since' },
      },
    ]);
  });
});
