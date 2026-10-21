import { SymbioteError } from '../errors.js';
import { git, GitError } from './exec.js';
import type { GitRepo } from './repo.js';

/** A file's content at a commit (`git show <sha>:<path>`). */
export async function readFileAtRevision(
  repo: GitRepo,
  sha: string,
  path: string,
): Promise<string> {
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new SymbioteError(`not a commit SHA: ${sha}`);
  try {
    return await git(repo.root, ['show', `${sha}:${path}`]);
  } catch (error) {
    if (error instanceof GitError)
      throw new SymbioteError(`${path} does not exist at ${sha.slice(0, 7)}`, { cause: error });
    throw error;
  }
}

/**
 * The names at a commit's root, or of the given paths that exist there (`git ls-tree
 * --name-only`); a folder's name, not its files.
 */
export async function listTreeAt(
  repo: GitRepo,
  sha: string,
  paths: readonly string[] = [],
): Promise<string[]> {
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new SymbioteError(`not a commit SHA: ${sha}`);
  const out = await git(repo.root, ['ls-tree', '--name-only', sha, '--', ...paths]);
  return out.split('\n').filter((name) => name !== '');
}
