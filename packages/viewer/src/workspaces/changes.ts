// A workspace's changes panel (V29d): the words of its rows, pure.
import type { WorkspaceAgainst, WorkspaceCommit, WorkspaceFileChange } from '@symbiote/core';

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

/** A status in words ("modified", "in conflict"). */
export const statusWords = (status: Status): string => WORDS[status];

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

/** A file's facts: its path (both, for a rename), its status and lines. */
export function fileFacts(file: WorkspaceFileChange): string {
  const path = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
  const lines = linesOf(file);
  return [
    path,
    WORDS[file.status],
    ...(lines === null ? [] : [lines === 'binary' ? lines : `${lines.added} ${lines.removed}`]),
  ].join(' · ');
}

/** A file row's hover: its facts, what a click does. */
export const fileTitle = (file: WorkspaceFileChange): string =>
  `${fileFacts(file)}. Opens its changes in VS Code`;

/** Where the commits start: a branch's fork point, else where the workspace started. */
export const sinceText = (since: string | undefined): string =>
  since ? `since ${since}` : 'since it started';

/**
 * What a workspace can be reviewed against (V65): where it started (`''`), then every branch; a
 * picked branch that is gone last, said so (the server reviews it from where it started).
 */
export function againstOptions(against: WorkspaceAgainst): { value: string; label: string }[] {
  const started = against.from ?? against.base.slice(0, 7);
  return [
    { value: '', label: `${started}, where it started` },
    ...against.branches.map((name) => ({ value: name, label: name })),
    ...(against.against && !against.branches.includes(against.against)
      ? [{ value: against.against, label: `${against.against} (no longer a branch)` }]
      : []),
  ];
}

/** The against choice's hover: the commit Review starts at, and why there. */
export const baseTitle = (base: string, since: string | undefined): string =>
  `Review starts at ${base.slice(0, 7)}, ${since ? `its fork point with ${since}` : 'where it started'}`;

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
