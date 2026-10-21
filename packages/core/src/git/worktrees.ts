import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { FileChangeStatus } from './changed-files.js';
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
 * belongs to the repository rather than to one checkout (V18: `symbiote/`) lives there. The working
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

/**
 * Removes the worktree at `folder` (`git worktree remove`), its branch kept. Never forced: git
 * refuses one with changes or untracked files, and that refusal is a `WorktreeRefused` in git's
 * words.
 */
export async function removeWorktree(repo: GitRepo, folder: string): Promise<void> {
  try {
    await git(repo.root, ['worktree', 'remove', folder]);
  } catch (error) {
    if (error instanceof GitError) throw new WorktreeRefused(gitWords(error));
    throw error;
  }
}

/**
 * Deletes `branch` only if it is merged (`git branch -d`, never `-D`): git refuses an unmerged
 * one, and that refusal is a `WorktreeRefused` in git's words.
 */
export async function deleteMergedBranch(repo: GitRepo, branch: string): Promise<void> {
  if (branch === '' || branch.startsWith('-')) {
    throw new WorktreeRefused(`not a valid branch name: ${branch}`);
  }
  try {
    await git(repo.root, ['branch', '-d', branch]);
  } catch (error) {
    if (error instanceof GitError) throw new WorktreeRefused(gitWords(error));
    throw error;
  }
}

/** git's own message, without its `fatal: ` prefix. */
function gitWords(error: GitError): string {
  return error.stderr.trim().replace(/^(fatal|error): /gm, '') || error.message;
}

/**
 * How many files in the working tree at `folder` are not committed: changed, staged or new,
 * each file of a new folder counted, ignored ones not (`git status --porcelain`).
 */
export async function uncommittedFiles(folder: string): Promise<number> {
  const output = await git(folder, ['status', '--porcelain', '-z', '--untracked-files=all']);
  let count = 0;
  const entries = output.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? '';
    if (entry === '') continue;
    count++;
    // A rename or copy names its source in the next entry.
    if (/^[RC]/.test(entry)) i++;
  }
  return count;
}

/** How a file in a working tree differs from its last commit (V29d), `git status`'s two letters in a word. */
export type WorktreeFileStatus = FileChangeStatus | 'untracked' | 'conflicted';

/** A file not committed in a working tree. */
export interface WorktreeFile {
  status: WorktreeFileStatus;
  /** Path from the working tree's root, POSIX. */
  path: string;
  /** Before a rename or copy staged. */
  previousPath?: string;
}

/**
 * The files not committed in the working tree at `folder`, as `uncommittedFiles` counts them:
 * changed, staged or new, each file of a new folder listed, ignored ones not.
 */
export async function worktreeStatus(folder: string): Promise<WorktreeFile[]> {
  return parseWorktreeStatus(
    await git(folder, ['status', '--porcelain', '-z', '--untracked-files=all']),
  );
}

/**
 * Parses `git status --porcelain -z`: `XY <path>\0`, a rename or copy followed by the path it
 * came from. A file gone from the disk is deleted whatever was staged; both sides changing it in a
 * merge is a conflict.
 */
export function parseWorktreeStatus(output: string): WorktreeFile[] {
  const entries = output.split('\0');
  const files: WorktreeFile[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? '';
    if (entry === '') continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    const previousPath = /[RC]/.test(xy) ? entries[++i] : undefined;
    files.push({ status: statusOf(xy), path, ...(previousPath ? { previousPath } : {}) });
  }
  return files;
}

function statusOf(xy: string): WorktreeFileStatus {
  if (xy === '??') return 'untracked';
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'conflicted';
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('R')) return 'renamed';
  if (xy.includes('C')) return 'copied';
  if (xy.startsWith('A')) return 'added';
  if (xy.includes('T')) return 'type-changed';
  return 'modified';
}

/**
 * The folders a commit on `branch` in the worktree at `folder` writes to (V20a): the worktree's
 * own git folder (index, HEAD, its reflog), the shared `objects`, and the folders holding the
 * branch's ref and reflog, those that exist. What Codex's sandbox must let it write to commit
 * there, and nothing more: other branches' refs, `config` and hooks are not in it.
 */
export async function commitFolders(folder: string, branch: string): Promise<string[]> {
  const [gitDir = '', commonDir = ''] = (
    await git(folder, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])
  )
    .trimEnd()
    .split('\n');
  const common = await realpath(commonDir);
  const refFolder = dirname(join('refs', 'heads', ...branch.split('/')));
  return [
    await realpath(gitDir),
    join(common, 'objects'),
    join(common, refFolder),
    join(common, 'logs', refFolder),
  ].filter((path, i) => i < 2 || existsSync(path));
}
