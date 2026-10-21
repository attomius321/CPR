// A workspace's changes panel (V29d): the words of its rows, pure.
import type { WorkspaceCommit, WorkspaceFileChange } from '@symbiote/core';

type Status = WorkspaceFileChange['status'];

/** The letter VS Code's source control gives each status. */
const LETTERS: Record<Status, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
  untracked: 'U',
  conflicted: '!',
};

const WORDS: Record<Status, string> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
  copied: 'copied',
  'type-changed': 'type changed',
  untracked: 'new, not tracked by git yet',
  conflicted: 'in conflict',
};

export const statusLetter = (status: Status): string => LETTERS[status];

/** A path's file name, and the folder it is in ('' at the root). */
export function splitPath(path: string): { name: string; folder: string } {
  const at = path.lastIndexOf('/');
  return at < 0
    ? { name: path, folder: '' }
    : { name: path.slice(at + 1), folder: path.slice(0, at) };
}

/** A file's lines as the row shows them; `binary`, or null when git has not counted them. */
export function linesOf(
  file: WorkspaceFileChange,
): { added: string; removed: string } | 'binary' | null {
  if (file.binary) return 'binary';
  if (file.added === undefined || file.removed === undefined) return null;
  return { added: `+${file.added}`, removed: `−${file.removed}` };
}

/** A deleted file has nothing to open. */
export const opensInEditor = (file: WorkspaceFileChange): boolean => file.status !== 'deleted';

/** A file row's hover: its path (both, for a rename), its status and lines, what a click does. */
export function fileTitle(file: WorkspaceFileChange): string {
  const path = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
  const lines = linesOf(file);
  const facts = [
    path,
    WORDS[file.status],
    ...(lines === null ? [] : [lines === 'binary' ? lines : `${lines.added} ${lines.removed}`]),
  ].join(' · ');
  if (!opensInEditor(file)) return facts;
  return `${facts}. Opens in VS Code${file.status === 'untracked' ? '' : ' at its first change'}`;
}

/** Where the commits start: the default branch's fork point, else where the workspace started. */
export const sinceText = (since: string | undefined): string =>
  since ? `since ${since}` : 'since it started';

/** What a list leaves out. */
export const moreText = (count: number, listed: number): string | null =>
  count > listed ? `and ${count - listed} more` : null;

/** A commit row's hover: its short SHA and subject, its author and date. */
export function commitTitle(commit: WorkspaceCommit): string {
  const date = new Date(commit.date).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return `${commit.sha.slice(0, 7)} ${commit.subject}\n${commit.author}, ${date}`;
}
