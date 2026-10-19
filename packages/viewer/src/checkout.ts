import type { CheckoutResult, CheckoutTarget, Commit, RefList, WorkingState } from '@cpr/core';
import { shortSha } from './commits.js';

/** An entry of a row menu's submenu (V14): a ref drawn as the row's badges draw it. */
export interface MenuChoice {
  /** The entry as a sentence: its accessible name. */
  label: string;
  ref: { kind: 'branch' | 'remote' | 'tag' | 'commit'; name: string };
  /** After the name: what it is and what choosing it does ("tag · detached HEAD"). */
  note: string;
  /** Why it cannot be chosen. */
  disabled?: string;
}

/** One entry of a row's checkout menu (V11). */
export interface CheckoutChoice extends MenuChoice {
  target: CheckoutTarget;
  /** What the checkout does, for its confirmation. */
  what: string;
}

/** Where HEAD is: the branch checked out (null when detached) and its commit. */
export interface Head {
  branch: string | null;
  head: string | null;
}

const DETACHED = 'commits made there belong to no branch until you create one.';

/**
 * What a row offers to check out: its local branches (the current one disabled), its remote
 * branches as their local branch (created, or the one tracking it; refused when a branch of
 * that name tracks something else), its tags and the commit itself, detached. The server
 * checks the same rules again (`checkout` in core).
 */
export function checkoutChoices(commit: Commit, refs: RefList, head: Head): CheckoutChoice[] {
  const at = shortSha(commit.sha);
  // Checked out here, or in another worktree (a workspace's, V18b): git refuses both.
  const current = (branch: string) => {
    if (branch === head.branch) return { disabled: 'checked out' };
    const elsewhere = refs.branches.find((b) => b.name === branch)?.worktree;
    return elsewhere ? { disabled: `checked out in ${elsewhere}` } : {};
  };
  const onRow = new Set(commit.refs.filter((r) => r.kind === 'branch').map((r) => r.name));
  const choices: CheckoutChoice[] = [];
  for (const ref of commit.refs) {
    if (ref.kind === 'branch') {
      choices.push({
        label: `Check out branch ${ref.name}`,
        ref: { kind: 'branch', name: ref.name },
        note: 'branch',
        target: { kind: 'branch', name: ref.name },
        what: `Checks out the branch ${ref.name}, at ${at}.`,
        ...current(ref.name),
      });
    }
  }
  for (const ref of commit.refs) {
    if (ref.kind !== 'remote') continue;
    const remote = refs.remotes.find((r) => r.name === ref.name);
    if (!remote) continue;
    const local = refs.branches.find((b) => b.name === remote.branch);
    const target: CheckoutTarget = { kind: 'remote', name: remote.name };
    if (!local) {
      choices.push({
        label: `Check out ${remote.name} as ${remote.branch}`,
        ref: { kind: 'remote', name: remote.name },
        note: `remote · creates branch ${remote.branch}`,
        target,
        what: `Creates the branch ${remote.branch} at ${at}, tracking ${remote.name}, and checks it out.`,
      });
    } else if (local.upstream !== remote.name) {
      choices.push({
        label: `Check out ${remote.name} as ${remote.branch}`,
        ref: { kind: 'remote', name: remote.name },
        note: 'remote',
        target,
        what: '',
        disabled: `a local branch ${local.name} exists and does not track ${remote.name}`,
      });
    } else if (!onRow.has(local.name)) {
      choices.push({
        label: `Check out branch ${local.name} (tracks ${remote.name})`,
        ref: { kind: 'branch', name: local.name },
        note: `branch · tracks ${remote.name}`,
        target,
        what: `Checks out the branch ${local.name}, at ${shortSha(local.sha)}, which tracks ${remote.name}.`,
        ...current(local.name),
      });
    }
  }
  for (const ref of commit.refs) {
    if (ref.kind === 'tag') {
      choices.push({
        label: `Check out tag ${ref.name} (detached HEAD)`,
        ref: { kind: 'tag', name: ref.name },
        note: 'tag · detached HEAD',
        target: { kind: 'tag', name: ref.name },
        what: `Detaches HEAD at ${at} (tag ${ref.name}): ${DETACHED}`,
      });
    }
  }
  choices.push({
    label: 'Check out this commit (detached HEAD)',
    ref: { kind: 'commit', name: at },
    note: 'this commit · detached HEAD',
    target: { kind: 'commit', sha: commit.sha },
    what: `Detaches HEAD at ${at}: ${DETACHED}`,
    ...(head.branch === null && head.head === commit.sha ? { disabled: 'checked out' } : {}),
  });
  return choices;
}

/** What happens to local changes, or why no checkout can run now; null with neither. */
export function changesNote({ changed, operation }: WorkingState): string | null {
  if (operation) return `A ${operation} is in progress: finish or abort it first.`;
  if (changed === 0) return null;
  const [files, have, they, them] =
    changed === 1 ? ['file', 'has', 'it comes', 'it'] : ['files', 'have', 'they come', 'them'];
  return (
    `${changed} ${files} ${have} uncommitted changes: ${they} along, unless the target changes ` +
    `${them} too — then git refuses and nothing changes.`
  );
}

/** The line shown after a checkout. */
export function checkedOut(result: CheckoutResult, remote?: string): string {
  if (result.created && result.branch) {
    return `Created the branch ${result.branch}, tracking ${remote}, and switched to it`;
  }
  if (result.branch) return `Switched to branch ${result.branch}`;
  return `HEAD is now at ${shortSha(result.head)} (detached)`;
}
