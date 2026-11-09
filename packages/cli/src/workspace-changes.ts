// A workspace's changes (V29d): its branch's commits and files since the fork point, and its
// worktree's files not committed.
import { existsSync } from 'node:fs';
import {
  checkMerge,
  isCommit,
  listRefs,
  type BranchMerge,
  commitDetails,
  commitLineCounts,
  commitsBetween,
  listChangedFiles,
  listLineCounts,
  worktreeStatus,
  type GitRepo,
  type WorkspaceChanges,
  type WorkspaceFileChange,
} from '@symbiote/core';
import {
  readRecord,
  WorkspaceRefused,
  writeRecord,
  type WorkspaceFile,
} from './workspace-record.js';
import { hasBranch } from './review-base.js';
import type { Workspaces, WorkspacesContext } from './workspace-context.js';
import { againstOf, type WorkspaceTrunk } from './workspace-trunk.js';

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
  const [commits, perCommit] = await Promise.all([
    commitDetails(repo, between.shas),
    commitLineCounts(repo, between.shas),
  ]);
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
      listed: commits.map(({ sha, subject, author, date }) => ({
        sha,
        subject,
        author,
        date,
        ...perCommit.get(sha),
      })),
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

/** A workspace's changes as its tabs read them, its merge preview, what it is reviewed against. */
export function workspaceChanges(
  { place, repo }: Pick<WorkspacesContext, 'place' | 'repo'>,
  { baseOf, changesBase, endedAt }: Pick<WorkspaceTrunk, 'baseOf' | 'changesBase' | 'endedAt'>,
) {
  /** Merge checks by the default branch's tip and the workspace's: they take seconds on some. */
  const merges = new Map<string, Promise<BranchMerge>>();

  /** Each branch's commits and files, for the base and tip they were read at (V29d). */
  const branchChanges = new Map<
    string,
    { key: string; read: Promise<Pick<WorkspaceChanges, 'commits' | 'files'>> }
  >();

  const ops: Pick<Workspaces, 'changes' | 'merge' | 'against' | 'setAgainst'> = {
    async changes(branch) {
      const where = await place();
      const workspace = await readRecord(where, branch);
      const refs = await listRefs(repo);
      // A finished workspace's branch may be gone: where it ended (V77, decision 565).
      const tip = workspace.finished
        ? ((await endedAt(where, workspace, refs, null)).end ?? null)
        : (refs.branches.find((b) => b.name === workspace.branch)?.sha ?? null);
      const uncommitted =
        !workspace.finished && existsSync(workspace.worktree)
          ? await worktreeChanges(repo, workspace.worktree)
          : null;
      const none = {
        commits: { count: 0, listed: [] },
        files: { count: 0, added: 0, removed: 0, listed: [] },
      };
      if (!tip || !(await isCommit(repo, workspace.base))) {
        return { branch, base: workspace.base, tip, ...none, uncommitted };
      }
      const from = await changesBase(workspace, refs, tip);
      const key = `${from.base}:${tip}`;
      let kept = branchChanges.get(branch);
      if (kept?.key !== key) {
        kept = { key, read: readBranchChanges(repo, from.base, tip) };
        branchChanges.set(branch, kept);
        kept.read.catch(() => branchChanges.delete(branch));
      }
      return { branch, ...from, tip, ...(await kept.read), uncommitted };
    },

    async merge(branch) {
      const workspace = await readRecord(await place(), branch);
      const refs = await listRefs(repo);
      const tip = refs.branches.find((b) => b.name === workspace.branch)?.sha;
      if (!tip) throw new WorkspaceRefused(`its branch ${workspace.branch} is gone`, 409);
      // The branch it is reviewed against (V65), as an approval names it.
      const into = (await baseOf(workspace, refs, tip))?.into;
      if (!into) return { into: '', error: 'no default branch to merge into' };
      // The local branch, where the merge is made; else a remote's.
      const target =
        refs.branches.find((b) => b.name === into) ?? refs.remotes.find((r) => r.branch === into);
      if (!target) return { into, error: `no branch ${into}` };
      const key = `${target.sha}:${tip}`;
      let check = merges.get(key);
      if (!check) {
        check = checkMerge(repo, target.sha, tip).then((result) => ({ into, ...result }));
        merges.set(key, check);
      }
      return check;
    },

    async against(branch) {
      return againstOf(await readRecord(await place(), branch), await listRefs(repo));
    },

    async setAgainst(branch, against) {
      const where = await place();
      const workspace = await readRecord(where, branch);
      const refs = await listRefs(repo);
      if (against === workspace.branch) {
        throw new WorkspaceRefused(`${against} is its own branch: pick another`, 400);
      }
      if (against !== null && !hasBranch(refs, against)) {
        throw new WorkspaceRefused(`no branch ${against}`, 400);
      }
      const next: WorkspaceFile = { ...workspace };
      if (against === null) delete next.against;
      else next.against = against;
      await writeRecord(where, next);
      return againstOf(next, refs);
    },
  };
  return { ops };
}
