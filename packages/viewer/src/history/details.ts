// Git's details pane and header in words (V66): where the pane goes, a file's lines, the
// changes and a commit's problem, the branch against its upstream, a search's next match. Pure,
// but for the pane's place, kept in this browser as the theme is.
import { useSyncExternalStore } from 'react';
import type { LineCount, SyncState, WorkingChanges } from '@symbiote/core';

/** Where a commit's details show: beside the rows (the default) or under them. */
export type DetailsPlace = 'right' | 'below';

/** Where the choice is kept (Settings → Appearance). */
export const DETAILS_KEY = 'symbiote.viewer.details';

export function placeOf(stored: string | null): DetailsPlace {
  return stored === 'below' ? 'below' : 'right';
}

const listeners = new Set<() => void>();

function stored(): DetailsPlace {
  try {
    return placeOf(window.localStorage.getItem(DETAILS_KEY));
  } catch {
    return 'right';
  }
}

/** Keeps the pane's place for this browser's pages. */
export function setDetailsPlace(place: DetailsPlace): void {
  try {
    window.localStorage.setItem(DETAILS_KEY, place);
  } catch {
    // Storage blocked: the choice is not kept.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => event.key === DETAILS_KEY && listener();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The pane's place, followed when Settings (or another tab) changes it. */
export function useDetailsPlace(): DetailsPlace {
  return useSyncExternalStore(subscribe, stored);
}

/** A file with git's lines: `added`/`removed`, or `binary` where git counts none. */
export type WithLines<File> = File & { added?: number; removed?: number; binary?: true };

/** Each file with its count from `lines` (by path); one git did not count stays as it is. */
export function withLines<File extends { path: string }>(
  files: readonly File[],
  lines: readonly LineCount[],
): WithLines<File>[] {
  const byPath = new Map(lines.map((line) => [line.path, line]));
  return files.map((file) => {
    const count = byPath.get(file.path);
    if (!count) return file;
    if (count.added === null || count.removed === null) return { ...file, binary: true as const };
    return { ...file, added: count.added, removed: count.removed };
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The uncommitted row's words: how many files, how many staged, an operation in progress. */
export function changesSummary({ staged, unstaged, operation }: WorkingChanges): string {
  const files = new Set([...staged, ...unstaged].map((f) => f.path)).size;
  return [
    ...(files > 0 || !operation ? [plural(files, 'file')] : []),
    ...(staged.length > 0 ? [`${staged.length} staged`] : []),
    ...(operation ? [`a ${operation} in progress`] : []),
  ].join(' · ');
}

/** Why Commit is off: nothing staged, or no message (an amend may keep the last). */
export function commitProblem(message: string, staged: number, amend: boolean): string | null {
  if (amend) return null;
  if (staged === 0) return 'Stage a file to commit it';
  if (message.trim() === '') return 'Write a message';
  return null;
}

/** The branch against its upstream, for the header's Pull and Push. */
export function syncWords(state: SyncState): string {
  const { branch, upstream, ahead, behind, gone, remotes } = state;
  if (!branch) return 'HEAD is detached';
  if (!upstream) {
    const remote = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null;
    return remote
      ? `${branch} has no upstream: Push sets ${remote}/${branch}`
      : `${branch} has no upstream, and there is no remote`;
  }
  if (gone) return `${upstream} is gone from its remote`;
  if (ahead === 0 && behind === 0) return `Up to date with ${upstream}`;
  const parts = [
    ...(ahead > 0 ? [`${ahead} to push`] : []),
    ...(behind > 0 ? [`${behind} to pull`] : []),
  ];
  return `${parts.join(', ')}, against ${upstream}`;
}

/** The match after (or before) row `from`, round the ends; null without matches. */
export function nextMatch(rows: readonly number[], from: number, forward: boolean): number | null {
  if (rows.length === 0) return null;
  if (forward) return rows.find((row) => row > from) ?? (rows[0] as number);
  return [...rows].reverse().find((row) => row < from) ?? (rows[rows.length - 1] as number);
}

/**
 * The file shown in the rows' place (V70): one of a commit's files, or an uncommitted one on its
 * side (`staged`).
 */
export interface ShownFile {
  path: string;
  staged?: boolean;
}

const same = (a: ShownFile, b: ShownFile) => a.path === b.path && a.staged === b.staged;

/** The uncommitted files as the pane lists them: the staged ones, then the rest. */
export function changesOrder({ staged, unstaged }: WorkingChanges): ShownFile[] {
  return [
    ...staged.map(({ path }) => ({ path, staged: true })),
    ...unstaged.map(({ path }) => ({ path, staged: false })),
  ];
}

/** The file `step` from `shown` in `files` (j/k), staying at the ends as the Files page does. */
export function stepShown(files: readonly ShownFile[], shown: ShownFile, step: 1 | -1): ShownFile {
  const at = files.findIndex((file) => same(file, shown));
  if (at < 0) return shown;
  return files[Math.min(files.length - 1, Math.max(0, at + step))] ?? shown;
}

/**
 * The uncommitted file shown, after the changes are read again: on its side while listed there,
 * else on the other (staged or unstaged), else none.
 */
export function followShown(changes: WorkingChanges, shown: ShownFile): ShownFile | null {
  const on = (staged: boolean) =>
    (staged ? changes.staged : changes.unstaged).some((file) => file.path === shown.path);
  const staged = shown.staged === true;
  if (on(staged)) return shown;
  return on(!staged) ? { path: shown.path, staged: !staged } : null;
}

/**
 * The cursor's row once the page lists anew in place (decision 634): the uncommitted row (−1)
 * stays; a cursor on HEAD with no file shown follows HEAD; else its commit's new row (`kept`),
 * or HEAD's when the listing no longer has it.
 */
export function rowAfterListing({
  cursor,
  wasHead,
  shown,
  kept,
  head,
}: {
  cursor: number;
  wasHead: boolean;
  shown: boolean;
  kept: number | null;
  head: number | null;
}): number {
  if (cursor < 0) return cursor;
  if (wasHead && !shown && head !== null) return head;
  return kept ?? head ?? 0;
}
