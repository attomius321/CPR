// The pick (NX5, decision 913): there is always one while the list has rows, kept by its path and
// its place when the list is drawn again (NX6: a path may be listed twice), moved by the keys; its
// card's kind. Pure: the DOM is `main.ts`'s.
import type { Row } from './search.js';

/** A pick: a row's path and its place in the list (a path may be listed twice, decision 926). */
export interface Pick {
  path: string;
  at: number;
  /** Which of the rows of its path it is: 1 for the second (in the tree, under Running). */
  nth?: number;
}

/** The pick of the row at `at`, with which of its path's rows it is. */
function pickAt(rows: readonly { path: string }[], at: number): Pick | null {
  const row = rows[at];
  if (!row) return null;
  const nth = rows.slice(0, at).filter((other) => other.path === row.path).length;
  return { path: row.path, at, ...(nth > 0 ? { nth } : {}) };
}

/**
 * The pick after the list is drawn again: the same row (the same of its path's rows), else the
 * last of its path's, else the one now at its place, else the first.
 */
export function keptPick(rows: readonly { path: string }[], previous: Pick | null): Pick | null {
  if (rows.length === 0) return null;
  if (previous) {
    const places = rows.flatMap((row, n) => (row.path === previous.path ? [n] : []));
    const place = places[previous.nth ?? 0] ?? places.at(-1);
    if (place !== undefined) return pickAt(rows, place);
  }
  return pickAt(rows, previous ? Math.min(previous.at, rows.length - 1) : 0);
}

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };

/** The pick after a key: ↑↓ by one, Page Up and Down by ten, stopping at the ends. */
export function movedPick(
  rows: readonly { path: string }[],
  current: Pick | null,
  key: string,
): Pick | null {
  if (rows.length === 0) return null;
  const from =
    current === null
      ? -1
      : rows[current.at]?.path === current.path
        ? current.at
        : rows.findIndex((row) => row.path === current.path);
  return pickAt(
    rows,
    from < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, from + (STEPS[key] ?? 0))),
  );
}

export type CardKind =
  'none' | 'running' | 'repository' | 'starting' | 'failed' | 'folder' | 'gone';

/** What the picked row's card shows. */
export function cardKind(
  row: Row | null,
  { starting = false, failed = null }: { starting?: boolean; failed?: string | null },
): CardKind {
  if (!row) return 'none';
  if (!row.repository) return row.missing ? 'gone' : 'folder';
  if (row.tab) return 'running';
  if (starting) return 'starting';
  return failed ? 'failed' : 'repository';
}
