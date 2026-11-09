// The questions Git asks before a write (decisions 636–645): moved out of HistoryPage.tsx
// (refactor/viewer-pages) as gitAsks(onto), with what they said there.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/history/git-api.js', () => ({
  cherryPick: vi.fn(() => Promise.resolve({})),
  revert: vi.fn(() => Promise.resolve({ stopped: 'CONFLICT in a.ts' })),
  reset: vi.fn(() => Promise.resolve({})),
  merge: vi.fn(() => Promise.resolve({})),
  rebase: vi.fn(() => Promise.resolve({})),
  deleteRemoteBranch: vi.fn(() => Promise.resolve({})),
  fetchLeaving: vi.fn((sha: string) => Promise.resolve(sha.startsWith('0') ? 0 : 3)),
}));

const { gitAsks } = await import('../src/history/git-asks.js');
const { reset } = await import('../src/history/git-api.js');

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const STOPS = 'On a conflict it stops: the conflicts are in the uncommitted changes.';

describe('gitAsks', () => {
  const asks = gitAsks('main');

  it('asks before a commit is cherry-picked or reverted onto the branch', async () => {
    const pick = asks.askCherryPick(SHA);
    expect(pick).toMatchObject({
      title: 'Cherry-pick abcdef0 onto main?',
      note: `Its changes made again on main, a new commit. ${STOPS}`,
      verb: 'Cherry-pick',
      after: 'afresh',
    });
    expect(await pick.run({ text: '', choice: '' })).toEqual({
      text: 'Cherry-picked abcdef0 onto main',
    });
    const back = asks.askRevert(SHA);
    expect(back).toMatchObject({
      title: 'Revert abcdef0?',
      note: `A new commit on main that undoes its changes. ${STOPS}`,
      verb: 'Revert',
      after: 'afresh',
    });
    expect(await back.run({ text: '', choice: '' })).toEqual({
      text: 'Stopped on conflicts: resolve them in the uncommitted changes',
      warning: 'CONFLICT in a.ts',
    });
  });

  it('asks how a reset keeps the changes, and says how many commits leave', async () => {
    const ask = asks.askReset(SHA);
    expect(ask).toMatchObject({
      title: 'Reset main to abcdef0?',
      verb: 'Reset',
      after: 'afresh',
      choices: [
        { value: 'mixed', label: 'Mixed', note: 'their changes not staged' },
        { value: 'soft', label: 'Soft', note: 'their changes staged' },
      ],
    });
    expect(ask.note).toBe(
      "main moves to abcdef0. The changes of the commits it leaves stay on disk, and the commits stay in git's reflog: nothing is lost.",
    );
    expect(await ask.more?.()).toBe('3 commits leave main.');
    expect(await asks.askReset(`0${SHA.slice(1)}`).more?.()).toBe('No commit leaves main.');
    expect(await ask.run({ text: '', choice: 'soft' })).toEqual({
      text: 'Reset main to abcdef0, soft',
    });
    expect(reset).toHaveBeenLastCalledWith(SHA, 'soft');
    await ask.run({ text: '', choice: 'other' });
    expect(reset).toHaveBeenLastCalledWith(SHA, 'mixed');
  });

  it('asks before a branch is merged in, rebased onto or deleted from its remote', async () => {
    expect(asks.askMerge('feature/x')).toMatchObject({
      title: 'Merge feature/x into main?',
      note: `git's merge: a fast-forward when main has no commit of its own, else a merge commit. ${STOPS}`,
      verb: 'Merge',
      after: 'afresh',
    });
    expect(asks.askRebase('feature/x')).toMatchObject({
      title: 'Rebase main onto feature/x?',
      verb: 'Rebase',
      after: 'afresh',
    });
    const gone = asks.askDeleteRemote('origin/feature/x', 'origin');
    expect(gone).toMatchObject({
      title: 'Delete origin/feature/x from origin?',
      note: "The branch goes from origin, for everyone who fetches it; local branches stay. origin's default branch is refused.",
      verb: 'Delete',
      danger: true,
      after: 'here',
    });
    expect(await gone.run({ text: '', choice: '' })).toEqual({
      text: 'Deleted origin/feature/x from origin',
    });
  });

  it('names HEAD when it is detached', () => {
    expect(gitAsks('HEAD').askRevert(SHA).note).toBe(
      `A new commit on HEAD that undoes its changes. ${STOPS}`,
    );
  });
});
