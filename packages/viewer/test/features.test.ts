import type { BranchReviewSummary, FeatureStart, FeatureSummary } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import {
  branchProblem,
  featureChips,
  featureGroups,
  featureNext,
  proposeBranch,
  startedNotice,
} from '../src/features.js';

describe('proposeBranch', () => {
  const none = new Set<string>();
  it("names a branch after the brief's first line: five words, at most 40 characters", () => {
    expect(proposeBranch('Export a review as CSV\n\nOne row per comment.', 'feature/', none)).toBe(
      'feature/export-a-review-as-csv',
    );
    expect(proposeBranch("  Fix: the HEAD chip's colour (dark mode)!", 'feature/', none)).toBe(
      'feature/fix-the-head-chips-colour',
    );
    expect(proposeBranch('Café über naïve', '', none)).toBe('cafe-uber-naive');
    expect(
      proposeBranch('Internationalization accessibility internationalization more', 'f/', none),
    ).toBe('f/internationalization-accessibility');
    expect(proposeBranch('!!!', 'feature/', none)).toBe('feature/new');
    expect(proposeBranch('', 'feature/', none)).toBe('feature/new');
  });

  it('numbers a name that is taken', () => {
    const taken = new Set(['feature/csv', 'feature/csv-2']);
    expect(proposeBranch('CSV', 'feature/', taken)).toBe('feature/csv-3');
  });
});

describe('branchProblem', () => {
  const taken = new Set(['main', 'feature/csv']);
  it('says why a name cannot be a new branch, as git would', () => {
    expect(branchProblem('feature/new', taken)).toBeNull();
    expect(branchProblem('', taken)).toBe('a branch needs a name');
    expect(branchProblem('-x', taken)).toBe('a branch name cannot start with -');
    expect(branchProblem('feature/csv', taken)).toBe('a branch feature/csv exists');
    for (const bad of [
      'a b',
      'a..b',
      'a~b',
      'a^b',
      'a:b',
      'a?b',
      'a*b',
      'a[b',
      'a\\b',
      'a//b',
      '/a',
      'a/',
      'a.',
      'a/.b',
      'a.lock',
      'a/b.lock/c',
      'a@{b',
      '@',
      'feature/',
    ]) {
      expect(branchProblem(bad, taken), bad).toBe(`not a valid branch name: ${bad}`);
    }
  });
});

describe('startedNotice', () => {
  const feature: FeatureSummary = {
    branch: 'feature/csv',
    base: 'c'.repeat(40),
    from: 'main',
    created: '2026-10-15T09:00:00.000Z',
    planFirst: true,
    brief: 'CSV',
    worktree: { path: '/work/app.worktrees/feature-csv', exists: true },
    tip: 'c'.repeat(40),
    ahead: 0,
    merged: false,
    agent: { state: 'working', kind: 'claude', id: 's1' },
  };
  const start = (agent: FeatureSummary['agent']): FeatureStart => ({
    feature: { ...feature, agent },
    prompt: 'Build it.',
  });
  it('says where the feature is and whether its agent started', () => {
    expect(startedNotice(start(feature.agent))).toEqual({
      text: 'Started feature/csv: Claude Code is working in /work/app.worktrees/feature-csv.',
    });
    expect(
      startedNotice(
        start({ state: 'not-started', kind: 'claude', error: 'Workspace not trusted.' }),
      ),
    ).toEqual({
      text: 'Made feature/csv in /work/app.worktrees/feature-csv, but Claude Code did not start.',
      warning: 'Workspace not trusted.',
      copy: 'Build it.',
    });
    expect(startedNotice(start({ state: 'no-agent' }))).toEqual({
      text:
        'Made feature/csv in /work/app.worktrees/feature-csv. No agent was found to start: ' +
        'give it the prompt.',
      copy: 'Build it.',
    });
  });
});

const TIP = 'b'.repeat(40);
const summary = (over: Partial<FeatureSummary> = {}): FeatureSummary => ({
  branch: 'feature/csv',
  base: 'a'.repeat(40),
  from: 'main',
  created: '2026-10-15T09:00:00.000Z',
  planFirst: true,
  brief: 'Export a review as CSV\n\nOne row per comment.',
  worktree: { path: '/work/app.worktrees/feature-csv', exists: true, changed: 0 },
  tip: TIP,
  ahead: 0,
  merged: false,
  agent: { state: 'working', kind: 'claude', id: 's1' },
  ...over,
});
const review = (over: Partial<BranchReviewSummary> = {}): BranchReviewSummary => ({
  branch: 'feature/csv',
  base: 'a'.repeat(40),
  head: TIP,
  updated: '2026-10-15T10:00:00Z',
  marks: 3,
  refs: [{ name: 'feature/csv', tip: TIP, since: 0 }],
  added: [],
  ...over,
});
const verdict = (event: 'approve' | 'request-changes' | 'comment', head = TIP) => ({
  event,
  head,
  at: '2026-10-15T10:00:00Z',
  comments: 1,
  merged: false,
});

describe('featureNext', () => {
  const next = (f: Partial<FeatureSummary>, r?: Partial<BranchReviewSummary>) => {
    const { group, text, chip } = featureNext(summary(f), r ? review(r) : undefined);
    return { group, text, mark: chip.mark };
  };

  it("says what each feature needs from the person, by its agent's state", () => {
    expect(next({})).toEqual({ group: 'working', text: 'Working', mark: '⚙' });
    expect(
      next({ agent: { state: 'needs-you', kind: 'claude', waitingFor: 'permission prompt' } }),
    ).toEqual({ group: 'needs-you', text: 'Waiting: permission prompt', mark: '?' });
    expect(next({ agent: { state: 'plan-ready', kind: 'claude' } })).toEqual({
      group: 'needs-you',
      text: 'Plan ready: read it and answer',
      mark: '?',
    });
    expect(next({ agent: { state: 'failed', kind: 'claude' } })).toEqual({
      group: 'needs-you',
      text: 'Its agent failed',
      mark: '!',
    });
    expect(
      next({
        agent: { state: 'not-started', kind: 'claude', error: 'Workspace not trusted.\nMore' },
      }),
    ).toEqual({ group: 'needs-you', text: 'Not started: Workspace not trusted.', mark: '!' });
    expect(next({ agent: { state: 'no-agent' } })).toEqual({
      group: 'needs-you',
      text: 'No agent: give it the prompt',
      mark: '!',
    });
    expect(next({ agent: { state: 'done', kind: 'claude' }, planFirst: false })).toEqual({
      group: 'needs-you',
      text: 'Finished without commits',
      mark: '·',
    });
    expect(next({ agent: { state: 'stopped', kind: 'claude' } }).text).toBe('Stopped');
  });

  it('once it has commits, by its review', () => {
    const done = { agent: { state: 'ready' as const, kind: 'claude' as const }, ahead: 3 };
    expect(next(done)).toEqual({ group: 'needs-you', text: 'Ready for review', mark: '●' });
    expect(next(done, { verdict: verdict('request-changes') }).text).toBe(
      'Changes requested: send them to the agent',
    );
    expect(next(done, { verdict: verdict('comment') }).text).toBe(
      'Commented: send it to the agent',
    );
    expect(next(done, { verdict: verdict('approve') }).text).toBe(
      'Approved: ask your agent to merge it',
    );
    expect(
      next(done, {
        verdict: verdict('request-changes', 'c'.repeat(40)),
        refs: [{ name: 'feature/csv', tip: TIP, since: 2 }],
      }).text,
    ).toBe('2 commits since your review: review again');
    expect(next(done, {}).text).toBe('Review in progress');
    // Still working: its review waits.
    expect(next({ ahead: 3 }, { verdict: verdict('request-changes') }).group).toBe('working');
  });

  it('is done once merged; a branch gone needs cleaning up', () => {
    expect(next({ ahead: 3, merged: true, agent: { state: 'ready', kind: 'claude' } })).toEqual({
      group: 'done',
      text: 'Merged',
      mark: '✓',
    });
    expect(next({ tip: null, agent: { state: 'not-running', kind: 'claude' } })).toEqual({
      group: 'needs-you',
      text: 'Its branch is gone',
      mark: '!',
    });
  });
});

describe('featureGroups', () => {
  it('groups features by what they need, the reviews matched by branch', () => {
    const groups = featureGroups(
      [
        summary({ branch: 'feature/a' }),
        summary({ branch: 'feature/b', agent: { state: 'plan-ready', kind: 'claude' } }),
        summary({ branch: 'feature/c', ahead: 1, merged: true }),
        summary({ branch: 'feature/d', ahead: 2, agent: { state: 'ready', kind: 'claude' } }),
      ],
      {
        defaultBranch: 'main',
        reviewer: 'ada@example.com',
        place: 'repository',
        reviews: [review({ branch: 'feature/d', refs: [], verdict: verdict('request-changes') })],
      },
    );
    expect(groups.needsYou.map((r) => [r.feature.branch, r.next.text])).toEqual([
      ['feature/b', 'Plan ready: read it and answer'],
      ['feature/d', 'Changes requested: send them to the agent'],
    ]);
    expect(groups.working.map((r) => r.feature.branch)).toEqual(['feature/a']);
    expect(groups.done.map((r) => r.feature.branch)).toEqual(['feature/c']);
  });
});

describe('featureChips', () => {
  it("marks a feature's branch, local and pushed, with a link to the feature", () => {
    const chips = featureChips([summary(), summary({ branch: 'feature/gone', tip: null })], null, [
      { name: 'origin/feature/csv', branch: 'feature/csv' },
      { name: 'origin/other', branch: 'other' },
    ]);
    expect([...chips.keys()]).toEqual(['feature/csv', 'origin/feature/csv']);
    expect(chips.get('feature/csv')).toEqual({
      mark: '⚙',
      tone: 'working',
      title: 'Feature: Export a review as CSV — Working',
      href: '/features?branch=feature%2Fcsv',
    });
  });
});
