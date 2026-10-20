import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceStart } from '@cpr/core';
import { HistoryPage } from './HistoryPage.js';
import { MenuIcon } from './icons.js';
import { MergeView } from './Merge.js';
import { HISTORY_PAGE, SETTINGS_PAGE, hrefOf, inShell, routeOf, type Route } from './pages.js';
import { SettingsPage } from './SettingsPage.js';
import { ShellContext, type Notice, type Shell as ShellApi } from './shell-context.js';
import { Sidenav } from './Sidenav.js';
import { StatusBar } from './StatusBar.js';
import { WorkspaceView } from './Workspace.js';
import { startedNotice } from './workspaces.js';
import { useWorkspaceStarter } from './WorkspaceStarter.js';

const FOLD_KEY = 'cpr.viewer.sidenav';
/** Under this width the sidenav is a drawer over the page (styles.css says the same). */
const NARROW = '(max-width: 899px)';

/** Whether the person folded the sidenav to a rail, kept in this browser. */
function loadFolded(): boolean {
  try {
    return window.localStorage.getItem(FOLD_KEY) === 'rail';
  } catch {
    return false;
  }
}

function saveFolded(folded: boolean): void {
  try {
    window.localStorage.setItem(FOLD_KEY, folded ? 'rail' : 'open');
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/** The route at the address, an old or bare one shown as today's (without a new entry). */
function routeHere(): Route {
  const { pathname, search, hash } = window.location;
  const { route, moved } = routeOf(pathname, search);
  if (moved) window.history.replaceState(null, '', `${moved}${hash}`);
  return route;
}

const sameRoute = (a: Route, b: Route) => hrefOf(a) === hrefOf(b);

/** Keys the shell leaves alone: typing, a dialog's or a menu's, the agent's terminal's. */
function keyIsTaken(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
    return true;
  return document.querySelector('[aria-modal="true"], [role="menu"]') !== null;
}

/**
 * `cpr view`'s window (V29a): the sidenav (the pages, then the workspaces), the main area with
 * what is picked — History, Settings, a workspace or a merge —, and the status bar. Going from
 * one to another happens in place: the address changes, the page does not load again.
 */
export function Shell({ repo }: { repo?: string | undefined }) {
  const [route, setRoute] = useState<Route>(routeHere);
  // Bumped with every navigation: a page shown again reads its address anew (History's ?branch=).
  const [visit, setVisit] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [folded, setFolded] = useState(loadFolded);
  const [drawer, setDrawer] = useState(false);
  // A page's question before it is left (Settings with unsaved prompts), and the address shown.
  const guard = useRef<string | null>(null);
  const shownAt = useRef(window.location.href);
  const setLeaveGuard = useCallback((question: string | null) => {
    guard.current = question;
  }, []);

  /** Shows the address `href` (one `routeOf` reads) in place, with a new history entry. */
  const go = useCallback((href: string, replace = false) => {
    const url = new URL(href, window.location.origin);
    const { route: next, moved } = routeOf(url.pathname, url.search);
    const shown = moved ?? `${url.pathname}${url.search}${url.hash}`;
    const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    setDrawer(false);
    // The address shown already: nothing to do (h on History lists nothing anew).
    if (shown === here && !replace) return;
    if (guard.current && !window.confirm(guard.current)) return;
    guard.current = null;
    if (replace) window.history.replaceState(null, '', shown);
    else window.history.pushState(null, '', shown);
    setRoute((current) => (sameRoute(current, next) && shown === here ? current : next));
    setVisit((n) => n + 1);
    shownAt.current = window.location.href;
  }, []);
  const navigate = useCallback(
    (next: Route, options?: { replace?: boolean }) => go(hrefOf(next), options?.replace),
    [go],
  );
  const notify = useCallback((next: Notice | null) => setNotice(next), []);
  const fold = useCallback(
    () =>
      setFolded((current) => {
        saveFolded(!current);
        return !current;
      }),
    [],
  );

  const started = useCallback(
    (start: WorkspaceStart) => {
      setNotice(startedNotice(start));
      setFlashed(start.workspace.branch);
      navigate({ page: 'workspace', branch: start.workspace.branch });
    },
    [navigate],
  );
  const failed = useCallback((message: string) => setNotice({ text: message, error: true }), []);
  const starter = useWorkspaceStarter(started, failed);
  const startWorkspace = starter.open;

  // Back and Forward: the route at the address.
  useEffect(() => {
    const onPop = () => {
      // Asked first; staying puts back the address left.
      if (guard.current && !window.confirm(guard.current)) {
        window.history.pushState(null, '', shownAt.current);
        return;
      }
      guard.current = null;
      shownAt.current = window.location.href;
      const next = routeHere();
      setRoute((current) => (sameRoute(current, next) ? current : next));
      setVisit((n) => n + 1);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // A link to a page of the shell (the sidenav's, a branch's mark, a card's branch) opens in
  // place. Caught before the page's own handlers, which only stop it reaching the row it is in.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target ||
        anchor.hasAttribute('download')
      )
        return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin || !inShell(url)) return;
      event.preventDefault();
      go(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [go]);

  // h and s go to the pages, w to the workspaces (the arrows between them), n starts one, [ folds
  // the sidenav. Attached before the first paint, as History's keys are: a key pressed as soon as
  // the page shows is not lost.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (keyIsTaken(event) || starter.isOpen) return;
      if (event.key === 'h') go(HISTORY_PAGE);
      else if (event.key === 's') go(SETTINGS_PAGE);
      else if (event.key === 'n') startWorkspace();
      else if (event.key === '[') fold();
      else if (event.key === 'w') {
        const card = document.querySelector<HTMLElement>('.sidenav .workspace-about');
        if (!card) return;
        if (window.matchMedia(NARROW).matches) setDrawer(true);
        requestAnimationFrame(() => card.focus());
      } else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, fold, startWorkspace, starter.isOpen]);

  const shell = useMemo<ShellApi>(
    () => ({
      route,
      navigate,
      notify,
      startWorkspace,
      starting: starter.isOpen,
      setLeaveGuard,
    }),
    [route, navigate, notify, startWorkspace, starter.isOpen, setLeaveGuard],
  );

  return (
    <ShellContext.Provider value={shell}>
      <div className={`shell${folded ? ' folded' : ''}${drawer ? ' drawer-open' : ''}`}>
        <header className="shell-top">
          <button
            type="button"
            className="icon-button"
            aria-label={drawer ? 'Close the sidenav' : 'Open the sidenav'}
            aria-expanded={drawer}
            onClick={() => setDrawer((open) => !open)}
          >
            <MenuIcon />
          </button>
          <strong className="brand">CPR</strong>
        </header>
        <Sidenav repo={repo} folded={folded} onFold={fold} flashed={flashed} />
        {drawer && (
          <div className="shell-scrim" aria-hidden="true" onClick={() => setDrawer(false)} />
        )}
        <main className="shell-main">
          {route.page === 'history' && <HistoryPage key={visit} />}
          {route.page === 'settings' && <SettingsPage />}
          {route.page === 'workspace' && <WorkspaceView key={route.branch} branch={route.branch} />}
          {route.page === 'merge' && <MergeView key={route.branch} branch={route.branch} />}
        </main>
        <StatusBar notice={notice} />
        {starter.dialog}
      </div>
    </ShellContext.Provider>
  );
}
