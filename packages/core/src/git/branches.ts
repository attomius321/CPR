import { git, GitError } from './exec.js';
import { listRefs, type RefList } from './refs.js';
import type { GitRepo } from './repo.js';

/** A ref of a reviewed branch (the local branch or a remote's) and the commits since review. */
export interface BranchReviewRef {
  name: string;
  tip: string;
  /** Commits on the tip since the review's head. */
  since: number;
}

/** A verdict's event: the same three as `symbiote pr`'s. */
export type VerdictEvent = 'comment' | 'approve' | 'request-changes';

/** A comment of a finished review (V16): on a line of one side, or about a symbol. */
export interface VerdictComment {
  id: string;
  symbol: string;
  body: string;
  side?: 'base' | 'head';
  path?: string;
  line?: number;
  /** The line's code: at the reviewed tip (head), or at the fork point (base, removed code). */
  code?: string;
}

/**
 * A finished branch review: the verdict at a tip, with its summary and comments. An approval is
 * metadata (V17): `into` names the branch the agent merges `head` into; Symbiote pushes nothing.
 */
export interface Verdict {
  at: string;
  comments: VerdictComment[];
  event: VerdictEvent;
  /** The tip reviewed. */
  head: string;
  /** Approve: the default branch to merge `head` into; absent on the default branch's own review.
   * */
  into?: string;
  summary: string;
}

/** `POST ./api/review` on a branch review: the verdict, and the drafts as comments. */
export interface LocalReview {
  event: VerdictEvent;
  body: string;
  comments: (Omit<VerdictComment, 'code'> & { otherPath?: string })[];
}

/** What finishing answers: the verdict, and its text for a chat. */
export interface FinishResult {
  verdict: Verdict;
  text: string;
}

/** Whether a merge would go through: clean, the conflicting paths, or why git could not say. */
export type MergeCheck = { clean: true } | { conflicts: string[] } | { error: string };

/** A branch review's merge into the default branch (V17), checked before it is approved. */
export type BranchMerge = { into: string } & MergeCheck;

/** A branch review on the commits page (V15): what it covers, and what came after. */
export interface BranchReviewSummary {
  /** The branch name without a remote. */
  branch: string;
  /** The fork point and the tip last reviewed. */
  base: string;
  head: string;
  updated: string;
  /** Symbols marked reviewed. */
  marks: number;
  refs: BranchReviewRef[];
  /** Commits on any of its refs since the review's head, newest first (at most 100). */
  added: string[];
  /** The last verdict (V16); an approval's `into`, and whether its commit is merged there (V17). */
  verdict?: {
    event: VerdictEvent;
    head: string;
    at: string;
    comments: number;
    into?: string;
    merged: boolean;
  };
}

/** `GET /api/reviews`: the reviewer's branch reviews and where they are kept. */
export interface BranchReviewList {
  /** The branch others branch from: no review of its own. */
  defaultBranch: string | null;
  reviewer: string;
  /** `repository`: `symbiote/reviews/`; `cache`: Symbiote's cache, `note` says why. */
  place: 'repository' | 'cache';
  note?: string;
  reviews: BranchReviewSummary[];
}

/** A branch review being looked at (the review page's header). */
export interface BranchReviewInfo {
  branch: string;
  /** The ref reviewed: the branch, or a remote's (`origin/topic`). */
  ref: string;
  /** The fork point and the tip compared. */
  base: string;
  head: string;
  /** The tip of the last review, or null for a first review. */
  reviewed: string | null;
  /** Commits since the last review; null for a first review. */
  since: number | null;
  /** Why the review is kept in Symbiote's cache, not in `symbiote/reviews/`. */
  note?: string;
  /** The default branch an approval merges into (V17); absent on the default branch itself. */
  into?: string;
  /** The last verdict (V16). */
  verdict?: { event: VerdictEvent; head: string; at: string };
}

/**
 * The branch a repository's work merges into: the branch `origin/HEAD` names (else another
 * remote's HEAD), else `main`, else `master`; null when there is none.
 */
export async function defaultBranch(repo: GitRepo, refs: RefList): Promise<string | null> {
  const remotes = [...new Set(refs.remotes.map((r) => r.remote))].sort((a, b) =>
    a === 'origin' ? -1 : b === 'origin' ? 1 : a.localeCompare(b),
  );
  for (const remote of remotes) {
    try {
      const target = await git(repo.root, [
        'symbolic-ref',
        '--quiet',
        '--short',
        `refs/remotes/${remote}/HEAD`,
      ]);
      const name = target.trim();
      if (name.startsWith(`${remote}/`)) return name.slice(remote.length + 1);
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
    }
  }
  const names = new Set([
    ...refs.branches.map((b) => b.name),
    ...refs.remotes.map((r) => r.branch),
  ]);
  return ['main', 'master'].find((name) => names.has(name)) ?? null;
}

/** The commits `branch` names: the local branch's and each remote's, each once. */
function branchTips(refs: RefList, branch: string): string[] {
  return [
    ...new Set([
      ...refs.branches.filter((b) => b.name === branch).map((b) => b.sha),
      ...refs.remotes.filter((r) => r.branch === branch).map((r) => r.sha),
    ]),
  ];
}

/**
 * The default branch and its tips, the local branch's and each remote's (V10c: the commits page
 * takes a pick on their line as the base); null without a default branch.
 */
export async function defaultBranchTips(
  repo: GitRepo,
): Promise<{ name: string; tips: string[] } | null> {
  const refs = await listRefs(repo);
  const name = await defaultBranch(repo, refs);
  return name === null ? null : { name, tips: branchTips(refs, name) };
}

/**
 * Where `tip` left the branch `branch`: the latest merge-base with its local branch and its
 * remotes' (a stale local `main` must not pull in commits the agent took from `origin/main`).
 * The tip itself once merged; null without a common ancestor.
 */
export async function forkPoint(
  repo: GitRepo,
  tip: string,
  branch: string,
  refs: RefList,
): Promise<string | null> {
  let latest: string | null = null;
  for (const end of branchTips(refs, branch)) {
    const base = await mergeBase(repo, tip, end);
    if (base === null || base === latest) continue;
    if (latest === null || (await isAncestor(repo, latest, base))) latest = base;
  }
  return latest;
}

/**
 * Commits on `to` that `from` lacks, newest first: at most `max`, and how many in all. Commits
 * the refs `not` have are left out (V17: the default branch's, once merged into a branch).
 */
export async function commitsBetween(
  repo: GitRepo,
  from: string,
  to: string,
  max = 100,
  not: readonly string[] = [],
): Promise<{ count: number; shas: string[] }> {
  const range = [`${from}..${to}`, ...(not.length > 0 ? ['--not', ...not] : [])];
  const [count, listed] = await Promise.all([
    git(repo.root, ['rev-list', '--count', ...range, '--']),
    git(repo.root, ['rev-list', `--max-count=${max}`, ...range, '--']),
  ]);
  return { count: Number(count.trim()), shas: listed.split('\n').filter((s) => s !== '') };
}

/** `git config user.email` (the repository's, else the user's), or null. */
export async function userEmail(repo: GitRepo): Promise<string | null> {
  try {
    const email = (await git(repo.root, ['config', '--get', 'user.email'])).trim();
    return email === '' ? null : email;
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return null;
    throw error;
  }
}

/**
 * A local branch's upstream: its remote, the branch's name there, and where the remote branch
 * was last seen (null once it is gone); null without an upstream.
 */
export async function upstreamOf(
  repo: GitRepo,
  branch: string,
): Promise<{ remote: string; branch: string; sha: string | null } | null> {
  const output = await git(repo.root, [
    'for-each-ref',
    '--format=%(upstream:remotename)%1f%(upstream:remoteref)%1f%(upstream)',
    `refs/heads/${branch}`,
  ]);
  const [remote = '', remoteRef = '', tracking = ''] = output.trim().split('\x1f');
  if (!remote || !remoteRef.startsWith('refs/heads/')) return null;
  let sha: string | null = null;
  try {
    sha = (await git(repo.root, ['rev-parse', '--verify', '--quiet', tracking])).trim() || null;
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
  }
  return { remote, branch: remoteRef.slice('refs/heads/'.length), sha };
}

/** Files git tracks under `folder` (repo-relative POSIX paths). */
export async function trackedFiles(repo: GitRepo, folder: string): Promise<string[]> {
  const output = await git(repo.root, ['ls-files', '-z', '--full-name', '--', `:/${folder}`]);
  return output.split('\0').filter((path) => path !== '');
}

/**
 * A file in the working copy against git: `committed` as it is, `changed` since (deleted too),
 * `new` (not committed yet, staged or not), `ignored`, or `none` (neither on disk nor in git).
 */
export type FileGitState = 'committed' | 'changed' | 'new' | 'ignored' | 'none';

/** `path`'s state (repo-relative POSIX), from `git status` (V28). */
export async function fileGitState(repo: GitRepo, path: string): Promise<FileGitState> {
  const status = await git(repo.root, [
    'status',
    '--porcelain=v1',
    '--ignored',
    '-z',
    '--',
    `:/${path}`,
  ]);
  const xy = status.slice(0, 2);
  if (xy === '??' || xy.startsWith('A')) return 'new';
  if (xy === '!!') return 'ignored';
  if (xy !== '') return 'changed';
  return (await trackedFiles(repo, path)).length > 0 ? 'committed' : 'none';
}

/** The best common ancestor of two commits; null without one. */
export async function mergeBase(repo: GitRepo, a: string, b: string): Promise<string | null> {
  try {
    return (await git(repo.root, ['merge-base', a, b])).trim();
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return null;
    throw error;
  }
}

/** Whether `ancestor` is in the history of `of` (the same commit included). */
export async function isAncestor(repo: GitRepo, ancestor: string, of: string): Promise<boolean> {
  try {
    await git(repo.root, ['merge-base', '--is-ancestor', ancestor, of]);
    return true;
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return false;
    throw error;
  }
}

/**
 * Whether `tip` merges cleanly into `into` (V17), by `git merge-tree --write-tree` (git 2.38+):
 * no checkout, index or ref changes, only loose objects git's garbage collection removes.
 */
export async function checkMerge(repo: GitRepo, into: string, tip: string): Promise<MergeCheck> {
  const args = ['merge-tree', '--write-tree', '--name-only', '--no-messages', into, tip];
  try {
    await git(repo.root, args);
    return { clean: true };
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    // Exit 1: conflicts. The first line is the tree, then the conflicting paths.
    if (error.exitCode === 1 && error.stdout !== '') {
      const paths = error.stdout
        .split('\n')
        .slice(1)
        .filter((path) => path !== '');
      return { conflicts: [...new Set(paths)].sort() };
    }
    return { error: error.stderr.trim() || error.message };
  }
}
