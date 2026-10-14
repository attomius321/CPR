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
    { name: 'main', sha: sha('a') },
    { name: 'agent', sha: sha('b'), upstream: 'origin/agent', ahead: 0, behind: 0 },
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
      'remote:origin/topic → origin/topic · 3 reviewed · up to date',
    ]);
    expect(
      entries(commit('c', [{ kind: 'remote', name: 'origin/topic' }]), { ...LIST, reviews: [] }),
    ).toEqual(['remote:origin/topic → origin/topic · not reviewed yet']);
  });

  it('disables the default branch, and offers nothing on a row without branches', () => {
    expect(
      entries(
        commit('a', [
          { kind: 'head', name: 'HEAD' },
          { kind: 'branch', name: 'main' },
          { kind: 'remote', name: 'origin/main' },
          { kind: 'tag', name: 'v1' },
        ]),
      ),
    ).toEqual([
      'branch:main → main · default branch [nothing to compare it with: other branches start from it]',
    ]);
    expect(entries(commit('e', [{ kind: 'tag', name: 'v1' }]))).toEqual([]);
    const [agent] = reviewChoices(commit('b', [{ kind: 'branch', name: 'agent' }]), REFS, LIST);
    expect(agent?.label).toBe('Review branch agent');
  });
});

describe('reviewMarks', () => {
  it("marks each reviewed branch's refs, and the commits added since", () => {
    const marks = reviewMarks(LIST);
    expect([...marks.since]).toEqual([
      ['agent', 2],
      ['origin/agent', 2],
      ['origin/topic', 0],
    ]);
    expect(marks.added.get(sha('e'))).toEqual(['agent']);
    expect(marks.added.has(sha('c'))).toBe(false);
  });

  it("puts a branch's review on its badge, HEAD's too", () => {
    const { since } = reviewMarks(LIST);
    expect(
      rowBadges(
        [
          { kind: 'head', name: 'HEAD' },
          { kind: 'branch', name: 'agent' },
          { kind: 'remote', name: 'origin/agent' },
        ],
        'agent',
        since,
      ),
    ).toEqual([
      {
        kind: 'head',
        label: 'HEAD → agent',
        title: 'HEAD: the branch agent is checked out',
        review: 2,
      },
      { kind: 'remote', label: 'origin/agent', review: 2 },
    ]);
    expect(rowBadges([{ kind: 'remote', name: 'origin/topic' }], 'main', since)).toEqual([
      { kind: 'remote', label: 'origin/topic', review: 0 },
    ]);
  });
});
