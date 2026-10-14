import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { git, GitError } from './exec.js';
import { listRefs, type RefList } from './refs.js';
import type { GitRepo } from './repo.js';

/** A working tree of the repository, as `git worktree list` gives it. */
export interface Worktree {
  path: string;
  /** Its HEAD; null in a repository without commits. */
  head: string | null;
  /** The branch checked out, without `refs/heads/`. */
  branch?: string;
  detached?: boolean;
  bare?: boolean;
  locked?: boolean;
  /** Its folder is gone: `git worktree prune` would forget it. */
  prunable?: boolean;
}

/** git refused to make or remove a worktree; the message is git's, or says why it was not asked. */
export class WorktreeRefused extends Error {
  override name = 'WorktreeRefused';
}

const FULL_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** The repository's working trees, the main one first (`git worktree list --porcelain`). */
export async function listWorktrees(repo: GitRepo): Promise<Worktree[]> {
  const output = await git(repo.root, ['worktree', 'list', '--porcelain', '-z']);
  const list: Worktree[] = [];
  let current: Worktree | null = null;
  for (const line of output.split('\0')) {
    if (line === '') {
      if (current) list.push(current);
      current = null;
      continue;
    }
    const space = line.indexOf(' ');
    const [key, value] = space < 0 ? [line, ''] : [line.slice(0, space), line.slice(space + 1)];
    if (key === 'worktree') current = { path: value, head: null };
    else if (!current) continue;
    else if (key === 'HEAD') current.head = /^0+$/.test(value) ? null : value;
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'detached') current.detached = true;
    else if (key === 'bare') current.bare = true;
    else if (key === 'locked') current.locked = true;
    else if (key === 'prunable') current.prunable = true;
  }
  if (current) list.push(current);
  return list;
}

/**
 * The main working tree's root, which linked worktrees share their git directory with: what
 * belongs to the repository rather than to one checkout (V18: `cpr/`) lives there. The working
 * tree itself when the repository is bare or its git directory is not a `.git` folder.
 */
export function mainWorktree(repo: GitRepo): string {
  return basename(repo.commonDir) === '.git' ? dirname(repo.commonDir) : repo.root;
}

/** Why `name` cannot be a new branch (invalid, or taken here or on a remote); null when it can. */
export async function branchNameProblem(
  repo: GitRepo,
  name: string,
  refs?: RefList,
): Promise<string | null> {
  if (name === '') return 'a branch needs a name';
  if (name.startsWith('-')) return 'a branch name cannot start with -';
  try {
    await git(repo.root, ['check-ref-format', '--branch', name]);
  } catch (error) {
    if (error instanceof GitError) return `not a valid branch name: ${name}`;
    throw error;
  }
  const { branches, remotes } = refs ?? (await listRefs(repo));
  if (branches.some((b) => b.name === name)) return `a branch ${name} exists`;
  const remote = remotes.find((r) => r.branch === name);
  return remote ? `${remote.remote} has a branch ${name}` : null;
}

/**
 * Creates `branch` at `base` (a full SHA) and checks it out in a new worktree at `folder`, in
 * one `git worktree add -b`. Never forced: an existing branch or folder is refused, as are a
 * name git refuses and a base that is not a commit; the checkout `repo` is in is not touched.
 */
export async function addWorktree(
  repo: GitRepo,
  { folder, branch, base }: { folder: string; branch: string; base: string },
): Promise<Worktree> {
  if (!FULL_SHA.test(base)) throw new WorktreeRefused(`the base must be a full SHA: ${base}`);
  if (branch === '' || branch.startsWith('-')) {
    throw new WorktreeRefused(`not a valid branch name: ${branch}`);
  }
  if (existsSync(folder)) throw new WorktreeRefused(`${folder} exists`);
  try {
    await git(repo.root, ['cat-file', '-e', `${base}^{commit}`]);
  } catch (error) {
    if (error instanceof GitError) throw new WorktreeRefused(`not a commit: ${base}`);
    throw error;
  }
  try {
    await git(repo.root, ['worktree', 'add', '--quiet', '-b', branch, folder, base]);
  } catch (error) {
    if (error instanceof GitError) throw new WorktreeRefused(gitWords(error));
    throw error;
  }
  return { path: folder, head: base, branch };
}

/** git's own message, without its `fatal: ` prefix. */
function gitWords(error: GitError): string {
  return error.stderr.trim().replace(/^(fatal|error): /gm, '') || error.message;
}
