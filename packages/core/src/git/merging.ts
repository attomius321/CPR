// The git steps of Symbiote's merger (V26a): a merge made in a worktree of Symbiote's own, then landed by
// fast-forward. Never forced: what git refuses is a `MergeStepRefused` in git's words.
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
 * Symbiote's merge worktree at `folder`, detached at `sha` with nothing else in it: a merge left
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
 * aborted, its paths named, and the worktree left as it was; with `keep`, the conflict stays in
 * the files (V26c), to resolve or abort.
 */
export async function mergeInWorktree(
  folder: string,
  head: string,
  message: string,
  { keep = false }: { keep?: boolean } = {},
): Promise<MergeOutcome> {
  const before = (await git(folder, ['rev-parse', 'HEAD'])).trim();
  try {
    // diff3: each region shows the ancestor too, for whoever resolves it.
    await git(folder, [
      '-c',
      'merge.conflictStyle=diff3',
      'merge',
      '--no-ff',
      '--no-edit',
      '--quiet',
      '-m',
      message,
      head,
    ]);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    const unmerged = await git(folder, ['diff', '--name-only', '-z', '--diff-filter=U']).catch(
      () => '',
    );
    if (!keep || unmerged === '') await git(folder, ['merge', '--abort']).catch(() => undefined);
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
        `symbiote merge: fast-forward to ${to.slice(0, 7)}`,
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

/** Why a conflicting path can or cannot be resolved as text (V26c). */
export type ConflictKind = 'text' | 'deleted' | 'submodule' | 'binary';

/**
 * Each conflicting path of the merge in progress in `folder` and its kind: deleted on one side
 * (a stage missing), a submodule pointer (mode 160000), binary (no markers written), else text.
 */
export async function conflictKinds(folder: string): Promise<Map<string, ConflictKind>> {
  const output = await git(folder, ['ls-files', '--unmerged', '-z']);
  const stages = new Map<string, { stages: Set<string>; submodule: boolean }>();
  for (const entry of output.split('\0')) {
    // `<mode> <sha> <stage>\t<path>`
    const match = /^(\d+) [0-9a-f]+ (\d)\t(.*)$/s.exec(entry);
    if (!match) continue;
    const [, mode = '', stage = '', path = ''] = match;
    const seen = stages.get(path) ?? { stages: new Set<string>(), submodule: false };
    seen.stages.add(stage);
    if (mode === '160000') seen.submodule = true;
    stages.set(path, seen);
  }
  const kinds = new Map<string, ConflictKind>();
  for (const [path, seen] of stages) {
    if (seen.submodule) kinds.set(path, 'submodule');
    else if (!seen.stages.has('2') || !seen.stages.has('3')) kinds.set(path, 'deleted');
    else {
      const text = await readFile(join(folder, path), 'utf8').catch(() => '');
      kinds.set(path, /^<<<<<<< /m.test(text) && /^>>>>>>> /m.test(text) ? 'text' : 'binary');
    }
  }
  return kinds;
}

/** Aborts the merge in progress in `folder`, if any. */
export async function abortMerge(folder: string): Promise<void> {
  await git(folder, ['merge', '--abort']).catch(() => undefined);
}

/**
 * Commits the merge in progress in `folder` once `paths` are resolved in place: they are
 * staged, nothing may be left unmerged, and the merge commit gets `message`. Its SHA.
 */
export async function commitResolution(
  folder: string,
  paths: readonly string[],
  message: string,
): Promise<string> {
  try {
    await git(folder, ['add', '--', ...paths]);
    const left = await git(folder, ['diff', '--name-only', '--diff-filter=U']);
    if (left.trim() !== '') throw new MergeStepRefused(`still unmerged: ${left.trim()}`);
    await git(folder, ['commit', '--quiet', '-m', message]);
  } catch (error) {
    if (error instanceof GitError) throw new MergeStepRefused(words(error));
    throw error;
  }
  return (await git(folder, ['rev-parse', 'HEAD'])).trim();
}
