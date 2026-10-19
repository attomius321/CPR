// The git steps of CPR's merger (V26a): a merge made in a worktree of CPR's own, then landed by
// fast-forward. Never forced: what git refuses is a `MergeStepRefused` in git's words.
import { existsSync } from 'node:fs';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { git, GitError } from './exec.js';
import type { GitRepo } from './repo.js';

/** git refused a step; the message is git's. */
export class MergeStepRefused extends Error {
  override name = 'MergeStepRefused';
}

/** git's own message, without its `fatal: ` or `error: ` prefixes. */
function words(error: GitError): string {
  return error.stderr.trim().replace(/^(fatal|error): /gm, '') || error.message;
}

/** Whether `folder` is a worktree of `repo` (its own top level, sharing its git directory). */
async function isWorktreeOf(repo: GitRepo, folder: string): Promise<boolean> {
  if (!existsSync(folder)) return false;
  try {
    const [top, common] = (
      await git(folder, [
        'rev-parse',
        '--path-format=absolute',
        '--show-toplevel',
        '--git-common-dir',
      ])
    )
      .trimEnd()
      .split('\n');
    return (
      top !== undefined &&
      common !== undefined &&
      (await realpath(top)) === (await realpath(folder)) &&
      (await realpath(common)) === repo.commonDir
    );
  } catch {
    return false;
  }
}

/**
 * CPR's merge worktree at `folder`, detached at `sha` with nothing else in it: a merge left
 * half-done aborted, changes and untracked files removed. Ignored files (installed dependencies,
 * build output) are kept, so the next check does not start from nothing.
 */
export async function resetMergeWorktree(
  repo: GitRepo,
  folder: string,
  sha: string,
): Promise<void> {
  if (await isWorktreeOf(repo, folder)) {
    await git(folder, ['merge', '--abort']).catch(() => undefined);
    await git(folder, ['reset', '--quiet', '--hard']);
    await git(folder, ['clean', '-d', '--force', '--quiet']);
    await git(folder, ['checkout', '--quiet', '--force', '--detach', sha]);
    return;
  }
  // Missing or broken: added again. --force replaces a stale registration of this path only.
  await rm(folder, { recursive: true, force: true });
  await mkdir(dirname(folder), { recursive: true });
  await git(repo.root, ['worktree', 'add', '--quiet', '--force', '--detach', folder, sha]);
}

/** How a merge in the merge worktree went. */
export type MergeOutcome =
  | { merged: string }
  /** `head` is already in the tip: nothing to merge. */
  | { upToDate: true }
  | { conflicts: string[] }
  | { error: string };

/**
 * `git merge --no-ff -m <message> <head>` in the merge worktree, at its HEAD. A conflict is
 * aborted, its paths named: the worktree is left as it was.
 */
export async function mergeInWorktree(
  folder: string,
  head: string,
  message: string,
): Promise<MergeOutcome> {
  const before = (await git(folder, ['rev-parse', 'HEAD'])).trim();
  try {
    await git(folder, ['merge', '--no-ff', '--no-edit', '--quiet', '-m', message, head]);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    const unmerged = await git(folder, ['diff', '--name-only', '-z', '--diff-filter=U']).catch(
      () => '',
    );
    await git(folder, ['merge', '--abort']).catch(() => undefined);
    const conflicts = [...new Set(unmerged.split('\0').filter((p) => p !== ''))].sort();
    return conflicts.length > 0 ? { conflicts } : { error: words(error) };
  }
  const after = (await git(folder, ['rev-parse', 'HEAD'])).trim();
  return after === before ? { upToDate: true } : { merged: after };
}

/**
 * Moves the branch `branch` to `to`, a commit that holds its tip. Checked out in a worktree
 * (`checkedOut`): `git merge --ff-only` there, which moves its files with it and which git
 * refuses when local changes would be overwritten. Checked out nowhere: `git update-ref` from
 * `from`, refused if the branch moved meanwhile; `from` null makes the branch, refused if it
 * exists.
 */
export async function fastForwardBranch(
  repo: GitRepo,
  {
    branch,
    to,
    from,
    checkedOut,
  }: { branch: string; to: string; from: string | null; checkedOut?: string },
): Promise<void> {
  try {
    if (checkedOut) {
      await git(checkedOut, ['merge', '--ff-only', '--quiet', to]);
    } else {
      await git(repo.root, [
        'update-ref',
        '-m',
        `cpr merge: fast-forward to ${to.slice(0, 7)}`,
        `refs/heads/${branch}`,
        to,
        from ?? '',
      ]);
    }
  } catch (error) {
    if (error instanceof GitError) throw new MergeStepRefused(words(error));
    throw error;
  }
}

/** `git push <remote> <sha>:refs/heads/<branch>`; git's words when it fails. */
export async function pushCommit(
  repo: GitRepo,
  { remote, sha, branch }: { remote: string; sha: string; branch: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await git(repo.root, ['push', '--quiet', remote, `${sha}:refs/heads/${branch}`]);
    return { ok: true };
  } catch (error) {
    if (error instanceof GitError) return { ok: false, error: words(error) };
    throw error;
  }
}

/** A commit's subject. */
export async function commitSubject(repo: GitRepo, sha: string): Promise<string> {
  return (await git(repo.root, ['log', '-1', '--format=%s', sha])).trim();
}
