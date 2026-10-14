import { git, GitError } from './exec.js';
import type { RefList } from './refs.js';
import type { GitRepo } from './repo.js';

/** A ref of a reviewed branch (the local branch or a remote's) and the commits since review. */
export interface BranchReviewRef {
  name: string;
  tip: string;
  /** Commits on the tip since the review's head. */
  since: number;
}

/** A verdict's event: the same three as `cpr pr`'s. */
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

/** What Approve's push did: the commit pushed, git's refusal, or why there was no push. */
export type PushOutcome =
  { remote: string; branch: string; sha: string } | { error: string } | { none: string };

/** A finished branch review: the verdict at a tip, with its summary and comments. */
export interface Verdict {
  at: string;
  comments: VerdictComment[];
  event: VerdictEvent;
  /** The tip reviewed. */
  head: string;
  summary: string;
  push?: PushOutcome;
}

/** `POST ./api/review` on a branch review: the verdict, and the drafts as comments. */
export interface LocalReview {
  event: VerdictEvent;
  body: string;
  comments: (Omit<VerdictComment, 'code'> & { otherPath?: string })[];
}

/** What finishing answers: the verdict, its text for a chat, newer commits left unpushed. */
export interface FinishResult {
  verdict: Verdict;
  text: string;
  unpushed: number;
}

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
  /** The last verdict (V16). */
  verdict?: { event: VerdictEvent; head: string; at: string; comments: number; pushed: boolean };
}

/** `GET /api/reviews`: the reviewer's branch reviews and where they are kept. */
export interface BranchReviewList {
  /** The branch others branch from: no review of its own. */
  defaultBranch: string | null;
  reviewer: string;
  /** `repository`: `cpr/reviews/`; `cache`: CPR's cache, `note` says why. */
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
  /** Why the review is kept in CPR's cache, not in `cpr/reviews/`. */
  note?: string;
  /** Where Approve pushes (V16), and how many commits; absent without a remote. */
  push?: { remote: string; branch: string; commits: number };
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
  const ends = [
    ...refs.branches.filter((b) => b.name === branch).map((b) => b.sha),
    ...refs.remotes.filter((r) => r.branch === branch).map((r) => r.sha),
  ];
  let latest: string | null = null;
  for (const end of new Set(ends)) {
    const base = await mergeBase(repo, tip, end);
    if (base === null || base === latest) continue;
    if (latest === null || (await isAncestor(repo, latest, base))) latest = base;
  }
  return latest;
}

/** Commits on `to` that `from` lacks, newest first: at most `max`, and how many in all. */
export async function commitsBetween(
  repo: GitRepo,
  from: string,
  to: string,
  max = 100,
): Promise<{ count: number; shas: string[] }> {
  const range = `${from}..${to}`;
  const [count, listed] = await Promise.all([
    git(repo.root, ['rev-list', '--count', range, '--']),
    git(repo.root, ['rev-list', `--max-count=${max}`, range, '--']),
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

/** A push git refused (V16): its words, or why CPR would not ask. */
export class PushRefused extends Error {
  override name = 'PushRefused';
}

/** The repository's remotes. */
export async function listRemotes(repo: GitRepo): Promise<string[]> {
  return (await git(repo.root, ['remote'])).split('\n').filter((r) => r !== '');
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

/**
 * Pushes the commit `sha` to `branch` on `remote` — that commit, never a later one, never
 * forced: git refuses what is not a fast-forward, and its words come back as `PushRefused`.
 */
export async function pushCommit(
  repo: GitRepo,
  sha: string,
  remote: string,
  branch: string,
): Promise<void> {
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) throw new PushRefused(`not a commit: ${sha}`);
  if (remote.startsWith('-') || branch.startsWith('-') || remote === '' || branch === '') {
    throw new PushRefused(`not a remote branch: ${remote}/${branch}`);
  }
  try {
    await git(repo.root, ['push', '--quiet', remote, `${sha}:refs/heads/${branch}`]);
  } catch (error) {
    if (error instanceof GitError) throw new PushRefused(error.stderr.trim(), { cause: error });
    throw error;
  }
}

/** Makes `remote/branch` the upstream of the local branch `local`. */
export async function setUpstream(
  repo: GitRepo,
  local: string,
  remote: string,
  branch: string,
): Promise<void> {
  await git(repo.root, ['branch', `--set-upstream-to=${remote}/${branch}`, '--', local]);
}

/** Files git tracks under `folder` (repo-relative POSIX paths). */
export async function trackedFiles(repo: GitRepo, folder: string): Promise<string[]> {
  const output = await git(repo.root, ['ls-files', '-z', '--full-name', '--', `:/${folder}`]);
  return output.split('\0').filter((path) => path !== '');
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

async function isAncestor(repo: GitRepo, ancestor: string, of: string): Promise<boolean> {
  try {
    await git(repo.root, ['merge-base', '--is-ancestor', ancestor, of]);
    return true;
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return false;
    throw error;
  }
}
