import type { Graph } from '@symbiote/core';

/**
 * `symbiote view`'s pages and what its sidenav opens (V29a): Git (History until V66), Nucleus (V35),
 * Skills (V41), Monitor (RM1), History (V77), Settings, a workspace or a merge, and Start a
 * workspace (V30a), each shown in the shell's main area. There is no Workspaces page since V29a: the workspaces are in the
 * sidenav, and `/` alone opens Git.
 */
export type Route =
  /** The repository's history and git's work on it (V66), at `/git`. */
  | { page: 'git' }
  /** Nucleus (V35; Scout until NU1), at `/nucleus`: the person's orchestrator in Symbiote. */
  | { page: 'nucleus' }
  /** The checkout's skills, and Scribe, at `/skills` (V41); the skill open is in `?skill=`. */
  | { page: 'skills' }
  /** Where the checkout's code is (RM1), at `/monitor`; the folder in view in `?path=`. */
  | { page: 'monitor'; path?: string }
  /**
   * History (V77), at `/workspace-history`: the finished workspaces; the one picked in `?branch=`,
   * its tab in the address too (`&brief`), which the page reads as a workspace's does.
   */
  | { page: 'workspace-history'; branch?: string }
  /**
   * Settings; `prompt`, an entry to open (SK1: the Skill library), which the page reads from its
   * address (`?prompt=`) as Skills reads `?skill=`: the route read back is Settings alone.
   */
  | { page: 'settings'; prompt?: string }
  /** A workspace, at `/?branch=<branch>`: the address Symbiote has given out since V25. */
  | { page: 'workspace'; branch: string }
  /** A merge in Symbiote's queue (V26), at `/?merge=<branch>`. */
  | { page: 'merge'; branch: string }
  /** Start a workspace (V30a), at `/start`: at the default branch's tip, or at the commit `at`. */
  | { page: 'start'; at?: string };

export const GIT_PAGE = '/git';
/** Git's address until V66, moved to `GIT_PAGE` with its query. */
const HISTORY_PAGE = '/history';
export const SETTINGS_PAGE = '/settings';
export const NUCLEUS_PAGE = '/nucleus';
/** Nucleus's address as Scout, until NU1, moved to `NUCLEUS_PAGE`. */
const SCOUT_PAGE = '/scout';
export const SKILLS_PAGE = '/skills';
export const MONITOR_PAGE = '/monitor';
/** History (V77): not `/history`, Git's address until V66, still moved to `/git`. */
export const WORKSPACE_HISTORY_PAGE = '/workspace-history';
export const START_PAGE = '/start';

/**
 * A window's title (N1a): what it shows, then where, then Symbiote — the name the taskbar, Alt+Tab
 * and the browser's tab show. Parts not known are left out.
 */
export function pageTitle(...parts: (string | undefined)[]): string {
  const known = parts.filter((part): part is string => !!part);
  return known.length > 0 ? `${known.join(' · ')} — Symbiote` : 'Symbiote';
}

/**
 * A shell page's title: a workspace by its title (`name`) when known, else its branch; History's
 * picked one too (V77); Nucleus's page by its name (`nucleus`: Alpha Ceph in Hive mode).
 */
export function routeTitle(
  route: Route,
  repo: string | undefined,
  name?: string,
  nucleus = 'Nucleus',
): string {
  switch (route.page) {
    case 'git':
      return pageTitle('Git', repo);
    case 'nucleus':
      return pageTitle(nucleus, repo);
    case 'skills':
      return pageTitle('Skills', repo);
    case 'monitor':
      return pageTitle(route.path, 'Monitor', repo);
    case 'workspace-history':
      return pageTitle(route.branch ? (name ?? route.branch) : undefined, 'History', repo);
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

/** What a diff is, without Symbiote's name (V72, its page's head): its pull or merge request, or
 * its revisions. */
export function diffName(graph: Graph): string {
  const request = graph.changeRequest;
  return request
    ? `${request.forge === 'gitlab' ? '!' : '#'}${request.number} ${request.title}`
    : revisionsLabel(graph);
}

/** A diff page's title: its pull or merge request, the branch it reviews, or its revisions. */
export function diffTitle(graph: Graph, reviewOf?: string): string {
  if (graph.changeRequest || !reviewOf) return pageTitle(diffName(graph));
  return pageTitle(`Review of ${reviewOf}`);
}

/** A diff's two pages (V60): its files, the default, and the graph. */
export type DiffView = 'files' | 'graph';

/** The page a diff's address asks for (`?view=graph`); null: the default. */
export function diffView(search: string): 'graph' | null {
  return new URLSearchParams(search).get('view') === 'graph' ? 'graph' : null;
}

/** `href` showing `view`: Graph in `?view=graph`, Files without it; the rest of it kept. */
export function withDiffView(href: string, view: DiffView): string {
  const url = new URL(href);
  if (view === 'graph') url.searchParams.set('view', 'graph');
  else url.searchParams.delete('view');
  return url.toString();
}

/** The old addresses of Workspaces (V18b's `/workspaces`, before it `/features`). */
const OLD_WORKSPACES = new Set(['/workspaces', '/features']);

/** The address of a route, the one `routeOf` reads back. */
export function hrefOf(route: Route): string {
  switch (route.page) {
    case 'git':
      return GIT_PAGE;
    case 'nucleus':
      return NUCLEUS_PAGE;
    case 'skills':
      return SKILLS_PAGE;
    case 'monitor':
      return route.path ? `${MONITOR_PAGE}?path=${encodeURIComponent(route.path)}` : MONITOR_PAGE;
    case 'workspace-history':
      return route.branch
        ? `${WORKSPACE_HISTORY_PAGE}?branch=${encodeURIComponent(route.branch)}`
        : WORKSPACE_HISTORY_PAGE;
    case 'settings':
      return route.prompt
        ? `${SETTINGS_PAGE}?prompt=${encodeURIComponent(route.prompt)}`
        : SETTINGS_PAGE;
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
 * alone is Git, History's old address is Git's, and an old address of Workspaces is today's.
 */
export function routeOf(pathname: string, search: string): { route: Route; moved?: string } {
  if (pathname === GIT_PAGE) return { route: { page: 'git' } };
  if (pathname === HISTORY_PAGE) return { route: { page: 'git' }, moved: `${GIT_PAGE}${search}` };
  if (pathname === SETTINGS_PAGE) return { route: { page: 'settings' } };
  if (pathname === NUCLEUS_PAGE) return { route: { page: 'nucleus' } };
  if (pathname === SCOUT_PAGE) return { route: { page: 'nucleus' }, moved: NUCLEUS_PAGE };
  if (pathname === SKILLS_PAGE) return { route: { page: 'skills' } };
  const params = new URLSearchParams(search);
  if (pathname === MONITOR_PAGE) {
    const path = params.get('path');
    return { route: path ? { page: 'monitor', path } : { page: 'monitor' } };
  }
  if (pathname === WORKSPACE_HISTORY_PAGE) {
    const branch = params.get('branch');
    return {
      route: branch ? { page: 'workspace-history', branch } : { page: 'workspace-history' },
    };
  }
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
  return { route: { page: 'git' }, moved: GIT_PAGE };
}

/** Whether a same-origin address is one the shell shows in place (without loading the page). */
export function inShell(url: URL): boolean {
  return (
    url.pathname === GIT_PAGE ||
    url.pathname === HISTORY_PAGE ||
    url.pathname === SETTINGS_PAGE ||
    url.pathname === NUCLEUS_PAGE ||
    url.pathname === SCOUT_PAGE ||
    url.pathname === SKILLS_PAGE ||
    url.pathname === MONITOR_PAGE ||
    url.pathname === WORKSPACE_HISTORY_PAGE ||
    url.pathname === START_PAGE ||
    url.pathname === '/' ||
    OLD_WORKSPACES.has(url.pathname)
  );
}

/**
 * A diff's way back: to the page it was opened from (`referrer`, which outlives a reload), with
 * its address — Git, a workspace, History (V77) —; else Git, where comparisons are picked.
 */
export function backLink(referrer: string, origin: string): { href: string; label: string } {
  let from: URL | null = null;
  try {
    from = new URL(referrer);
  } catch {
    // No referrer: a bookmark, a typed address.
  }
  if (from && from.origin === origin) {
    if (from.pathname === GIT_PAGE || from.pathname === HISTORY_PAGE) {
      return { href: `${GIT_PAGE}${from.search}`, label: 'Git' };
    }
    const { route } = routeOf(from.pathname, from.search);
    if (route.page === 'workspace') return { href: hrefOf(route), label: 'Workspace' };
    if (route.page === 'workspace-history') {
      return { href: `${from.pathname}${from.search}`, label: 'History' };
    }
  }
  return { href: GIT_PAGE, label: 'Git' };
}
