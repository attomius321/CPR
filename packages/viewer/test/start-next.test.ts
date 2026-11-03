// V93 (decision 883): Start's "What happens next" (proof 06-start), from the choices made.
import { describe, expect, it } from 'vitest';
import { whatHappensNext } from '../src/workspaces/start-next.js';

describe('whatHappensNext', () => {
  it('plan first: the plan, your answer, your review, your Approve', () => {
    expect(
      whatHappensNext({ planFirst: true, into: 'main', kind: 'feature', agent: true }),
    ).toEqual([
      { icon: 'pencil', words: 'The agent writes its plan in its own worktree' },
      { icon: 'bell', words: 'You read it and answer:', turn: 'Waiting for you', you: true },
      { icon: 'eye', words: 'You review its commits on their graph', you: true },
      { icon: 'merge', words: 'Your Approve merges it into main' },
    ]);
  });

  it('without a plan: the work, your review, your Approve into its branch', () => {
    expect(
      whatHappensNext({ planFirst: false, into: 'develop', kind: 'fix', agent: true }),
    ).toEqual([
      { icon: 'pencil', words: 'The agent works and commits in its own worktree' },
      { icon: 'eye', words: 'You review its commits on their graph', you: true },
      { icon: 'merge', words: 'Your Approve merges it into develop' },
    ]);
  });

  it('a spike: its report to read, nothing to merge', () => {
    expect(whatHappensNext({ planFirst: false, into: 'main', kind: 'spike', agent: true })).toEqual(
      [
        { icon: 'pencil', words: 'The agent looks into it in its own worktree' },
        { icon: 'eye', words: 'You read its report:', turn: 'To review', you: true },
        { icon: 'merge', words: 'Nothing merges: a spike answers' },
      ],
    );
  });

  it('no agent: the branch and its worktree, then the prompt is yours', () => {
    expect(
      whatHappensNext({ planFirst: true, into: 'main', kind: 'feature', agent: false }),
    ).toEqual([
      { icon: 'pencil', words: 'Symbiote makes its branch and worktree' },
      { icon: 'bell', words: 'You give an agent its prompt', you: true },
    ]);
  });
});
