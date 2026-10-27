// Branches and tags made, renamed and deleted from Git's page (V66d). Never forced unless asked:
// git's refusals are said in its words, and an unmerged branch is counted before it can go.
import { git, GitError, gitInput } from './exec.js';
import { historyState, isCommit } from './log.js';
import { listRefs } from './refs.js';
import { GitRefused } from './refused.js';
import type { GitRepo } from './repo.js';

/** An unmerged branch `git branch -d` refused; `only` is how many commits no other ref holds. */
export class BranchNotMerged extends GitRefused {
  override name = 'BranchNotMerged';
  constructor(
    readonly branch: string,
    readonly only: number,
  ) {
    super(
      `${branch} is not merged: ${only} commit${only === 1 ? '' : 's'} only it holds would be lost`,
    );
  }
}

/** git's own message, without its `fatal: ` or `error: ` prefix. */
const words = (error: GitError) =>
  error.stderr.trim().replace(/^(fatal|error): /gm, '') || error.message;

async function run(repo: GitRepo, args: readonly string[]): Promise<void> {
  try {
    await git(repo.root, args);
  } catch (error) {
    if (error instanceof GitError) throw new GitRefused(words(error), { cause: error });
    throw error;
  }
}

/** Refused unless git takes `name` for a `kind` and no ref of that kind has it. */
async function newName(repo: GitRepo, kind: 'branch' | 'tag', name: string): Promise<void> {
  if (name === '') throw new GitRefused(`a ${kind} needs a name`);
  if (name.startsWith('-')) throw new GitRefused(`a ${kind} name cannot start with -`);
  try {
    await git(repo.root, [
      'check-ref-format',
      kind === 'branch' ? `refs/heads/${name}` : `refs/tags/${name}`,
    ]);
  } catch (error) {
    if (error instanceof GitError) throw new GitRefused(`not a valid ${kind} name: ${name}`);
    throw error;
  }
  const refs = await listRefs(repo);
  const taken = kind === 'branch' ? refs.branches : refs.tags;
  if (taken.some((ref) => ref.name === name)) throw new GitRefused(`a ${kind} ${name} exists`);
}

async function aCommit(repo: GitRepo, sha: string): Promise<void> {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha) || !(await isCommit(repo, sha)))
    throw new GitRefused(`no commit ${sha}`);
}

async function aBranch(repo: GitRepo, name: string): Promise<void> {
  if (!(await listRefs(repo)).branches.some((b) => b.name === name))
    throw new GitRefused(`no branch ${name}`);
}

/**
 * Makes branch `name` at the commit `at`; with `checkout`, switches to it (`git switch`, never
 * forced). The branch stays when git refuses the switch: `warning` says why.
 */
export async function createBranch(
  repo: GitRepo,
  { name, at, checkout = false }: { name: string; at: string; checkout?: boolean },
): Promise<{ warning?: string }> {
  await newName(repo, 'branch', name);
  await aCommit(repo, at);
  await run(repo, ['branch', '--no-track', name, at]);
  if (!checkout) return {};
  try {
    await git(repo.root, ['switch', '--no-guess', name]);
    return {};
  } catch (error) {
    if (error instanceof GitError)
      return { warning: `${name} was made, not checked out: ${words(error)}` };
    throw error;
  }
}

/** Renames branch `from` to `to` (`git branch -m`, never `-M`). */
export async function renameBranch(repo: GitRepo, from: string, to: string): Promise<void> {
  await aBranch(repo, from);
  await newName(repo, 'branch', to);
  await run(repo, ['branch', '-m', from, to]);
}

/**
 * Deletes branch `name`: `git branch -d`, which refuses an unmerged branch (a `BranchNotMerged`,
 * its commits no other branch, remote branch or tag holds counted); `-D` only with `force`.
 * The branch checked out is refused.
 */
export async function deleteBranch(
  repo: GitRepo,
  name: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  await aBranch(repo, name);
  if ((await historyState(repo)).branch === name)
    throw new GitRefused(`${name} is checked out: check out another branch first`);
  try {
    await git(repo.root, ['branch', force ? '-D' : '-d', name]);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    if (!force && /not fully merged/.test(error.stderr)) {
      const only = await git(repo.root, [
        'rev-list',
        '--count',
        `refs/heads/${name}`,
        '--not',
        `--exclude=${name}`,
        '--branches',
        '--remotes',
        '--tags',
      ]);
      throw new BranchNotMerged(name, Number(only.trim()));
    }
    throw new GitRefused(words(error), { cause: error });
  }
}

/** Makes tag `name` at the commit `at`: annotated with `message`, else a light one. */
export async function createTag(
  repo: GitRepo,
  { name, at, message }: { name: string; at: string; message?: string },
): Promise<void> {
  await newName(repo, 'tag', name);
  await aCommit(repo, at);
  if (!message?.trim()) return run(repo, ['tag', name, at]);
  try {
    await gitInput(
      repo.root,
      ['tag', '--annotate', '--cleanup=whitespace', '--file=-', name, at],
      message,
    );
  } catch (error) {
    if (error instanceof GitError) throw new GitRefused(words(error), { cause: error });
    throw error;
  }
}

/** Deletes tag `name` (`git tag -d`), here only: a remote's copy stays. */
export async function deleteTag(repo: GitRepo, name: string): Promise<void> {
  if (!(await listRefs(repo)).tags.some((t) => t.name === name))
    throw new GitRefused(`no tag ${name}`);
  await run(repo, ['tag', '-d', name]);
}
