// A workspace's changes (V29d): its branch's commits and files since the fork point, and its
// worktree's files not committed.
import {
  commitDetails,
  commitsBetween,
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
