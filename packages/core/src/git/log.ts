import { git, GitError } from './exec.js';
import type { GitRepo } from './repo.js';

/** A branch or tag pointing at a commit; `head` is HEAD itself. */
export interface CommitRef {
  kind: 'head' | 'branch' | 'remote' | 'tag';
  name: string;
}

export interface Commit {
  sha: string;
  /** First parent first; none for a root commit. */
  parents: string[];
  author: string;
  /** Author date, ISO 8601 with the author's offset. */
  date: string;
  subject: string;
  refs: CommitRef[];
}

export interface CommitPage {
  /** The branch checked out; null when HEAD is detached. */
  branch: string | null;
  /** Newest first. */
  commits: Commit[];
  /** More commits follow this page. */
  more: boolean;
}

export interface ListCommitsOptions {
  /** Commits to skip from the newest. Default: 0. */
  skip?: number;
  /** Default: 100. */
  limit?: number;
}

// Fields end with US (0x1f) and records with NUL; the subject comes last, so a subject holding
// either separator is still read whole (`-z` ends each record with NUL).
const FORMAT = '%H%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s';

/** Parses `git log -z --decorate=full --format=<FORMAT>` output. */
export function parseLog(output: string): Commit[] {
  return output
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => {
      const [sha = '', parents = '', author = '', date = '', refs = '', ...subject] =
        record.split('\x1f');
      return {
        sha,
        parents: parents === '' ? [] : parents.split(' '),
        author,
        date,
        subject: subject.join('\x1f'),
        refs: parseRefs(refs),
      };
    });
}

/** `%D` with full names: `HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main`. */
function parseRefs(text: string): CommitRef[] {
  if (text === '') return [];
  return text.split(', ').flatMap((part): CommitRef[] => {
    if (part === 'HEAD') return [{ kind: 'head', name: 'HEAD' }];
    if (part.startsWith('HEAD -> ')) {
      return [{ kind: 'head', name: 'HEAD' }, ...parseRefs(part.slice('HEAD -> '.length))];
    }
    const name = part.replace(/^tag: /, '');
    if (name.startsWith('refs/heads/')) {
      return [{ kind: 'branch', name: name.slice('refs/heads/'.length) }];
    }
    if (name.startsWith('refs/tags/')) {
      return [{ kind: 'tag', name: name.slice('refs/tags/'.length) }];
    }
    // A remote's HEAD only repeats its default branch.
    if (name.startsWith('refs/remotes/') && !name.endsWith('/HEAD')) {
      return [{ kind: 'remote', name: name.slice('refs/remotes/'.length) }];
    }
    return [];
  });
}

/** One page of the commits reachable from HEAD, newest first (`git log` order). */
export async function listCommits(
  repo: GitRepo,
  { skip = 0, limit = 100 }: ListCommitsOptions = {},
): Promise<CommitPage> {
  const branch = await currentBranch(repo);
  let output: string;
  try {
    output = await git(repo.root, [
      'log',
      '-z',
      '--decorate=full',
      `--format=${FORMAT}`,
      `--skip=${skip}`,
      `--max-count=${limit + 1}`,
      'HEAD',
      '--',
    ]);
  } catch (error) {
    // A repository without commits yet has nothing to list.
    if (error instanceof GitError && !(await hasHead(repo))) {
      return { branch, commits: [], more: false };
    }
    throw error;
  }
  const commits = parseLog(output);
  return { branch, commits: commits.slice(0, limit), more: commits.length > limit };
}

async function currentBranch(repo: GitRepo): Promise<string | null> {
  try {
    return (await git(repo.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

async function hasHead(repo: GitRepo): Promise<boolean> {
  try {
    await git(repo.root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    return true;
  } catch (error) {
    if (error instanceof GitError) return false;
    throw error;
  }
}

/** Whether `sha` is the full SHA of a commit in the repository (input from the viewer). */
export async function isCommit(repo: GitRepo, sha: string): Promise<boolean> {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) return false;
  try {
    await git(repo.root, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch (error) {
    if (error instanceof GitError) return false;
    throw error;
  }
}
