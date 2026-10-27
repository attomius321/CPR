// A commit as Git's details pane shows it (V66b): its message, its people, and its files against
// its first parent, each file's lines and diff asked for apart.
import {
  listChangedFiles,
  listLineCounts,
  type ChangedFile,
  type LineCount,
} from './changed-files.js';
import { git, GitError, gitInput } from './exec.js';
import { fileDiff } from './file-diff.js';
import type { GitRepo } from './repo.js';

/** Who wrote or committed a commit, and when (ISO 8601 with their offset). */
export interface CommitPerson {
  name: string;
  email: string;
  date: string;
}

export interface CommitInfo {
  sha: string;
  /** First parent first; none for a root commit. */
  parents: string[];
  author: CommitPerson;
  committer: CommitPerson;
  subject: string;
  /** The message after the subject's paragraph, trimmed; empty when there is none. */
  body: string;
  /** What it changes against its first parent (a root commit: against nothing), renames found. */
  files: ChangedFile[];
}

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// Fields end with US (0x1f); the message comes last, so one holding US is read whole.
const FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%B';

/** The commit at a full SHA, or null when the repository has none there. */
async function readCommit(repo: GitRepo, sha: string): Promise<string | null> {
  if (!FULL_SHA.test(sha)) return null;
  try {
    return await git(repo.root, ['show', '-s', `--format=${FORMAT}`, `${sha}^{commit}`, '--']);
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

/** What a commit's diff starts from: its first parent, or the empty tree for a root commit. */
async function parentOf(repo: GitRepo, parents: readonly string[]): Promise<string> {
  if (parents[0]) return parents[0];
  return (await gitInput(repo.root, ['hash-object', '-t', 'tree', '--stdin'], ''))
    .toString()
    .trim();
}

/** A commit's details and its files' names (`GET /api/git/commit`); null when it is none. */
export async function commitInfo(repo: GitRepo, sha: string): Promise<CommitInfo | null> {
  const text = await readCommit(repo, sha);
  if (text === null) return null;
  const [found = '', parents = '', an = '', ae = '', ad = '', cn = '', ce = '', cd = '', ...rest] =
    text.split('\x1f');
  const message = rest.join('\x1f').replace(/\s+$/, '');
  const split = message.indexOf('\n\n');
  const listed = parents === '' ? [] : parents.split(' ');
  return {
    sha: found,
    parents: listed,
    author: { name: an, email: ae, date: ad },
    committer: { name: cn, email: ce, date: cd },
    subject: (split < 0 ? message : message.slice(0, split)).replace(/\n/g, ' '),
    body: split < 0 ? '' : message.slice(split + 2).trim(),
    files: await listChangedFiles(repo, await parentOf(repo, listed), found),
  };
}

/**
 * Each changed file's lines against the first parent (`GET /api/git/commit/lines`): apart from
 * the names, as a blobless clone fetches every blob to count them (V66 spike: 565–940 ms on
 * Bitwarden, the names 1 ms).
 */
export async function commitLines(repo: GitRepo, sha: string): Promise<LineCount[]> {
  const text = await readCommit(repo, sha);
  if (text === null) return [];
  const [found = '', parents = ''] = text.split('\x1f');
  return listLineCounts(
    repo,
    await parentOf(repo, parents === '' ? [] : parents.split(' ')),
    found,
  );
}

/**
 * One file's diff against the commit's first parent, the whole file as context
 * (`GET /api/git/commit/file`); null unless the commit changes `path`.
 */
export async function commitFileDiff(
  repo: GitRepo,
  sha: string,
  path: string,
): Promise<string | null> {
  const info = await commitInfo(repo, sha);
  const file = info?.files.find((f) => f.path === path);
  if (!info || !file) return null;
  return fileDiff(repo, await parentOf(repo, info.parents), info.sha, file);
}
