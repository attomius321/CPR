// The pick (NX5, decision 913): there is always one while the list has rows, kept by its path when
// the list is drawn again, moved by the keys; its card's kind. Pure: the DOM is `main.ts`'s.
import type { Row } from './search.js';

/** The pick after the list is drawn again: the same row, else the one now at its place, else the first. */
export function keptPick(
  rows: readonly { path: string }[],
  previous: { path: string; at: number } | null,
): string | null {
  if (rows.length === 0) return null;
  if (previous && rows.some((row) => row.path === previous.path)) return previous.path;
  const at = previous ? Math.min(previous.at, rows.length - 1) : 0;
  return rows[at]?.path ?? null;
}

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };

/** The pick after a key: ↑↓ by one, Page Up and Down by ten, stopping at the ends. */
export function movedPick(
  rows: readonly { path: string }[],
  current: string | null,
  key: string,
): string | null {
  if (rows.length === 0) return null;
  const at = rows.findIndex((row) => row.path === current);
  if (at < 0) return rows[0]?.path ?? null;
  const step = STEPS[key] ?? 0;
  return rows[Math.max(0, Math.min(rows.length - 1, at + step))]?.path ?? null;
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
