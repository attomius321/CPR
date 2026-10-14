import type { FeatureStart, FeatureSummary } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { branchProblem, proposeBranch, startedNotice } from '../src/features.js';

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
