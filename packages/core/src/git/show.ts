import { CprError } from '../errors.js';
import { git, GitError } from './exec.js';
import type { GitRepo } from './repo.js';

/** A file's content at a commit (`git show <sha>:<path>`). */
export async function readFileAtRevision(
  repo: GitRepo,
  sha: string,
  path: string,
): Promise<string> {
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new CprError(`not a commit SHA: ${sha}`);
  try {
    return await git(repo.root, ['show', `${sha}:${path}`]);
  } catch (error) {
    if (error instanceof GitError)
      throw new CprError(`${path} does not exist at ${sha.slice(0, 7)}`, { cause: error });
    throw error;
  }
}
