// More of git on Git's page (fix/git-page-feature-extend, decisions 636–641): an operation in
// progress continued or aborted; a commit cherry-picked or reverted; a branch merged in or the
// branch checked out rebased onto one; the branch reset (soft or mixed, never hard); a file's
// changes discarded. Never forced, never a stash the person did not ask for: git refuses what
// would lose work and says so. A run that stops on conflicts is `stopped`, left in progress.
import { workingState, type Operation } from './checkout.js';
import { git, GitError, type GitOptions } from './exec.js';
import { historyState, isCommit } from './log.js';
import { listRefs } from './refs.js';
import { GitRefused } from './refused.js';
import type { GitRepo } from './repo.js';
import { workingChanges } from './working-changes.js';

/** git's own message, without its `fatal: ` or `error: ` prefix. */
export const gitWords = (error: GitError): string =>
  [error.stdout.trim(), error.stderr.trim()]
    .filter(Boolean)
    .join('\n')
    .replace(/^(fatal|error): /gm, '') || error.message;

/** What a run that may stop on conflicts answers: `stopped`, in git's words, when it did. */
export interface Stoppable {
  stopped?: string;
}

/** No editor: git takes the message it prepared (a merge's, a revert's, a rebase's). */
const NO_EDITOR: GitOptions = { env: { GIT_EDITOR: 'true' } };

/** Refused while a merge, rebase or the like is in progress (decision 57). */
export async function noOperation(repo: GitRepo): Promise<void> {
  const { operation } = await workingState(repo);
  if (operation) throw new GitRefused(`a ${operation} is in progress: finish or abort it first`);
}

/**
 * Runs `args`; when git fails with an operation left in progress, the run stopped on conflicts
 * (`stopped`); any other failure is git's refusal.
 */
async function stoppable(repo: GitRepo, args: readonly string[], what: string): Promise<Stoppable> {
  try {
    await git(repo.root, args, NO_EDITOR);
    return {};
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    const { operation } = await workingState(repo);
    if (operation) return { stopped: `The ${what} stopped on conflicts: ${gitWords(error)}` };
    throw new GitRefused(gitWords(error), { cause: error });
  }
}

async function aCommit(repo: GitRepo, sha: string): Promise<string[]> {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha) || !(await isCommit(repo, sha)))
    throw new GitRefused(`no commit ${sha}`);
  return (await git(repo.root, ['rev-list', '--parents', '-n', '1', sha]))
    .trim()
    .split(' ')
    .slice(1);
}

const holds = (repo: GitRepo, sha: string) =>
  git(repo.root, ['merge-base', '--is-ancestor', sha, 'HEAD']).then(
    () => true,
    () => false,
  );

/** The branch checked out; refused on a detached HEAD. */
async function checkedOut(repo: GitRepo): Promise<string> {
  const { branch } = await historyState(repo);
  if (!branch) throw new GitRefused('HEAD is detached: check out a branch first');
  return branch;
}

/**
 * A local or remote branch by its listed name, as git is to be given it: the name, which git's
 * messages say ("Merge branch 'topic'"), unless a tag has it too or it reads as an option, then
 * its full ref. Refused otherwise.
 */
async function branchRef(repo: GitRepo, name: string, current: string): Promise<string> {
  if (name === current) throw new GitRefused(`${name} is the branch checked out`);
  const refs = await listRefs(repo);
  const plain = !name.startsWith('-') && !refs.tags.some((t) => t.name === name);
  if (refs.branches.some((b) => b.name === name)) return plain ? name : `refs/heads/${name}`;
  if (refs.remotes.some((r) => r.name === name)) return plain ? name : `refs/remotes/${name}`;
  throw new GitRefused(`no branch ${name}`);
}

/**
 * Cherry-picks commit `sha` onto the branch checked out (a merge against its first parent).
 * Refused during an operation, for a commit the branch holds already, and in git's words.
 */
export async function cherryPick(repo: GitRepo, sha: string): Promise<Stoppable> {
  const parents = await aCommit(repo, sha);
  await noOperation(repo);
  if (await holds(repo, sha)) throw new GitRefused(`HEAD holds ${sha.slice(0, 7)} already`);
  const mainline = parents.length > 1 ? ['-m', '1'] : [];
  return stoppable(repo, ['cherry-pick', ...mainline, sha], 'cherry-pick');
}

/** Reverts commit `sha`, one the branch checked out holds, in a new commit (git's message). */
export async function revertCommit(repo: GitRepo, sha: string): Promise<Stoppable> {
  const parents = await aCommit(repo, sha);
  await noOperation(repo);
  if (!(await holds(repo, sha)))
    throw new GitRefused(`HEAD does not hold ${sha.slice(0, 7)}: nothing to revert`);
  const mainline = parents.length > 1 ? ['-m', '1'] : [];
  return stoppable(repo, ['revert', '--no-edit', ...mainline, sha], 'revert');
}

/** Merges branch `name` (local or remote) into the branch checked out: git's default, no editor. */
export async function mergeInto(repo: GitRepo, name: string): Promise<Stoppable> {
  const current = await checkedOut(repo);
  const ref = await branchRef(repo, name, current);
  await noOperation(repo);
  return stoppable(repo, ['merge', '--no-edit', ref], 'merge');
}

/** Rebases the branch checked out onto branch `name`; never with `--autostash`. */
export async function rebaseOnto(repo: GitRepo, name: string): Promise<Stoppable> {
  const current = await checkedOut(repo);
  const ref = await branchRef(repo, name, current);
  await noOperation(repo);
  return stoppable(repo, ['rebase', '--no-autostash', ref], 'rebase');
}

/** How a reset keeps the changes: staged (`soft`) or not (`mixed`). Never `hard`. */
export type ResetMode = 'soft' | 'mixed';
export const RESET_MODES: readonly ResetMode[] = ['soft', 'mixed'];

/** The commits HEAD has that `sha` lacks: what a reset to it takes off the branch. */
export async function commitsLeaving(repo: GitRepo, sha: string): Promise<number> {
  await aCommit(repo, sha);
  return Number((await git(repo.root, ['rev-list', '--count', `${sha}..HEAD`])).trim());
}

/** Resets the branch checked out (or a detached HEAD) to `sha`, the changes kept on disk. */
export async function resetTo(repo: GitRepo, sha: string, mode: ResetMode): Promise<void> {
  if (!RESET_MODES.includes(mode)) throw new GitRefused('a reset is soft or mixed');
  await aCommit(repo, sha);
  await noOperation(repo);
  try {
    await git(repo.root, ['reset', '--quiet', `--${mode}`, sha]);
  } catch (error) {
    if (error instanceof GitError) throw new GitRefused(gitWords(error), { cause: error });
    throw error;
  }
}

/** Continuing or aborting the operation in progress. */
export type OperationEnd = 'continue' | 'abort';

const ENDS: Record<Operation, Record<OperationEnd, string[] | null>> = {
  merge: { continue: ['commit', '--no-edit'], abort: ['merge', '--abort'] },
  rebase: { continue: ['rebase', '--continue'], abort: ['rebase', '--abort'] },
  am: { continue: ['am', '--continue'], abort: ['am', '--abort'] },
  'cherry-pick': { continue: ['cherry-pick', '--continue'], abort: ['cherry-pick', '--abort'] },
  revert: { continue: ['revert', '--continue'], abort: ['revert', '--abort'] },
  bisect: { continue: null, abort: ['bisect', 'reset'] },
};

/**
 * Continues the operation in progress (its conflicts resolved and staged; git's prepared message,
 * no editor) or aborts it, the branch as it was before. A rebase that stops again is `stopped`.
 */
export async function endOperation(repo: GitRepo, end: OperationEnd): Promise<Stoppable> {
  const { operation } = await workingState(repo);
  if (!operation) throw new GitRefused('nothing is in progress to continue or abort');
  const args = ENDS[operation][end];
  if (!args) throw new GitRefused(`a ${operation} goes on in a terminal: mark commits good or bad`);
  if (end === 'continue') {
    const left = (await workingChanges(repo)).unstaged.filter((f) => f.status === 'conflicted');
    if (left.length > 0)
      throw new GitRefused(
        `${left.length} conflicted file${left.length === 1 ? '' : 's'} left: resolve and stage ${left.length === 1 ? 'it' : 'them'} first`,
      );
  }
  return stoppable(repo, args, operation);
}

/**
 * Discards a file's changes not staged (decision 641): a tracked file back as the index has it,
 * a new one deleted. Its staged changes stay; a conflicted file is refused.
 */
export async function discardFile(repo: GitRepo, path: string): Promise<void> {
  const file = (await workingChanges(repo)).unstaged.find((f) => f.path === path);
  if (!file) throw new GitRefused(`${path} has no change to discard`);
  if (file.status === 'conflicted') throw new GitRefused(`${path} is conflicted: resolve it first`);
  const args =
    file.status === 'untracked'
      ? ['clean', '--quiet', '--force', '--', path]
      : ['restore', '--worktree', '--', path];
  try {
    await git(repo.root, ['--literal-pathspecs', ...args]);
  } catch (error) {
    if (error instanceof GitError) throw new GitRefused(gitWords(error), { cause: error });
    throw error;
  }
}
