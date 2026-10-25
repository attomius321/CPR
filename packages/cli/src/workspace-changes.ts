// A workspace's changes (V29d): its branch's commits and files since the fork point, its
// worktree's files not committed, and the two files one of them opens with as a diff (V43).
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  commitDetails,
  commitsBetween,
  fileForCheckout,
  listChangedFiles,
  listLineCounts,
  worktreeStatus,
  type GitRepo,
  type WorkspaceChanges,
  type WorkspaceFileChange,
} from '@symbiote/core';

/** How many commits, and files, a workspace's changes list (V29d). */
const MAX_LISTED_COMMITS = 100;
const MAX_LISTED_FILES = 300;

/** A file's lines as the changes list them: none for a binary file. */
const linesOf = (count: { added: number | null; removed: number | null } | undefined) =>
  count === undefined
    ? {}
    : count.added === null || count.removed === null
      ? { binary: true as const }
      : { added: count.added, removed: count.removed };

/** A branch's commits from `base` to `tip`, and the files they change with their lines. */
export async function readBranchChanges(
  repo: GitRepo,
  base: string,
  tip: string,
): Promise<Pick<WorkspaceChanges, 'commits' | 'files'>> {
  const [between, changed, counts] = await Promise.all([
    commitsBetween(repo, base, tip, MAX_LISTED_COMMITS),
    listChangedFiles(repo, base, tip),
    listLineCounts(repo, base, tip),
  ]);
  const commits = await commitDetails(repo, between.shas);
  const lines = new Map(counts.map((count) => [count.path, count]));
  let added = 0;
  let removed = 0;
  for (const count of counts) {
    added += count.added ?? 0;
    removed += count.removed ?? 0;
  }
  return {
    commits: {
      count: between.count,
      listed: commits.map(({ sha, subject, author, date }) => ({ sha, subject, author, date })),
    },
    files: {
      count: changed.length,
      added,
      removed,
      listed: changed
        .slice(0, MAX_LISTED_FILES)
        .map(({ status, path, previousPath }): WorkspaceFileChange => ({
          status,
          path,
          ...(previousPath ? { previousPath } : {}),
          ...linesOf(lines.get(path)),
        })),
    },
  };
}

/** The files a worktree has not committed, with the lines of those git tracks. */
export async function worktreeChanges(
  repo: GitRepo,
  folder: string,
): Promise<WorkspaceChanges['uncommitted']> {
  const worktree = { ...repo, root: folder };
  const [files, counts] = await Promise.all([
    worktreeStatus(folder),
    listLineCounts(worktree, 'HEAD').catch(() => []),
  ]);
  const lines = new Map(counts.map((count) => [count.path, count]));
  return {
    count: files.length,
    listed: files.slice(0, MAX_LISTED_FILES).map(({ status, path, previousPath }) => ({
      status,
      path,
      ...(previousPath ? { previousPath } : {}),
      ...(status === 'untracked' ? {} : linesOf(lines.get(path))),
    })),
  };
}

/**
 * A commit's file kept for a diff (V43): written the first time, as a checkout in `checkout`
 * writes it, and read-only; null when the commit has no file there.
 */
export async function keptFile(
  revisions: string,
  checkout: GitRepo,
  sha: string,
  path: string,
): Promise<string | null> {
  const file = join(revisions, sha, ...path.split('/'));
  if (existsSync(file)) return file;
  const bytes = await fileForCheckout(checkout, sha, path);
  return bytes && keep(file, bytes);
}

/** An empty file by that name: the side of a diff with no file. */
export const emptyFile = (revisions: string, path: string) =>
  keep(join(revisions, 'empty', ...path.split('/')), new Uint8Array());

/** Writes a read-only file once: to a name of its own, then renamed (two clicks at once). */
async function keep(file: string, bytes: Uint8Array): Promise<string> {
  if (existsSync(file)) return file;
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(4).toString('hex')}`;
  await writeFile(temporary, bytes, { mode: 0o444 });
  try {
    await rename(temporary, file);
  } catch (error) {
    // Windows does not rename onto a file: the other click's copy is the same.
    await rm(temporary, { force: true });
    if (!existsSync(file)) throw error;
  }
  return file;
}

/** Whether `path` is a file. */
export const isFile = (path: string) =>
  stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
