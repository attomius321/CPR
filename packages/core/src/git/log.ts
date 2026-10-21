import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { git, GitError, gitStream } from './exec.js';
import type { LocalBranch, RemoteBranch } from './refs.js';
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

/** Which commits a history lists: every branch, local and remote (`all`), or HEAD's alone. */
export type HistoryScope = 'all' | 'current';
export const HISTORY_SCOPES: readonly HistoryScope[] = ['all', 'current'];

/** A commit's place in a history: its parents, first parent first. */
export interface HistoryRow {
  sha: string;
  parents: string[];
}

/** HEAD and the branches; what `historyState`'s version follows. */
export interface HistoryState {
  /** The branch checked out; null when HEAD is detached. */
  branch: string | null;
  /** HEAD's commit; null in a repository without commits. */
  head: string | null;
  /** Changes when HEAD or a branch moves, so a history listed before is stale. */
  version: string;
}

/** Rows of a history with their details (`symbiote view`'s `GET /api/history`). */
export interface HistoryPage {
  /** The history's version (`HistoryState.version`): rows of one version fit together. */
  version: string;
  branch: string | null;
  /** HEAD's commit. */
  head: string | null;
  /** The first row's number. */
  from: number;
  commits: Commit[];
  /** Rows listed so far; all of them once `done`. */
  listed: number;
  done: boolean;
}

/** Every row's parents as row numbers (`GET /api/history/shape`): what lanes are drawn from. */
export interface HistoryShape {
  version: string;
  rows: number;
  /** HEAD's row; null without commits. */
  head: number | null;
  parents: number[][];
  /** The default branch and the rows of its tips listed (V10c); absent when none is listed. */
  defaultBranch?: { name: string; rows: number[] };
}

/**
 * The branches with their tips' rows in one listing (`GET /api/history/refs`, V10b): null when
 * the scope does not list a tip.
 */
export interface HistoryRefs {
  version: string;
  branches: (LocalBranch & { row: number | null })[];
  remotes: (RemoteBranch & { row: number | null })[];
}

// Never tags as tips: they bring release lines no branch reaches (CPython's take its graph from
// 37 lanes to 2,449); they show on their commits' rows instead. Never `--all`: it brings the
// stash and the `refs/symbiote/*` heads `symbiote pr` fetches.
const TIPS: Record<HistoryScope, readonly string[]> = {
  all: ['HEAD', '--branches', '--remotes'],
  current: ['HEAD'],
};

// Fields end with US (0x1f) and records with NUL; the subject comes last, so a subject holding
// either separator is still read whole (`-z` ends each record with NUL).
const FORMAT = '%H%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s';
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

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

/**
 * Lists the scope's commits in graph order (`--topo-order`: each above its parents, a branch's
 * commits together), handing them to `onRows` in batches as git lists them. Without a
 * commit-graph file git orders the whole history before its first row.
 */
export async function streamHistory(
  repo: GitRepo,
  scope: HistoryScope,
  onRows: (rows: HistoryRow[]) => void,
): Promise<void> {
  let rest = '';
  const take = (text: string) => {
    const records = text.split('\0');
    rest = records.pop() ?? '';
    const rows = records.filter((record) => record !== '').map(parseRow);
    if (rows.length > 0) onRows(rows);
  };
  try {
    await gitStream(
      repo.root,
      ['log', '--topo-order', '-z', '--format=%H%x1f%P', ...TIPS[scope], '--'],
      (chunk) => take(rest + chunk),
    );
  } catch (error) {
    // A repository without commits yet has nothing to list.
    if (error instanceof GitError && !(await hasHead(repo))) return;
    throw error;
  }
  if (rest !== '') take(`${rest}\0`);
}

function parseRow(record: string): HistoryRow {
  const [sha = '', parents = ''] = record.split('\x1f');
  return { sha, parents: parents === '' ? [] : parents.split(' ') };
}

/** The commits asked for (full SHAs), in that order, with their refs: tags among them. */
export async function commitDetails(repo: GitRepo, shas: readonly string[]): Promise<Commit[]> {
  if (shas.length === 0) return [];
  for (const sha of shas) {
    if (!FULL_SHA.test(sha)) throw new Error(`not a full SHA: ${sha}`);
  }
  return parseLog(
    await git(repo.root, [
      'log',
      '--no-walk=unsorted',
      '-z',
      '--decorate=full',
      `--format=${FORMAT}`,
      ...shas,
      '--',
    ]),
  );
}

/** The branch checked out, HEAD, and a version that changes when HEAD or a branch moves. */
export async function historyState(repo: GitRepo): Promise<HistoryState> {
  const [branch, head, refs] = await Promise.all([
    currentBranch(repo),
    headCommit(repo),
    git(repo.root, [
      'for-each-ref',
      '--format=%(objectname) %(refname)',
      'refs/heads',
      'refs/remotes',
    ]),
  ]);
  const version = createHash('sha1')
    .update(`${branch ?? ''}\n${head ?? ''}\n${refs}`)
    .digest('hex')
    .slice(0, 12);
  return { branch, head, version };
}

/** Whether git keeps a commit-graph file, with which it lists a history in graph order at once. */
export function hasCommitGraph(repo: GitRepo): boolean {
  const info = join(repo.commonDir, 'objects', 'info');
  return (
    existsSync(join(info, 'commit-graph')) ||
    existsSync(join(info, 'commit-graphs', 'commit-graph-chain'))
  );
}

async function currentBranch(repo: GitRepo): Promise<string | null> {
  try {
    return (await git(repo.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

async function headCommit(repo: GitRepo): Promise<string | null> {
  try {
    return (await git(repo.root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

async function hasHead(repo: GitRepo): Promise<boolean> {
  return (await headCommit(repo)) !== null;
}

/** Whether `sha` is the full SHA of a commit in the repository (input from the viewer). */
export async function isCommit(repo: GitRepo, sha: string): Promise<boolean> {
  if (!FULL_SHA.test(sha)) return false;
  try {
    await git(repo.root, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch (error) {
    if (error instanceof GitError) return false;
    throw error;
  }
}
