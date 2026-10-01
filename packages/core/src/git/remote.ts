import { CprError } from '../errors.js';
import { git, GitError } from './exec.js';
import type { GitRepo } from './repo.js';

/** A remote's configured URL, as written in the config (before `insteadOf` rewriting). */
export async function remoteUrl(repo: GitRepo, remote: string): Promise<string> {
  try {
    return (await git(repo.root, ['config', '--get', `remote.${remote}.url`])).trim();
  } catch (error) {
    if (error instanceof GitError)
      throw new CprError(`no git remote named '${remote}'`, { cause: error });
    throw error;
  }
}

/**
 * Fetches refs from a remote into local refs (`<src>:<dst>` pairs, forced), without tags.
 * Used to bring pull/merge request heads into the repository.
 */
export async function fetchRefs(
  repo: GitRepo,
  remote: string,
  refspecs: readonly { from: string; to: string }[],
): Promise<void> {
  try {
    await git(repo.root, [
      'fetch',
      '--quiet',
      '--no-tags',
      '--end-of-options',
      remote,
      ...refspecs.map(({ from, to }) => `+${from}:${to}`),
    ]);
  } catch (error) {
    if (error instanceof GitError) {
      throw new CprError(`could not fetch from '${remote}': ${error.stderr.trim()}`, {
        cause: error,
      });
    }
    throw error;
  }
}
