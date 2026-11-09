// The questions Git asks before a write onto the branch checked out (decisions 636–645): a commit
// cherry-picked, reverted or the branch reset to it; a branch merged in, rebased onto, or deleted
// from its remote. Each says what happens and runs the write once the person says yes.
import type { Ask } from './AskDialog.js';
import { shortSha } from './commits.js';
import { stoppedNotice } from './actions.js';
import {
  cherryPick,
  deleteRemoteBranch,
  fetchLeaving,
  merge,
  rebase,
  reset,
  revert,
} from './git-api.js';

/** The questions before a git write onto `onto`, the branch checked out ("HEAD" when detached). */
export function gitAsks(onto: string) {
  const stopsNote = 'On a conflict it stops: the conflicts are in the uncommitted changes.';
  const askCherryPick = (sha: string): Ask => ({
    title: `Cherry-pick ${shortSha(sha)} onto ${onto}?`,
    note: `Its changes made again on ${onto}, a new commit. ${stopsNote}`,
    verb: 'Cherry-pick',
    run: async () =>
      stoppedNotice(await cherryPick(sha), `Cherry-picked ${shortSha(sha)} onto ${onto}`),
    after: 'afresh',
  });
  const askRevert = (sha: string): Ask => ({
    title: `Revert ${shortSha(sha)}?`,
    note: `A new commit on ${onto} that undoes its changes. ${stopsNote}`,
    verb: 'Revert',
    run: async () => stoppedNotice(await revert(sha), `Reverted ${shortSha(sha)}`),
    after: 'afresh',
  });
  const askReset = (sha: string): Ask => ({
    title: `Reset ${onto} to ${shortSha(sha)}?`,
    note: `${onto} moves to ${shortSha(sha)}. The changes of the commits it leaves stay on disk, and the commits stay in git's reflog: nothing is lost.`,
    verb: 'Reset',
    choices: [
      { value: 'mixed', label: 'Mixed', note: 'their changes not staged' },
      { value: 'soft', label: 'Soft', note: 'their changes staged' },
    ],
    more: async () => {
      const count = await fetchLeaving(sha);
      return count === 0
        ? `No commit leaves ${onto}.`
        : `${count} commit${count === 1 ? ' leaves' : 's leave'} ${onto}.`;
    },
    run: async ({ choice }) => {
      await reset(sha, choice === 'soft' ? 'soft' : 'mixed');
      return { text: `Reset ${onto} to ${shortSha(sha)}, ${choice}` };
    },
    after: 'afresh',
  });
  const askMerge = (name: string): Ask => ({
    title: `Merge ${name} into ${onto}?`,
    note: `git's merge: a fast-forward when ${onto} has no commit of its own, else a merge commit. ${stopsNote}`,
    verb: 'Merge',
    run: async () => stoppedNotice(await merge(name), `Merged ${name} into ${onto}`),
    after: 'afresh',
  });
  const askRebase = (name: string): Ask => ({
    title: `Rebase ${onto} onto ${name}?`,
    note: `${onto}'s own commits are made again on top of ${name}; local changes must be committed or stashed first. On a conflict it stops at that commit: the conflicts are in the uncommitted changes.`,
    verb: 'Rebase',
    run: async () => stoppedNotice(await rebase(name), `Rebased ${onto} onto ${name}`),
    after: 'afresh',
  });
  const askDeleteRemote = (name: string, remote: string): Ask => ({
    title: `Delete ${name} from ${remote}?`,
    note: `The branch goes from ${remote}, for everyone who fetches it; local branches stay. ${remote}'s default branch is refused.`,
    verb: 'Delete',
    danger: true,
    run: async () => {
      await deleteRemoteBranch(name);
      return { text: `Deleted ${name} from ${remote}` };
    },
    after: 'here',
  });
  return { askCherryPick, askRevert, askReset, askMerge, askRebase, askDeleteRemote };
}
