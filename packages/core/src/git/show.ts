import { SymbioteError } from '../errors.js';
import { git, gitBytes, GitError } from './exec.js';
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

/**
 * A file's bytes at a commit as a checkout at `repo.root` writes them (V43): `git cat-file
 * --filters`, with that checkout's line endings and smudge filters (LFS); a submodule as `git
 * diff` shows it. Null when the commit has no file at `path`.
 */
export async function fileForCheckout(
  repo: GitRepo,
  sha: string,
  path: string,
): Promise<Buffer | null> {
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new SymbioteError(`not a commit SHA: ${sha}`);
  // `<mode> <type> <object>\t<path>\0`; ls-tree's paths are patterns: the exact one is taken.
  const listed = await git(repo.root, ['ls-tree', '-z', '--full-tree', sha, '--', path]);
  const entry = listed
    .split('\0')
    .map((line) => /^\d+ (\w+) ([0-9a-f]+)\t(.*)$/s.exec(line))
    .find((match) => match?.[3] === path);
  if (!entry) return null;
  const [, type, object] = entry;
  if (type === 'commit') return Buffer.from(`Subproject commit ${object}\n`);
  if (type !== 'blob') return null;
  return gitBytes(repo.root, ['cat-file', '--filters', `${sha}:${path}`]);
}

/** A path's entry in the index (V70): its object, and its bytes as a checkout writes them. */
export interface IndexFile {
  object: string;
  read(): Promise<Buffer>;
}

/**
 * The index's file at `path` (a staged change's right side, a change not staged's left), or null
 * when the index has none there, or only a conflict's stages. Its bytes as `fileForCheckout`'s.
 */
export async function fileInIndex(repo: GitRepo, path: string): Promise<IndexFile | null> {
  // `<mode> <object> <stage>\t<path>\0`; a literal pathspec, so `*` is a name.
  const listed = await git(repo.root, ['ls-files', '-s', '-z', '--', `:(top,literal)${path}`]);
  const entry = listed
    .split('\0')
    .map((line) => /^(\d+) ([0-9a-f]+) 0\t(.*)$/s.exec(line))
    .find((match) => match?.[3] === path);
  if (!entry) return null;
  const [, mode, object = ''] = entry;
  if (mode === '160000') {
    return { object, read: () => Promise.resolve(Buffer.from(`Subproject commit ${object}\n`)) };
  }
  return {
    object,
    read: () => gitBytes(repo.root, ['cat-file', '--filters', `--path=${path}`, object]),
  };
}
