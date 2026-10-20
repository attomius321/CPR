/**
 * `cpr view`'s pages: Workspaces first, at `/`, the repository's History (V25), and Settings,
 * every agent's prompts (V28b).
 */
export type Page = 'workspaces' | 'history' | 'settings';

export const WORKSPACES_PAGE = '/';
export const HISTORY_PAGE = '/history';
export const SETTINGS_PAGE = '/settings';

/** The old addresses of Workspaces (V18b's `/workspaces`, before it `/features`). */
const OLD_WORKSPACES = new Set(['/workspaces', '/features']);

/**
 * The page at `pathname` under `cpr view` with no graph there; `moved` is the address to show
 * instead, for an old one kept for bookmarks.
 */
export function pageOfPath(pathname: string): { page: Page; moved?: string } {
  if (pathname === HISTORY_PAGE) return { page: 'history' };
  if (pathname === SETTINGS_PAGE) return { page: 'settings' };
  if (OLD_WORKSPACES.has(pathname)) return { page: 'workspaces', moved: WORKSPACES_PAGE };
  return { page: 'workspaces' };
}

/**
 * A diff's way back: to the page it was opened from (`referrer`, which outlives a reload), with
 * its address; else History, where comparisons are picked.
 */
export function backLink(referrer: string, origin: string): { href: string; label: string } {
  let from: URL | null = null;
  try {
    from = new URL(referrer);
  } catch {
    // No referrer: a bookmark, a typed address.
  }
  if (from && from.origin === origin) {
    if (from.pathname === HISTORY_PAGE) {
      return { href: `${HISTORY_PAGE}${from.search}`, label: 'History' };
    }
    if (from.pathname === WORKSPACES_PAGE || OLD_WORKSPACES.has(from.pathname)) {
      return { href: `${WORKSPACES_PAGE}${from.search}`, label: 'Workspaces' };
    }
  }
  return { href: HISTORY_PAGE, label: 'History' };
}
