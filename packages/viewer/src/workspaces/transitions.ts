// When an agent moves on while the person looks elsewhere (V48): one line in the status bar, never
// a dialog; and how a card moves to its new place in the sidenav. Both pure.
import type { Notice } from '../shell/shell-context.js';
import { workspaceHref, workspaceName, type WorkspaceRow } from './workspaces.js';

/** What one transition says: "Pick a store waits for you: Asks: Which store?". */
function said(row: WorkspaceRow, before: WorkspaceRow): string | null {
  const name = workspaceName(row.workspace);
  const { next } = row;
  if (next.group === 'waiting') return `${name} waits for you: ${next.blocked ?? next.text}`;
  if (
    next.group === 'review' &&
    (before.next.group === 'working' || before.next.group === 'hive')
  ) {
    return `${name} finished: ${next.text}`;
  }
  // A failure; a stop the person asked for needs no word.
  if (next.group === 'stopped' && next.chip.tone === 'failed')
    return `${name} stopped: ${next.text}`;
  return null;
}

/**
 * What the status bar says after a read (V48): a workspace newly waiting for the person, finished
 * or failed, with a link to it — the first, and how many more. Nothing on the first read
 * (`before` null), for the workspace on screen (`shown`), for one new to the list, or for one in
 * the same group as before: a read that says the same again says nothing.
 */
export function transitionNotice(
  before: readonly WorkspaceRow[] | null,
  after: readonly WorkspaceRow[],
  shown: string | null,
): (Notice & { href: string }) | null {
  if (!before) return null;
  const was = new Map(before.map((row) => [row.workspace.branch, row]));
  const told: { text: string; branch: string }[] = [];
  for (const row of after) {
    const { branch } = row.workspace;
    const prior = was.get(branch);
    if (branch === shown || !prior || prior.next.group === row.next.group) continue;
    const text = said(row, prior);
    if (text) told.push({ text, branch });
  }
  const [first] = told;
  if (!first) return null;
  const more = told.length > 1 ? ` (and ${told.length - 1} more)` : '';
  return { text: `${first.text}${more}`, href: workspaceHref(first.branch) };
}

/** A card's move (FLIP): how far up or down it was before, or that it is new. */
export type Move = { key: string; dy: number } | { key: string; enter: true };

/**
 * How each card moved between two layouts (V48), by key: its old place less its new one, for a
 * card in both that moved; `enter` for one new. None on the first layout (`before` null).
 */
export function moves(
  before: ReadonlyMap<string, number> | null,
  after: ReadonlyMap<string, number>,
): Move[] {
  if (!before) return [];
  const found: Move[] = [];
  for (const [key, top] of after) {
    const old = before.get(key);
    if (old === undefined) found.push({ key, enter: true });
    else if (old !== top) found.push({ key, dy: old - top });
  }
  return found;
}
