// Fetch, pull and push from Git's page (V66e). Never forced, never a stash or a discard: git
// refuses what would lose work and says so; no run waits on a prompt.
import { workingState } from './checkout.js';
import { git, GitError, type GitOptions } from './exec.js';
import { historyState } from './log.js';
import { listRefs } from './refs.js';
import { GitRefused } from './refused.js';
import type { GitRepo } from './repo.js';

/** How pull joins the upstream's commits: fast-forward only (the default), merging, rebasing. */
export type PullMode = 'ff-only' | 'merge' | 'rebase';
export const PULL_MODES: readonly PullMode[] = ['ff-only', 'merge', 'rebase'];

/** The branch checked out and its upstream (`GET /api/git/sync`), for the header's buttons. */
export interface SyncState {
  /** Null when HEAD is detached. */
  branch: string | null;
  /** `origin/main`; absent without one. */
  upstream?: string;
  /** Commits the branch has that its upstream lacks, and the other way. */
  ahead: number;
  behind: number;
  /** The upstream is gone from the remote (pruned). */
  gone?: true;
  /** The repository's remotes, by name. */
  remotes: string[];
}

/** A network run's limit: then git is stopped and the page says so. */
const NETWORK_MS = 120_000;

/** git's own message, without its `fatal: ` or `error: ` prefix. */
const words = (error: GitError) =>
  error.exitCode === null
    ? `git took more than ${NETWORK_MS / 1000} s and was stopped`
    : error.stderr.trim().replace(/^(fatal|error): /gm, '') || error.message;

/**
 * A network run's options: its time limit, and ssh asked never to prompt (`BatchMode`) unless the
 * person set an ssh command of their own. git's own prompts are off for every run (`gitEnv`).
 */
async function network(repo: GitRepo): Promise<GitOptions> {
  const own =
    process.env.GIT_SSH_COMMAND ||
    process.env.GIT_SSH ||
    (await git(repo.root, ['config', '--get', 'core.sshCommand']).catch(() => '')).trim();
  return {
    timeout: NETWORK_MS,
    ...(own ? {} : { env: { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' } }),
  };
}

export async function syncState(repo: GitRepo): Promise<SyncState> {
  const [{ branch }, refs, remotes] = await Promise.all([
    historyState(repo),
    listRefs(repo),
    git(repo.root, ['remote']),
  ]);
  const local = refs.branches.find((b) => b.name === branch);
  return {
    branch,
    ...(local?.upstream ? { upstream: local.upstream } : {}),
    ahead: local?.ahead ?? 0,
    behind: local?.behind ?? 0,
    ...(local?.gone ? { gone: true as const } : {}),
    remotes: remotes.split('\n').filter((name) => name !== ''),
  };
}

/** Fetches every remote, branches gone from them pruned (`git fetch --all --prune`). */
export async function fetchAll(repo: GitRepo): Promise<void> {
  try {
    await git(repo.root, ['fetch', '--all', '--prune', '--quiet'], await network(repo));
  } catch (error) {
    if (error instanceof GitError) throw new GitRefused(words(error), { cause: error });
    throw error;
  }
}

/** The branch checked out and its upstream's remote and ref, or why there is none. */
async function tracked(
  repo: GitRepo,
): Promise<{ branch: string; remote?: string; merge?: string }> {
  const { branch } = await historyState(repo);
  if (!branch) throw new GitRefused('HEAD is detached: check out a branch first');
  const config = async (key: string) =>
    (await git(repo.root, ['config', '--get', `branch.${branch}.${key}`]).catch(() => '')).trim();
  const [remote, merge] = await Promise.all([config('remote'), config('merge')]);
  return { branch, ...(remote && merge ? { remote, merge } : {}) };
}

async function noOperation(repo: GitRepo): Promise<void> {
  const { operation } = await workingState(repo);
  if (operation) throw new GitRefused(`a ${operation} is in progress: finish or abort it first`);
}

/**
 * Pulls the branch's upstream into it: fast-forward only, merging, or rebasing. Refused without
 * an upstream, on a detached HEAD, during an operation, and in git's words when git refuses
 * (diverged branches for `ff-only`, local changes it would overwrite). A merge or rebase that
 * stopped on conflicts is `stopped`: left in progress, its conflicts on the page.
 */
export async function pull(repo: GitRepo, mode: PullMode): Promise<{ stopped?: string }> {
  const { branch, remote } = await tracked(repo);
  if (!remote) throw new GitRefused(`${branch} has no upstream: push it first`);
  await noOperation(repo);
  const how = {
    'ff-only': ['--ff-only'],
    merge: ['--no-rebase', '--no-edit'],
    rebase: ['--rebase'],
  };
  try {
    await git(repo.root, ['pull', '--quiet', ...how[mode]], await network(repo));
    return {};
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    const { operation } = await workingState(repo);
    if (operation) return { stopped: `The ${operation} stopped on conflicts: ${words(error)}` };
    throw new GitRefused(words(error), { cause: error });
  }
}

/**
 * Pushes the branch checked out to its upstream; without one, to `origin` (or the one remote)
 * under its own name, the upstream set. Never forced: a rejected push is said in git's words.
 */
export async function push(repo: GitRepo): Promise<{ upstream: string; set?: true }> {
  const { branch, remote, merge } = await tracked(repo);
  let target = remote && merge ? { remote, ref: merge, set: false } : null;
  if (!target) {
    const remotes = (await git(repo.root, ['remote'])).split('\n').filter((name) => name !== '');
    const only = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null;
    if (!only) throw new GitRefused('no remote to push to: add one with git remote add');
    target = { remote: only, ref: `refs/heads/${branch}`, set: true };
  }
  try {
    await git(
      repo.root,
      [
        'push',
        '--quiet',
        ...(target.set ? ['--set-upstream'] : []),
        target.remote,
        `refs/heads/${branch}:${target.ref}`,
      ],
      await network(repo),
    );
  } catch (error) {
    if (error instanceof GitError) throw new GitRefused(words(error), { cause: error });
    throw error;
  }
  const upstream = `${target.remote}/${target.ref.replace(/^refs\/heads\//, '')}`;
  return { upstream, ...(target.set ? { set: true as const } : {}) };
}

/**
 * Deletes a remote branch (`origin/topic`) on its remote (decision 644): `git push <remote>
 * --delete`, never forced. Refused for one not listed and for the remote's default branch (its
 * `HEAD`), which is everyone's; a rejection is said in git's words.
 */
export async function deleteRemoteBranch(repo: GitRepo, name: string): Promise<void> {
  const remote = (await listRefs(repo)).remotes.find((r) => r.name === name);
  if (!remote) throw new GitRefused(`no remote branch ${name}`);
  const head = (
    await git(repo.root, ['symbolic-ref', '--quiet', `refs/remotes/${remote.remote}/HEAD`]).catch(
      () => '',
    )
  ).trim();
  if (head === `refs/remotes/${name}`)
    throw new GitRefused(`${name} is ${remote.remote}'s default branch`);
  try {
    await git(
      repo.root,
      ['push', '--quiet', remote.remote, '--delete', `refs/heads/${remote.branch}`],
      await network(repo),
    );
  } catch (error) {
    if (error instanceof GitError) throw new GitRefused(words(error), { cause: error });
    throw error;
  }
}
