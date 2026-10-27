// The checkout's uncommitted changes as Git's page shows them (V66c): what is staged and what is
// not, each file's diff, and the writes that stage, unstage and commit them.
import { parseNumstat, type FileChangeStatus, type LineCount } from './changed-files.js';
import { workingState, type Operation } from './checkout.js';
import { git, GitError, gitInput } from './exec.js';
import { GitRefused } from './refused.js';
import type { GitRepo } from './repo.js';

/** How a file differs: in the index against HEAD (staged), or on disk against the index. */
export type WorkingFileStatus = FileChangeStatus | 'untracked' | 'conflicted';

export interface WorkingFile {
  path: string;
  status: WorkingFileStatus;
  /** Where a renamed or copied file came from. */
  previousPath?: string;
}

/** `GET /api/git/changes`: the staged files, and the rest (not staged, new, conflicted). */
export interface WorkingChanges {
  staged: WorkingFile[];
  unstaged: WorkingFile[];
  /** A merge, rebase or the like in progress: its conflicts are among `unstaged`. */
  operation: Operation | null;
}

const STATUS: Record<string, FileChangeStatus> = {
  M: 'modified',
  T: 'type-changed',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
};
const CONFLICTS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/**
 * Parses `git status --porcelain -z`: `XY <path>\0`, a rename or copy followed by the path it came
 * from. X is the index against HEAD (staged), Y the disk against the index; a conflict is one file.
 */
export function parseWorkingStatus(output: string): Omit<WorkingChanges, 'operation'> {
  const entries = output.split('\0');
  const staged: WorkingFile[] = [];
  const unstaged: WorkingFile[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? '';
    if (entry === '') continue;
    const [x = ' ', y = ' '] = entry;
    const path = entry.slice(3);
    const previousPath = /[RC]/.test(x + y) ? entries[++i] : undefined;
    const from = previousPath ? { previousPath } : {};
    if (x + y === '??') unstaged.push({ path, status: 'untracked' });
    else if (CONFLICTS.has(x + y)) unstaged.push({ path, status: 'conflicted' });
    else {
      const index = STATUS[x];
      const disk = STATUS[y];
      if (index) staged.push({ path, status: index, ...(x === 'R' || x === 'C' ? from : {}) });
      if (disk) unstaged.push({ path, status: disk, ...(y === 'R' || y === 'C' ? from : {}) });
    }
  }
  const byPath = (a: WorkingFile, b: WorkingFile) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  return { staged: staged.sort(byPath), unstaged: unstaged.sort(byPath) };
}

/** The checkout's uncommitted changes, each file of a new folder listed, ignored ones not. */
export async function workingChanges(repo: GitRepo): Promise<WorkingChanges> {
  const [status, { operation }] = await Promise.all([
    git(repo.root, ['status', '--porcelain', '-z', '--untracked-files=all']),
    workingState(repo),
  ]);
  return { ...parseWorkingStatus(status), operation };
}

const DIFF = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--no-relative'];

/** Each staged file's lines against HEAD, and each changed one's on disk against the index. */
export async function workingLines(
  repo: GitRepo,
): Promise<{ staged: LineCount[]; unstaged: LineCount[] }> {
  const [staged, unstaged] = await Promise.all([
    git(repo.root, [...DIFF, '--cached', '--numstat', '-z', '-M', '--']),
    git(repo.root, [...DIFF, '--numstat', '-z', '--']),
  ]);
  return { staged: parseNumstat(staged), unstaged: parseNumstat(unstaged) };
}

/** The whole file as context (V60): one hunk, every line. */
const WHOLE = ['--unified=2147483647', '--src-prefix=a/', '--dst-prefix=b/'];

/**
 * A changed file's diff, the whole file as context: staged against HEAD, else on disk against the
 * index (a new file whole, a conflicted one against HEAD, its markers in it); null unless the
 * status lists it on that side.
 */
export async function workingFileDiff(
  repo: GitRepo,
  path: string,
  staged: boolean,
): Promise<string | null> {
  const changes = await workingChanges(repo);
  const file = (staged ? changes.staged : changes.unstaged).find((f) => f.path === path);
  if (!file) return null;
  const paths = [...(file.previousPath ? [file.previousPath] : []), file.path];
  if (staged) return git(repo.root, [...DIFF, ...WHOLE, '--cached', '-M', '--', ...paths]);
  if (file.status === 'conflicted') return git(repo.root, [...DIFF, ...WHOLE, 'HEAD', '--', path]);
  if (file.status !== 'untracked') return git(repo.root, [...DIFF, ...WHOLE, '--', ...paths]);
  try {
    // Differences are exit 1 for `--no-index`.
    return await git(repo.root, [...DIFF, ...WHOLE, '--no-index', '--', '/dev/null', path]);
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return error.stdout;
    throw error;
  }
}

/** The files of `paths`, each listed on that side; refused when one is not. */
function listed(files: readonly WorkingFile[], paths: readonly string[], side: string) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  if (paths.length === 0) throw new GitRefused(`no file to ${side}`);
  return paths.map((path) => {
    const file = byPath.get(path);
    if (!file) throw new GitRefused(`${path} has no change to ${side}`);
    return file;
  });
}

/** Paths for `--pathspec-from-file=-`, read literally (`--literal-pathspecs`). */
const pathspecs = (files: readonly WorkingFile[]) =>
  files.flatMap((f) => [...(f.previousPath ? [f.previousPath] : []), f.path]).join('\0');

async function write(repo: GitRepo, args: readonly string[], input: string): Promise<void> {
  try {
    await gitInput(repo.root, ['--literal-pathspecs', ...args], input);
  } catch (error) {
    if (error instanceof GitError) throw new GitRefused(error.stderr.trim(), { cause: error });
    throw error;
  }
}

/** Stages changed files whole (`git add --all`: a deletion and a new file too). */
export async function stageFiles(repo: GitRepo, paths: readonly string[]): Promise<void> {
  const files = listed((await workingChanges(repo)).unstaged, paths, 'stage');
  await write(
    repo,
    ['add', '--all', '--pathspec-from-file=-', '--pathspec-file-nul'],
    pathspecs(files),
  );
}

/** Unstages staged files whole, their changes kept on disk; a rename's old path too. */
export async function unstageFiles(repo: GitRepo, paths: readonly string[]): Promise<void> {
  const files = listed((await workingChanges(repo)).staged, paths, 'unstage');
  const born = await git(repo.root, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(
    () => true,
    () => false,
  );
  const args = born
    ? ['restore', '--staged', '--pathspec-from-file=-', '--pathspec-file-nul']
    : ['rm', '--cached', '-r', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'];
  await write(repo, args, pathspecs(files));
}

export interface CommitRequest {
  /** Subject, a blank line, body. Empty with `amend`: the last commit's message kept. */
  message: string;
  amend?: boolean;
}

/**
 * Commits what is staged (`POST /api/git/commit`), git's hooks run; with `amend`, as the last
 * commit again. Refused with nothing staged (unless amending) or no message, and in git's words
 * when git or a hook refuses: nothing is committed then.
 */
export async function commitStaged(
  repo: GitRepo,
  { message, amend = false }: CommitRequest,
): Promise<{ sha: string }> {
  const empty = message.trim() === '';
  if (!amend && (await workingChanges(repo)).staged.length === 0)
    throw new GitRefused('nothing is staged: stage a file to commit it');
  if (!amend && empty) throw new GitRefused('a commit needs a message');
  const args = [
    'commit',
    '--quiet',
    ...(amend ? ['--amend'] : []),
    // A line starting with "#" is the message's, not a comment.
    ...(empty ? ['--no-edit'] : ['--cleanup=whitespace', '--file=-']),
  ];
  try {
    await gitInput(repo.root, args, empty ? '' : message);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    const words = [error.stdout.trim(), error.stderr.trim()].filter(Boolean).join('\n');
    throw new GitRefused(words || 'git refused the commit', { cause: error });
  }
  return { sha: (await git(repo.root, ['rev-parse', 'HEAD'])).trim() };
}
