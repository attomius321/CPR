import { CprError } from '../errors.js';
import { git, GitError } from './exec.js';
import type { GitRepo } from './repo.js';

export interface ResolvedRevisions {
  base: { ref: string; sha: string; mergeBase: string | null };
  head: { ref: string; sha: string };
  /** The commit head is compared against: the merge-base, or base itself when merge-base is off. */
  from: string;
}

export interface ResolveOptions {
  /** Compare against `merge-base(base, head)`, like a GitHub PR. Default: true. */
  mergeBase?: boolean;
}

export class NoMergeBaseError extends CprError {
  override name = 'NoMergeBaseError';
}

export async function resolveRevisions(
  repo: GitRepo,
  baseRef: string,
  headRef: string,
  { mergeBase = true }: ResolveOptions = {},
): Promise<ResolvedRevisions> {
  const [baseSha, headSha] = await Promise.all([
    resolveCommit(repo, baseRef),
    resolveCommit(repo, headRef),
  ]);

  let base: string | null = null;
  if (mergeBase) {
    try {
      base = (await git(repo.root, ['merge-base', baseSha, headSha])).trim();
    } catch (error) {
      if (error instanceof GitError && error.exitCode === 1) {
        throw new NoMergeBaseError(`'${baseRef}' and '${headRef}' have no common ancestor`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  return {
    base: { ref: baseRef, sha: baseSha, mergeBase: base },
    head: { ref: headRef, sha: headSha },
    from: base ?? baseSha,
  };
}

/** Resolves a ref to a commit SHA. Refs can never be read as git options. */
export async function resolveCommit(repo: GitRepo, ref: string): Promise<string> {
  try {
    const output = await git(repo.root, [
      'rev-parse',
      '--verify',
      '--quiet',
      '--end-of-options',
      `${ref}^{commit}`,
    ]);
    return output.trim();
  } catch (error) {
    if (error instanceof GitError)
      throw new CprError(`unknown revision '${ref}'`, { cause: error });
    throw error;
  }
}
