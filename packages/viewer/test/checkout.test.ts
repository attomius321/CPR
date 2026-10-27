import type { Commit, CommitRef, RefList } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  branchChoice,
  checkedOut,
  checkoutChoices,
  changesNote,
  type Head,
} from '../src/history/checkout.js';

const sha = (c: string) => c.repeat(40);
const commit = (c: string, refs: CommitRef[]): Commit => ({
  sha: sha(c),
  parents: [],
  author: 'Ada',
  date: '2026-10-13T08:00:00Z',
  subject: `commit ${c}`,
  refs,
});
const REFS: RefList = {
  branches: [
    { name: 'main', sha: sha('a') },
    { name: 'wip', sha: sha('b'), upstream: 'origin/wip', ahead: 0, behind: 0 },
    { name: 'topic', sha: sha('c') },
    { name: 'old', sha: sha('f'), upstream: 'origin/old', ahead: 0, behind: 1 },
  ],
  remotes: [
    { name: 'origin/wip', remote: 'origin', branch: 'wip', sha: sha('b') },
    { name: 'origin/new', remote: 'origin', branch: 'new', sha: sha('d') },
    { name: 'origin/topic', remote: 'origin', branch: 'topic', sha: sha('d') },
    { name: 'origin/main', remote: 'origin', branch: 'main', sha: sha('e') },
    { name: 'origin/old', remote: 'origin', branch: 'old', sha: sha('g') },
  ],
  tags: [{ name: 'v1', sha: sha('d') }],
};
const ON_MAIN = { branch: 'main', head: sha('a') };
const labels = (c: Commit, status: Head = ON_MAIN) =>
  checkoutChoices(c, REFS, status).map((choice) =>
    choice.disabled ? `${choice.label} [${choice.disabled}]` : choice.label,
  );

describe('checkoutChoices', () => {
  it('says where a branch checked out in another worktree is, as git would refuse it (V18b)', () => {
    const refs: RefList = {
      ...REFS,
      branches: [
        ...REFS.branches,
        { name: 'feature/csv', sha: sha('h'), worktree: '/work/app.worktrees/feature-csv' },
      ],
    };
    const row = commit('h', [{ kind: 'branch', name: 'feature/csv' }]);
    expect(
      checkoutChoices(row, refs, ON_MAIN).map((c) =>
        c.disabled ? `${c.label} [${c.disabled}]` : c.label,
      ),
    ).toEqual([
      'Check out branch feature/csv [checked out in /work/app.worktrees/feature-csv]',
      'Check out this commit (detached HEAD)',
    ]);
  });

  it("offers the row's branches, the current one disabled, then the commit itself", () => {
    expect(
      labels(
        commit('a', [
          { kind: 'head', name: 'HEAD' },
          { kind: 'branch', name: 'main' },
        ]),
      ),
    ).toEqual(['Check out branch main [checked out]', 'Check out this commit (detached HEAD)']);
  });

  it('offers a remote branch as a new local branch, or as the local branch tracking it', () => {
    const row = commit('d', [
      { kind: 'remote', name: 'origin/new' },
      { kind: 'remote', name: 'origin/topic' },
      { kind: 'tag', name: 'v1' },
    ]);
    expect(labels(row)).toEqual([
      'Check out origin/new as new',
      'Check out origin/topic as topic [a local branch topic exists and does not track origin/topic]',
      'Check out tag v1 (detached HEAD)',
      'Check out this commit (detached HEAD)',
    ]);
    const tracked = commit('b', [
      { kind: 'branch', name: 'wip' },
      { kind: 'remote', name: 'origin/wip' },
    ]);
    // The local branch is on the row: one entry for both.
    expect(labels(tracked)).toEqual([
      'Check out branch wip',
      'Check out this commit (detached HEAD)',
    ]);
    // Elsewhere: the remote entry checks out the local branch, where it is.
    const behind = commit('g', [{ kind: 'remote', name: 'origin/old' }]);
    expect(labels(behind)).toEqual([
      'Check out branch old (tracks origin/old)',
      'Check out this commit (detached HEAD)',
    ]);
    expect(checkoutChoices(behind, REFS, ON_MAIN)[0]).toMatchObject({
      target: { kind: 'remote', name: 'origin/old' },
      what: 'Checks out the branch old, at fffffff, which tracks origin/old.',
    });
    expect(labels(commit('e', [{ kind: 'remote', name: 'origin/main' }]))).toEqual([
      'Check out origin/main as main [a local branch main exists and does not track origin/main]',
      'Check out this commit (detached HEAD)',
    ]);
  });

  it('says what each checkout does', () => {
    const [created, , tag, detached] = checkoutChoices(
      commit('d', [
        { kind: 'remote', name: 'origin/new' },
        { kind: 'remote', name: 'origin/topic' },
        { kind: 'tag', name: 'v1' },
      ]),
      REFS,
      ON_MAIN,
    );
    expect(created).toMatchObject({
      target: { kind: 'remote', name: 'origin/new' },
      what: 'Creates the branch new at ddddddd, tracking origin/new, and checks it out.',
    });
    expect(tag).toMatchObject({
      target: { kind: 'tag', name: 'v1' },
      what:
        'Detaches HEAD at ddddddd (tag v1): commits made there belong to no branch until ' +
        'you create one.',
    });
    expect(detached).toMatchObject({ target: { kind: 'commit', sha: sha('d') } });
    const [branch] = checkoutChoices(commit('b', [{ kind: 'branch', name: 'wip' }]), REFS, ON_MAIN);
    expect(branch).toMatchObject({
      target: { kind: 'branch', name: 'wip' },
      what: 'Checks out the branch wip, at bbbbbbb.',
    });
  });

  it("names each target as the row's badges do, then says what it is and does", () => {
    const entries = (c: Commit) =>
      checkoutChoices(c, REFS, ON_MAIN).map(({ ref, note }) => `${ref.kind}:${ref.name} · ${note}`);
    expect(
      entries(
        commit('a', [
          { kind: 'head', name: 'HEAD' },
          { kind: 'branch', name: 'main' },
        ]),
      ),
    ).toEqual(['branch:main · branch', 'commit:aaaaaaa · this commit · detached HEAD']);
    expect(
      entries(
        commit('d', [
          { kind: 'remote', name: 'origin/new' },
          { kind: 'remote', name: 'origin/topic' },
          { kind: 'tag', name: 'v1' },
        ]),
      ),
    ).toEqual([
      'remote:origin/new · remote · creates branch new',
      'remote:origin/topic · remote',
      'tag:v1 · tag · detached HEAD',
      'commit:ddddddd · this commit · detached HEAD',
    ]);
    // A remote branch whose local branch is elsewhere: the local branch is what is checked out.
    expect(entries(commit('g', [{ kind: 'remote', name: 'origin/old' }]))).toEqual([
      'branch:old · branch · tracks origin/old',
      'commit:ggggggg · this commit · detached HEAD',
    ]);
  });

  it('disables the commit when HEAD is already detached there', () => {
    expect(labels(commit('d', []), { branch: null, head: sha('d') })).toEqual([
      'Check out this commit (detached HEAD) [checked out]',
    ]);
  });
});

describe('branchChoice (V66d: a double-click in the branches panel)', () => {
  it('checks out a local branch, or a remote one as its local branch, as the row menu does', () => {
    expect(branchChoice('topic', REFS, ON_MAIN)).toMatchObject({
      target: { kind: 'branch', name: 'topic' },
      what: 'Checks out the branch topic, at ccccccc.',
    });
    expect(branchChoice('main', REFS, ON_MAIN)?.disabled).toBe('checked out');
    expect(branchChoice('origin/new', REFS, ON_MAIN)).toMatchObject({
      target: { kind: 'remote', name: 'origin/new' },
      note: 'remote · creates branch new',
    });
    expect(branchChoice('origin/wip', REFS, ON_MAIN)?.label).toBe(
      'Check out branch wip (tracks origin/wip)',
    );
    expect(branchChoice('origin/topic', REFS, ON_MAIN)?.disabled).toBe(
      'a local branch topic exists and does not track origin/topic',
    );
    expect(branchChoice('nope', REFS, ON_MAIN)).toBeNull();
  });
});

describe('changesNote', () => {
  it('says what happens to local changes, or why a checkout cannot run', () => {
    expect(changesNote({ changed: 0, operation: null })).toBeNull();
    expect(changesNote({ changed: 1, operation: null })).toBe(
      '1 file has uncommitted changes: it comes along, unless the target changes it too — ' +
        'then git refuses and nothing changes.',
    );
    expect(changesNote({ changed: 3, operation: null })).toBe(
      '3 files have uncommitted changes: they come along, unless the target changes them too ' +
        '— then git refuses and nothing changes.',
    );
    expect(changesNote({ changed: 3, operation: 'rebase' })).toBe(
      'A rebase is in progress: finish or abort it first.',
    );
  });
});

describe('checkedOut', () => {
  it('says where HEAD is now', () => {
    expect(checkedOut({ branch: 'wip', head: sha('b') })).toBe('Switched to branch wip');
    expect(checkedOut({ branch: 'new', head: sha('d'), created: true }, 'origin/new')).toBe(
      'Created the branch new, tracking origin/new, and switched to it',
    );
    expect(checkedOut({ branch: null, head: sha('d') })).toBe('HEAD is now at ddddddd (detached)');
  });
});
