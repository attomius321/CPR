import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { git, GitError } from './exec.js';
import { historyState, isCommit, type HistoryState } from './log.js';
import { listRefs, type RefList } from './refs.js';
import type { GitRepo } from './repo.js';

/** What to check out: a branch, a remote branch (as its local branch), a tag or a commit. */
export type CheckoutTarget =
  { kind: 'branch' | 'remote' | 'tag'; name: string } | { kind: 'commit'; sha: string };

export interface CheckoutResult {
  /** The branch checked out; null for a detached HEAD. */
  branch: string | null;
  head: string;
  /** A local branch was created to track the remote branch. */
  created?: true;
  /** Checked out, but git said something went wrong after (a failing post-checkout hook). */
  warning?: string;
}

/** An operation git is in the middle of, which a checkout would leave half done. */
export type Operation = 'merge' | 'rebase' | 'am' | 'cherry-pick' | 'revert' | 'bisect';

export interface WorkingState {
  /** Tracked files with local changes (staged or not). */
  changed: number;
  operation: Operation | null;
}

/** What the commits page shows of the repository (`GET /api/status`). */
export type RepoStatus = HistoryState & WorkingState;

/** The target names no branch, tag or commit of the repository. */
export class UnknownCheckoutTarget extends Error {
  override name = 'UnknownCheckoutTarget';
}

/** Git (or Symbiote, for an operation in progress) refused the checkout; nothing changed. */
export class CheckoutRefused extends Error {
  override name = 'CheckoutRefused';
}

/** Local changes and the operation in progress, for a checkout's confirmation. */
export async function workingState(repo: GitRepo): Promise<WorkingState> {
  const [status, gitDir] = await Promise.all([
    git(repo.root, ['status', '--porcelain=v2', '--untracked-files=no']),
    git(repo.root, ['rev-parse', '--absolute-git-dir']),
  ]);
  return {
    changed: status.split('\n').filter((line) => line !== '').length,
    operation: operationIn(gitDir.trim()),
  };
}

/** The operation whose files sit in this worktree's own git dir. */
function operationIn(dir: string): Operation | null {
  const has = (name: string) => existsSync(join(dir, name));
  if (has('rebase-merge')) return 'rebase';
  if (has('rebase-apply')) return has('rebase-apply/applying') ? 'am' : 'rebase';
  if (has('MERGE_HEAD')) return 'merge';
  if (has('CHERRY_PICK_HEAD')) return 'cherry-pick';
  if (has('REVERT_HEAD')) return 'revert';
  if (has('BISECT_LOG')) return 'bisect';
  return null;
}

/**
 * Checks out a branch, a remote branch (its local tracking branch, created if absent), a tag or
 * a commit (both detached), with `git switch` and never forced: local changes come along
 * unless the target changes them too, and then git refuses and nothing changes (V11). Names
 * must be the repository's own, exactly; refused during a merge, rebase and the like.
 */
export async function checkout(repo: GitRepo, target: CheckoutTarget): Promise<CheckoutResult> {
  const { args, created } = await switchArgs(repo, target, await listRefs(repo));
  const { operation } = await workingState(repo);
  if (operation)
    throw new CheckoutRefused(`a ${operation} is in progress: finish or abort it first`);
  const before = await historyState(repo);
  let warning: string | undefined;
  try {
    await git(repo.root, ['switch', ...args]);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    const after = await historyState(repo);
    // A post-checkout hook's failure is git's exit status, after HEAD moved.
    if (after.head === before.head && after.branch === before.branch) {
      throw new CheckoutRefused(error.stderr.trim(), { cause: error });
    }
    warning = error.stderr.trim();
  }
  const { branch, head } = await historyState(repo);
  if (head === null) throw new Error('no HEAD after a checkout');
  return { branch, head, ...(created ? { created } : {}), ...(warning ? { warning } : {}) };
}

async function switchArgs(
  repo: GitRepo,
  target: CheckoutTarget,
  refs: RefList,
): Promise<{ args: string[]; created?: true }> {
  const unknown = () =>
    new UnknownCheckoutTarget(
      `no ${target.kind} ${target.kind === 'commit' ? target.sha : target.name}`,
    );
  if (target.kind === 'commit') {
    if (!(await isCommit(repo, target.sha))) throw unknown();
    return { args: ['--detach', target.sha] };
  }
  // Names as the repository lists them; never one git could read as an option.
  if (target.name.startsWith('-')) throw unknown();
  if (target.kind === 'branch') {
    if (!refs.branches.some((b) => b.name === target.name)) throw unknown();
    return { args: ['--no-guess', target.name] };
  }
  if (target.kind === 'tag') {
    const tag = refs.tags.find((t) => t.name === target.name);
    if (!tag) throw unknown();
    return { args: ['--detach', tag.sha] };
  }
  const remote = refs.remotes.find((r) => r.name === target.name);
  if (!remote) throw unknown();
  const local = refs.branches.find((b) => b.name === remote.branch);
  if (!local) {
    return {
      args: ['--create', remote.branch, '--track', `refs/remotes/${remote.name}`],
      created: true,
    };
  }
  if (local.upstream !== remote.name) {
    throw new CheckoutRefused(
      `a local branch ${local.name} exists and does not track ${remote.name}: check it out instead`,
    );
  }
  return { args: ['--no-guess', local.name] };
}
