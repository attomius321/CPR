import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceStart } from '@symbiote/core';
import { HistoryPage } from '../history/HistoryPage.js';
import { keyIsTaken } from '../ui/keys.js';
import { MergeView } from '../workspaces/Merge.js';
import {
  HISTORY_PAGE,
  MONITOR_PAGE,
  SCOUT_PAGE,
  SETTINGS_PAGE,
  SKILLS_PAGE,
  hrefOf,
  inShell,
  routeOf,
  routeTitle,
  type Route,
} from './pages.js';
import { ScoutPage } from '../scout/ScoutPage.js';
import { SettingsPage } from '../settings/SettingsPage.js';
import { SkillsPage } from '../skills/SkillsPage.js';
import { MonitorPage } from '../monitor/MonitorPage.js';
import { StartPage } from '../workspaces/StartPage.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { desktop } from './desktop.js';
import {
  ShellContext,
  type LeaveGuard,
  type Notice,
  type Shell as ShellApi,
} from './shell-context.js';
import { DrawerStrip, Sidenav, useSidenavWidth } from './Sidenav.js';
import { StatusBar } from './StatusBar.js';
import { AskBar } from './AskBar.js';
import { TitleBar, TitleBarSlotsProvider, type TitleBarSlots } from './TitleBar.js';
import { WorkspaceView } from '../workspaces/Workspace.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { startedNotice, workspaceName } from '../workspaces/workspaces.js';

const FOLD_KEY = 'symbiote.viewer.sidenav';
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

/**
 * `symbiote view`'s window (V29a): the sidenav (the pages, then the workspaces), the main area with
 * what is picked — History, Scout, Settings, a workspace, a merge or Start a workspace —, and the status
 * bar. Going from
 * one to another happens in place: the address changes, the page does not load again.
 */
export function Shell({ repo }: { repo?: string | undefined }) {
  const [route, setRoute] = useState<Route>(routeHere);
  // Bumped with every navigation: a page shown again reads its address anew (History's ?branch=).
  const [visit, setVisit] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [folded, setFolded] = useState(loadFolded);
  const sidenav = useSidenavWidth(folded);
  const [drawer, setDrawer] = useState(false);
  // A page's question before it is left (Settings with unsaved prompts), and the address shown.
  const guard = useRef<LeaveGuard | null>(null);
  const shownAt = useRef(window.location.href);
  const setLeaveGuard = useCallback((next: LeaveGuard | null) => {
    guard.current = next;
  }, []);
  // The question asked now, in Symbiote's own dialog (N1c), and where leaving goes.
  const [asking, setAsking] = useState<{ guard: LeaveGuard; leave: () => void } | null>(null);
  const [slots, setSlots] = useState<TitleBarSlots | null>(null);

  /** Shows the address `href` (one `routeOf` reads) in place, with a new history entry. */
  const go = useCallback((href: string, replace = false) => {
    const url = new URL(href, window.location.origin);
    const { route: next, moved } = routeOf(url.pathname, url.search);
    const shown = moved ?? `${url.pathname}${url.search}${url.hash}`;
    const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    setDrawer(false);
    // The address shown already: nothing to do (h on History lists nothing anew).
    if (shown === here && !replace) return;
    if (guard.current) {
      setAsking({ guard: guard.current, leave: () => go(href, replace) });
      guard.current = null;
      return;
    }
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

  // The title bar's fold button (N1c): narrow, the sidenav is a drawer, which it opens.
  const foldOrOpen = useCallback(() => {
    if (window.matchMedia(NARROW).matches) setDrawer((open) => !open);
    else fold();
  }, [fold]);

  // A start takes the start page's place in the history: Back goes to the page before it (V30a).
  const started = useCallback(
    (start: WorkspaceStart) => {
      setNotice(startedNotice(start));
      setFlashed(start.workspace.branch);
      navigate({ page: 'workspace', branch: start.workspace.branch }, { replace: true });
    },
    [navigate],
  );
  const startWorkspace = useCallback(
    (sha?: string) => navigate({ page: 'start', ...(sha ? { at: sha } : {}) }),
    [navigate],
  );
  // Leaving the start page: back to the page of Symbiote's it was opened from, else History.
  const leaveStart = useCallback(() => {
    const here = window.navigation?.currentEntry;
    const before = here ? window.navigation?.entries()[here.index - 1] : undefined;
    if (before?.url && new URL(before.url).origin === window.location.origin) window.history.back();
    else navigate({ page: 'history' }, { replace: true });
  }, [navigate]);

  // Back and Forward: the route at the address.
  useEffect(() => {
    const onPop = () => {
      // Asked first: the address left comes back until the person chooses to leave.
      if (guard.current) {
        const left = window.location.href;
        window.history.pushState(null, '', shownAt.current);
        setAsking({ guard: guard.current, leave: () => go(left) });
        guard.current = null;
        return;
      }
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

  // h and s go to the pages, a to Scout (V35; on its page, to its question or its terminal), i to
  // Skills (V41), m to the Monitor (RM1), w to
  // the workspaces (the arrows between them), n starts one (on its page, back to its title), [
  // folds the sidenav. Attached before the first paint, as History's keys are: a key pressed as
  // soon as the page shows is not lost.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (keyIsTaken(event)) return;
      if (event.key === 'h') go(HISTORY_PAGE);
      else if (event.key === 's') go(SETTINGS_PAGE);
      else if (event.key === 'i') go(SKILLS_PAGE);
      else if (event.key === 'm') go(MONITOR_PAGE);
      else if (event.key === 'a') {
        const box = document.querySelector<HTMLElement>('.scout-page textarea');
        if (box) box.focus();
        else go(SCOUT_PAGE);
      } else if (event.key === 'n') {
        const title = document.querySelector<HTMLElement>('.start-page input[name="title"]');
        if (title) title.focus();
        else startWorkspace();
      } else if (event.key === '[') fold();
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
  }, [go, fold, startWorkspace]);

  const shell = useMemo<ShellApi>(
    () => ({ route, navigate, notify, startWorkspace, setLeaveGuard }),
    [route, navigate, notify, startWorkspace, setLeaveGuard],
  );

  return (
    <ShellContext.Provider value={shell}>
      <div
        className={`shell${folded ? ' folded' : ''}${drawer ? ' drawer-open' : ''}${sidenav.resizing ? ' resizing' : ''}`}
        style={sidenav.style}
      >
        {desktop && (
          <TitleBar
            repo={repo}
            folded={folded}
            onFold={foldOrOpen}
            label={
              route.page === 'settings'
                ? 'Settings'
                : route.page === 'scout'
                  ? 'Scout'
                  : route.page === 'skills'
                    ? 'Skills'
                    : route.page === 'monitor'
                      ? 'Monitor'
                      : route.page === 'merge'
                        ? `Merge ${route.branch}`
                        : route.page === 'start'
                          ? 'Start a workspace'
                          : undefined
            }
            onSlots={setSlots}
          />
        )}
        <DrawerStrip open={drawer} onToggle={() => setDrawer((open) => !open)} />
        <Sidenav repo={repo} folded={folded} onFold={fold} flashed={flashed} />
        {sidenav.handle}
        <TitleBarSlotsProvider value={slots}>
          <main className="shell-main">
            {route.page === 'history' && <HistoryPage key={visit} />}
            {route.page === 'scout' && <ScoutPage />}
            {route.page === 'skills' && <SkillsPage />}
            {route.page === 'monitor' && <MonitorPage path={route.path} />}
            {route.page === 'settings' && <SettingsPage />}
            {route.page === 'workspace' && (
              <WorkspaceView key={route.branch} branch={route.branch} />
            )}
            {route.page === 'merge' && <MergeView key={route.branch} branch={route.branch} />}
            {route.page === 'start' && (
              <StartPage at={route.at} onStarted={started} onLeave={leaveStart} />
            )}
          </main>
        </TitleBarSlotsProvider>
        <StatusBar notice={notice} />
        <AskBar />
        <WindowTitle route={route} repo={repo} />
        {asking && (
          <ConfirmDialog
            question={asking.guard.question}
            detail={asking.guard.detail}
            leave="Leave"
            onLeave={() => {
              setAsking(null);
              asking.leave();
            }}
            onStay={() => {
              guard.current = asking.guard;
              setAsking(null);
            }}
          />
        )}
      </div>
    </ShellContext.Provider>
  );
}

/**
 * The window's title (N1a): the page, a workspace by its title, then the repository. Its own
 * component: a new read of the workspaces renders it alone, not the shell.
 */
function WindowTitle({ route, repo }: { route: Route; repo: string | undefined }) {
  const { list } = useWorkspaces();
  const picked =
    route.page === 'workspace'
      ? list?.workspaces.find((workspace) => workspace.branch === route.branch)
      : undefined;
  const name = picked ? workspaceName(picked) : undefined;
  useEffect(() => {
    document.title = routeTitle(route, repo, name);
  }, [route, repo, name]);
  return null;
}
