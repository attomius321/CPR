import type { BranchReviewList, Commit, CommitRef, RefList } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { reviewChoices, reviewMarks } from '../src/branchReviews.js';
import { rowBadges } from '../src/commits.js';

const sha = (c: string) => c.repeat(40);
const commit = (c: string, refs: CommitRef[]): Commit => ({
  sha: sha(c),
  parents: [],
  author: 'Ada',
  date: '2026-10-14T08:00:00Z',
  subject: `commit ${c}`,
  refs,
});
const REFS: RefList = {
  branches: [
    { name: 'main', sha: sha('a'), upstream: 'origin/main', ahead: 2, behind: 0 },
    { name: 'agent', sha: sha('b'), upstream: 'origin/agent', ahead: 0, behind: 0 },
    { name: 'solo', sha: sha('f') },
  ],
  remotes: [
    { name: 'origin/main', remote: 'origin', branch: 'main', sha: sha('a') },
    { name: 'origin/agent', remote: 'origin', branch: 'agent', sha: sha('b') },
    { name: 'origin/topic', remote: 'origin', branch: 'topic', sha: sha('c') },
  ],
  tags: [],
};
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
const entries = (c: Commit, list: BranchReviewList = LIST) =>
  reviewChoices(c, REFS, list).map(
    ({ ref, note, disabled, review }) =>
      `${ref.kind}:${ref.name} → ${review} · ${note}${disabled ? ` [${disabled}]` : ''}`,
  );

describe('reviewChoices', () => {
  it('offers each branch on a row once, saying how far its review is', () => {
    expect(
      entries(
        commit('b', [
          { kind: 'branch', name: 'agent' },
          { kind: 'remote', name: 'origin/agent' },
        ]),
      ),
    ).toEqual(['branch:agent → agent · 12 reviewed · 2 commits since']);
    expect(entries(commit('c', [{ kind: 'remote', name: 'origin/topic' }]))).toEqual([
      'remote:origin/topic → origin/topic · 3 reviewed · in progress',
    ]);
    expect(
      entries(commit('c', [{ kind: 'remote', name: 'origin/topic' }]), { ...LIST, reviews: [] }),
    ).toEqual(['remote:origin/topic → origin/topic · not reviewed yet']);
  });

  it('offers the default branch for its unpushed commits (V16), and nothing on a row without branches', () => {
    const main = commit('a', [
      { kind: 'head', name: 'HEAD' },
      { kind: 'branch', name: 'main' },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'tag', name: 'v1' },
    ]);
    expect(entries(main)).toEqual(['branch:main → main · 2 unpushed commits']);
    const pushed: RefList = {
      ...REFS,
      branches: REFS.branches.map((b) => (b.name === 'main' ? { ...b, ahead: 0 } : b)),
    };
    const lone: RefList = {
      ...REFS,
      branches: REFS.branches.map((b) => (b.name === 'main' ? { name: 'main', sha: b.sha } : b)),
    };
    const note = (refs: RefList) =>
      reviewChoices(main, refs, LIST).map((c) => `${c.note} [${c.disabled ?? ''}]`);
    expect(note(pushed)).toEqual(['default branch [no unpushed commits]']);
    expect(note(lone)).toEqual(['default branch [no upstream to compare it with]']);
    // Only the pushed default branch on the row: its local branch is where the commits are.
    expect(entries(commit('g', [{ kind: 'remote', name: 'origin/main' }]))).toEqual([
      'remote:origin/main → origin/main · default branch [the default branch as pushed: review main]',
    ]);
    expect(entries(commit('e', [{ kind: 'tag', name: 'v1' }]))).toEqual([]);
    const [agent] = reviewChoices(commit('b', [{ kind: 'branch', name: 'agent' }]), REFS, LIST);
    expect(agent?.label).toBe('Review branch agent');
  });
});

describe('reviewMarks', () => {
  const verdict = (event: 'approve' | 'request-changes' | 'comment', head: string) => ({
    event,
    head,
    at: '2026-10-14T10:00:00Z',
    comments: 1,
    pushed: event === 'approve',
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
    expect(marks.get('agent')).toEqual({ mark: '+2', title: '2 commits since your review' });
    expect(marks.get('origin/topic')).toEqual({ mark: '✓', title: 'Approved and pushed' });
    expect(added.get(sha('e'))).toEqual(['agent']);
    expect(added.has(sha('c'))).toBe(false);
    // Reviewed at the tip with changes requested; reviewed with no verdict yet.
    const at = (event: 'request-changes' | 'comment' | null) =>
      reviewMarks({
        ...LIST,
        reviews: [{ ...LIST.reviews[1]!, ...(event ? { verdict: verdict(event, sha('c')) } : {}) }],
      }).marks.get('origin/topic');
    expect(at('request-changes')).toEqual({ mark: '✗', title: 'Changes requested' });
    expect(at('comment')).toEqual({ mark: '…', title: 'Commented, no verdict yet' });
    expect(at(null)).toEqual({ mark: '…', title: 'Review in progress' });
  });

  it('says the verdict in the Review submenu too', () => {
    expect(entries(commit('b', [{ kind: 'branch', name: 'agent' }]), withVerdicts)).toEqual([
      'branch:agent → agent · changes requested · 2 commits since',
    ]);
    expect(entries(commit('c', [{ kind: 'remote', name: 'origin/topic' }]), withVerdicts)).toEqual([
      'remote:origin/topic → origin/topic · approved and pushed',
    ]);
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
        review: { mark: '+2', title: '2 commits since your review' },
      },
      {
        kind: 'remote',
        label: 'origin/agent',
        review: { mark: '+2', title: '2 commits since your review' },
      },
    ]);
  });
});
