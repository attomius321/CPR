import type { Graph } from '@cpr/core';

/**
 * `cpr view`'s pages and what its sidenav opens (V29a): History, Settings, a workspace or a merge,
 * and Start a workspace (V30a), each shown in the shell's main area. There is no Workspaces page since V29a: the workspaces are
 * in the sidenav, and `/` alone opens History.
 */
export type Route =
  | { page: 'history' }
  | { page: 'settings' }
  /** A workspace, at `/?branch=<branch>`: the address CPR has given out since V25. */
  | { page: 'workspace'; branch: string }
  /** A merge in CPR's queue (V26), at `/?merge=<branch>`. */
  | { page: 'merge'; branch: string }
  /** Start a workspace (V30a), at `/start`: at the default branch's tip, or at the commit `at`. */
  | { page: 'start'; at?: string };

export const HISTORY_PAGE = '/history';
export const SETTINGS_PAGE = '/settings';
export const START_PAGE = '/start';

/**
 * A window's title (N1a): what it shows, then where, then CPR — the name the taskbar, Alt+Tab
 * and the browser's tab show. Parts not known are left out.
 */
export function pageTitle(...parts: (string | undefined)[]): string {
  const known = parts.filter((part): part is string => !!part);
  return known.length > 0 ? `${known.join(' · ')} — CPR` : 'CPR';
}

/** A shell page's title: a workspace by its title (`name`) when known, else its branch. */
export function routeTitle(route: Route, repo: string | undefined, name?: string): string {
  switch (route.page) {
    case 'history':
      return pageTitle('History', repo);
    case 'settings':
      return pageTitle('Settings', repo);
    case 'workspace':
      return pageTitle(name ?? route.branch, repo);
    case 'merge':
      return pageTitle(`Merge ${route.branch}`, repo);
    case 'start':
      return pageTitle('Start a workspace', repo);
  }
}

/** A diff's revisions, `base → head`: each its ref, with its short SHA when they differ. */
export function revisionsLabel(graph: Graph): string {
  const side = (ref: string, sha: string | null) =>
    !sha ? ref : ref === sha ? sha.slice(0, 7) : `${ref} (${sha.slice(0, 7)})`;
  const { base, head } = graph.revisions;
  return `${side(base.ref, base.sha)} → ${side(head.ref, head.sha)}`;
}

/** A diff page's title: its pull or merge request, the branch it reviews, or its revisions. */
export function diffTitle(graph: Graph, reviewOf?: string): string {
  const request = graph.changeRequest;
  if (request) {
    return pageTitle(`${request.forge === 'gitlab' ? '!' : '#'}${request.number} ${request.title}`);
  }
  return pageTitle(reviewOf ? `Review of ${reviewOf}` : revisionsLabel(graph));
}

/** The old addresses of Workspaces (V18b's `/workspaces`, before it `/features`). */
const OLD_WORKSPACES = new Set(['/workspaces', '/features']);

/** The address of a route, the one `routeOf` reads back. */
export function hrefOf(route: Route): string {
  switch (route.page) {
    case 'history':
      return HISTORY_PAGE;
    case 'settings':
      return SETTINGS_PAGE;
    case 'workspace':
      return `/?branch=${encodeURIComponent(route.branch)}`;
    case 'merge':
      return `/?merge=${encodeURIComponent(route.branch)}`;
    case 'start':
      return route.at ? `${START_PAGE}?at=${encodeURIComponent(route.at)}` : START_PAGE;
  }
}

/**
 * What the shell shows at `pathname` and `search`; `moved` is the address to show instead: the root
 * alone is History, and an old address of Workspaces is today's.
 */
export function routeOf(pathname: string, search: string): { route: Route; moved?: string } {
  if (pathname === HISTORY_PAGE) return { route: { page: 'history' } };
  if (pathname === SETTINGS_PAGE) return { route: { page: 'settings' } };
  const params = new URLSearchParams(search);
  if (pathname === START_PAGE) {
    const at = params.get('at');
    return { route: at ? { page: 'start', at } : { page: 'start' } };
  }
  const branch = params.get('branch');
  const merge = params.get('merge');
  const old = OLD_WORKSPACES.has(pathname);
  if (branch) {
    const route: Route = { page: 'workspace', branch };
    return old ? { route, moved: `/${search}` } : { route };
  }
  if (merge && !old) return { route: { page: 'merge', branch: merge } };
  return { route: { page: 'history' }, moved: HISTORY_PAGE };
}

/** Whether a same-origin address is one the shell shows in place (without loading the page). */
export function inShell(url: URL): boolean {
  return (
    url.pathname === HISTORY_PAGE ||
    url.pathname === SETTINGS_PAGE ||
    url.pathname === START_PAGE ||
    url.pathname === '/' ||
    OLD_WORKSPACES.has(url.pathname)
  );
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
    const { route } = routeOf(from.pathname, from.search);
    if (route.page === 'workspace') return { href: hrefOf(route), label: 'Workspace' };
  }
  return { href: HISTORY_PAGE, label: 'History' };
}
