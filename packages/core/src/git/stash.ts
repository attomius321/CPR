// Stashes on Git's page (decision 639): every change put aside, new files too, with a message;
// the stashes listed; one applied, popped or dropped by its SHA, as its place in the list shifts
// when others come and go.
import { git, GitError } from './exec.js';
import { gitWords, noOperation, type Stoppable } from './operations.js';
import { GitRefused } from './refused.js';
import type { GitRepo } from './repo.js';
import { workingChanges } from './working-changes.js';

/** A stash (`GET /api/git/stashes`), newest first. */
export interface StashEntry {
  sha: string;
  /** Its message: the one given, else git's ("WIP on main: <subject>"). */
  message: string;
  /** The branch it was made on; absent on a detached HEAD. */
  branch?: string;
  /** When it was made (ISO 8601). */
  date: string;
}

/** `On main: message` or `WIP on main: abc1234 subject`: the branch, and the message to show. */
function readSubject(subject: string): { message: string; branch?: string } {
  const given = /^On ([^:]+): (.*)$/s.exec(subject);
  if (given)
    return { message: given[2] ?? '', ...(given[1] === '(no branch)' ? {} : { branch: given[1] }) };
  const wip = /^WIP on ([^:]+): [0-9a-f]+ (.*)$/s.exec(subject);
  if (wip) {
    const branch = wip[1] ?? '';
    return {
      message: `WIP on ${branch}: ${wip[2] ?? ''}`,
      ...(branch === '(no branch)' ? {} : { branch }),
    };
  }
  return { message: subject };
}

export async function listStashes(repo: GitRepo): Promise<StashEntry[]> {
  const out = await git(repo.root, ['stash', 'list', '-z', '--format=%H%x1f%cI%x1f%gs']);
  return out
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => {
      const [sha = '', date = '', subject = ''] = record.split('\x1f');
      return { sha, date, ...readSubject(subject) };
    });
}

/** `stash@{n}` for the stash with this SHA; refused when none has it. */
async function stashRef(repo: GitRepo, sha: string): Promise<string> {
  const at = (await listStashes(repo)).findIndex((s) => s.sha === sha);
  if (at < 0) throw new GitRefused(`no stash ${sha.slice(0, 7)}`);
  return `stash@{${at}}`;
}

async function run(repo: GitRepo, args: readonly string[]): Promise<void> {
  try {
    await git(repo.root, args);
  } catch (error) {
    if (error instanceof GitError) throw new GitRefused(gitWords(error), { cause: error });
    throw error;
  }
}

/** Stashes every change, new files too (`--include-untracked`), with `message` when given. */
export async function stashChanges(repo: GitRepo, message: string): Promise<void> {
  await noOperation(repo);
  const { staged, unstaged } = await workingChanges(repo);
  if (staged.length + unstaged.length === 0) throw new GitRefused('nothing to stash');
  const words = message.trim();
  await run(repo, [
    'stash',
    'push',
    '--quiet',
    '--include-untracked',
    ...(words ? ['--message', words] : []),
  ]);
}

/**
 * Applies the stash with this SHA, kept in the list, or pops it (dropped once applied). Refused in
 * git's words when it would overwrite local changes; applied with conflicts, it is `stopped` and
 * kept, the conflicts on the page.
 */
export async function applyStash(
  repo: GitRepo,
  sha: string,
  { pop }: { pop: boolean },
): Promise<Stoppable> {
  await noOperation(repo);
  const ref = await stashRef(repo, sha);
  try {
    await git(repo.root, ['stash', pop ? 'pop' : 'apply', '--quiet', ref]);
    return {};
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    const conflicted = (await workingChanges(repo)).unstaged.some((f) => f.status === 'conflicted');
    if (conflicted)
      return { stopped: `The stash was applied with conflicts, and kept: ${gitWords(error)}` };
    throw new GitRefused(gitWords(error), { cause: error });
  }
}

/** Drops the stash with this SHA: its changes are lost (the page asks first). */
export async function dropStash(repo: GitRepo, sha: string): Promise<void> {
  await run(repo, ['stash', 'drop', '--quiet', await stashRef(repo, sha)]);
}
