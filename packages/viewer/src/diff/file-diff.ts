// The Files page's diff of one file (V60): git's diff read into rows, folded, and where a comment
// on a row goes. Pure.
import type { ReviewFile } from '@symbiote/core';
import type { Anchor, Draft } from './comments.js';
import type { DiffRow } from './detail.js';

/** A file's diff as the page draws it: its rows, a binary file, or no line at all. */
export type FileDiff = { kind: 'rows'; rows: DiffRow[] } | { kind: 'binary' } | { kind: 'none' };

/** Lines of context kept around a change, as git's hunks have them. */
export const CONTEXT = 3;

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Reads git's diff of one file (`./api/file`, the whole file as context) into rows with both line
 * numbers. Before the first hunk every line is git's header; after it, a line's first character
 * says what it is, so content that looks like a header is content. A carriage return and git's
 * "No newline at end of file" are not drawn.
 */
export function parseFileDiff(text: string): FileDiff {
  const rows: DiffRow[] = [];
  let base = 0;
  let head = 0;
  let inHunk = false;
  for (const line of text.split('\n')) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      base = Number(hunk[1]);
      head = Number(hunk[2]);
      // An empty side starts at 0: its first line, if any, is 1.
      if (base === 0) base = 1;
      if (head === 0) head = 1;
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      if (line.startsWith('Binary files ') || line === 'GIT binary patch')
        return { kind: 'binary' };
      continue;
    }
    const content = line.slice(1).replace(/\r$/, '');
    if (line.startsWith(' '))
      rows.push({ type: 'same', text: content, base: base++, head: head++ });
    else if (line.startsWith('-')) rows.push({ type: 'del', text: content, base: base++ });
    else if (line.startsWith('+')) rows.push({ type: 'add', text: content, head: head++ });
  }
  return rows.length > 0 ? { kind: 'rows', rows } : { kind: 'none' };
}

/** A row drawn, by its index in the rows; or rows folded away, `start` to `end` (exclusive). */
export type Fold =
  { kind: 'row'; row: DiffRow; index: number } | { kind: 'gap'; start: number; end: number };

/**
 * The rows to draw: each change with `context` unchanged lines around it, the rest folded. As git
 * cuts hunks, two changes at most `2 × context` lines apart stay one run. A fold in `open` (by
 * its start) is drawn, and so is each row in `pinned` (by index: one with comments).
 */
export function foldRows(
  rows: readonly DiffRow[],
  open: ReadonlySet<number>,
  context = CONTEXT,
  pinned: ReadonlySet<number> = new Set(),
): Fold[] {
  const near = rows.map((_, i) => pinned.has(i));
  rows.forEach((row, i) => {
    if (row.type === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) {
      near[j] = true;
    }
  });
  const folds: Fold[] = [];
  let i = 0;
  while (i < rows.length) {
    if (near[i]) {
      folds.push({ kind: 'row', row: rows[i] as DiffRow, index: i });
      i++;
      continue;
    }
    const start = i;
    while (i < rows.length && !near[i]) i++;
    if (open.has(start)) {
      for (let j = start; j < i; j++)
        folds.push({ kind: 'row', row: rows[j] as DiffRow, index: j });
    } else folds.push({ kind: 'gap', start, end: i });
  }
  return folds;
}

/**
 * Where a comment on `row` goes: an added line on the head side, a removed one on the base side,
 * an unchanged one on the head side when `unchanged` lines take comments (a branch review; not a
 * forge's, which takes lines of its own hunks only).
 */
export function lineAnchor(file: ReviewFile, row: DiffRow, unchanged: boolean): Anchor | null {
  const before = file.previousPath ?? file.path;
  if (row.type === 'del' && row.base !== undefined) {
    return { side: 'base', path: before, otherPath: file.path, line: row.base };
  }
  if (row.type === 'same' && !unchanged) return null;
  if (row.head === undefined) return null;
  return { side: 'head', path: file.path, otherPath: before, line: row.head };
}

/** A row's place for comments: its side and line, as {@link lineAnchor} puts them. */
export function rowKey(row: DiffRow): string {
  return row.type === 'del' ? `base:${row.base ?? 0}` : `head:${row.head ?? 0}`;
}

/** The comments on lines of `file`, by {@link rowKey}, in the order written. */
export function draftsByLine(drafts: readonly Draft[], file: ReviewFile): Map<string, Draft[]> {
  const before = file.previousPath ?? file.path;
  const byLine = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const anchor = draft.anchor;
    if (!anchor || anchor.path !== (anchor.side === 'head' ? file.path : before)) continue;
    const key = `${anchor.side}:${anchor.line}`;
    byLine.set(key, [...(byLine.get(key) ?? []), draft]);
  }
  return byLine;
}

const STATUS: Record<ReviewFile['status'], string> = {
  added: 'added',
  deleted: 'deleted',
  modified: 'modified',
  renamed: 'renamed',
  copied: 'copied',
  'type-changed': 'type changed',
};

/** What changed in a file, in words: its status (a rename's old path), binary, not analyzed. */
export function changeWords(file: ReviewFile): string {
  const status =
    file.previousPath && file.previousPath !== file.path
      ? `${STATUS[file.status]} from ${file.previousPath}`
      : STATUS[file.status];
  return [
    status,
    ...(file.binary ? ['binary'] : []),
    ...(file.ignored ? ['not analyzed'] : []),
  ].join(', ');
}

/** The file `step` rows from `path` in the list (j/k), at the list's ends staying there. */
export function stepFile(
  files: readonly ReviewFile[],
  path: string | null,
  step: 1 | -1,
): string | null {
  if (files.length === 0) return null;
  const at = files.findIndex((file) => file.path === path);
  if (at < 0) return files[0]?.path ?? null;
  return files[Math.min(files.length - 1, Math.max(0, at + step))]?.path ?? null;
}
