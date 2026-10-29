// History (V77): the finished workspaces as the page lists them — by the day they finished,
// searched, what became of each branch and how long each ran, in words — and the picked one's tab
// in the address. Pure: `WorkspaceHistory.tsx` draws what these say.
import type { FinishedWorkspace, WorkKind } from '@symbiote/core';

/** The kinds in the start page's order (core's `WORK_KINDS`, which the viewer cannot import). */
const KINDS: readonly WorkKind[] = ['feature', 'fix', 'refactor', 'chore', 'spike'];

/** What became of a finished workspace's branch, in words (decision 565). */
export function outcomeText(workspace: FinishedWorkspace): string {
  if (workspace.outcome === 'merged') {
    return workspace.into ? `Merged into ${workspace.into}` : 'Merged';
  }
  return workspace.outcome === 'kept' ? 'Branch kept' : 'Not merged';
}

/** The same, short, for a row of the list: the default branch's name is the card's to say. */
export function outcomeWord(workspace: FinishedWorkspace): string {
  if (workspace.outcome === 'merged') return 'Merged';
  return workspace.outcome === 'kept' ? 'Branch kept' : 'Not merged';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * How long a workspace ran, from its start to its clean-up: "48 min", "2 h 10 min", "1 day 2 h",
 * "3 days"; empty when a time cannot be read or the clean-up comes first.
 */
export function ranFor(created: string, finished: string): string {
  const ms = Date.parse(finished) - Date.parse(created);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  if (days > 1) return plural(days, 'day');
  return hours % 24 === 0 ? '1 day' : `1 day ${hours % 24} h`;
}

/**
 * The rows a search keeps: each of its words in a row's title, branch or brief (case ignored),
 * and of `kind` when one is picked — a row without a kind is in none.
 */
export function matching(
  rows: readonly FinishedWorkspace[],
  query: string,
  kind: WorkKind | null,
): FinishedWorkspace[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (kind && row.kind !== kind) return false;
    if (words.length === 0) return true;
    const text = `${row.title ?? ''}\n${row.branch}\n${row.brief}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** The kinds the rows have, in the start page's order: the kind filter's choices. */
export function kindsOf(rows: readonly FinishedWorkspace[]): WorkKind[] {
  const had = new Set(rows.map((row) => row.kind));
  return KINDS.filter((kind) => had.has(kind));
}

/** A day of History's list: its rows in their order, under its label. */
export interface HistoryDay {
  key: string;
  label: string;
  rows: FinishedWorkspace[];
}

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

/**
 * The rows by the local day they finished, in their order (the newest first): "Today",
 * "Yesterday", then the date, with its year when not `now`'s.
 */
export function byDay(rows: readonly FinishedWorkspace[], now: Date): HistoryDay[] {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const days: HistoryDay[] = [];
  for (const row of rows) {
    const at = new Date(row.finished);
    const key = dayKey(at);
    const last = days.at(-1);
    if (last?.key === key) {
      last.rows.push(row);
      continue;
    }
    const label =
      key === today
        ? 'Today'
        : key === yesterday
          ? 'Yesterday'
          : at.toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
            });
    days.push({ key, label, rows: [row] });
  }
  return days;
}

/** The picked workspace's tabs (V77, decision 562), Activity first. */
export type HistoryView = 'activity' | 'thread' | 'brief' | 'changes';
export const HISTORY_VIEWS: readonly HistoryView[] = ['activity', 'thread', 'brief', 'changes'];

/** The tab an address names (`&brief`, as a workspace's); Activity without one. */
export function historyView(search: string): HistoryView {
  const params = new URLSearchParams(search);
  return HISTORY_VIEWS.find((view) => params.has(view)) ?? 'activity';
}

/** `href` showing `view`: its name after the rest of the address, none for Activity. */
export function withHistoryView(href: string, view: HistoryView): string {
  const url = new URL(href, 'http://symbiote');
  for (const each of HISTORY_VIEWS) url.searchParams.delete(each);
  const search = url.searchParams.toString();
  const tab = view === 'activity' ? '' : view;
  const query = [search, tab].filter(Boolean).join('&');
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
}
