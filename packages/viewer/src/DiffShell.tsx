import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { hrefOf, type Route } from './pages.js';
import { ShellContext, type Notice, type Shell } from './shell-context.js';
import { DrawerStrip, Sidenav } from './Sidenav.js';
import { desktop } from './desktop.js';
import { StatusBar } from './StatusBar.js';
import { TitleBar } from './TitleBar.js';

const FOLD_KEY = 'cpr.viewer.sidenav.diff';

/** A diff's page puts nothing in the title bar: its own bar, under it, has its parts. */
const noSlots = () => {};

/** On a diff the sidenav starts as a rail (decision 182): the canvas keeps its width. */
function loadFolded(): boolean {
  try {
    return window.localStorage.getItem(FOLD_KEY) !== 'open';
  } catch {
    return true;
  }
}

function saveFolded(folded: boolean): void {
  try {
    window.localStorage.setItem(FOLD_KEY, folded ? 'rail' : 'open');
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/**
 * A diff's page under `cpr view` (V29a): the shell's sidenav, as a rail unless the person opens
 * it, and its status bar around the diff. A diff is its own document (`/diff/<pair>/`), so a page
 * or a workspace picked here loads the shell.
 */
export function DiffShell({ repo, children }: { repo?: string | undefined; children: ReactNode }) {
  const [folded, setFolded] = useState(loadFolded);
  // Under 900 px the sidenav is a drawer, opened from the strip at the top (V29b).
  const [drawer, setDrawer] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const fold = useCallback(
    () =>
      setFolded((current) => {
        saveFolded(!current);
        return !current;
      }),
    [],
  );
  const navigate = useCallback((route: Route) => window.location.assign(hrefOf(route)), []);
  // Start a workspace is the shell's page (V30a): a diff is its own document, so it loads it.
  const startWorkspace = useCallback(
    (sha?: string) => navigate({ page: 'start', ...(sha ? { at: sha } : {}) }),
    [navigate],
  );

  // [ folds and opens the sidenav, n starts a workspace; the diff's own keys are the rest.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.key !== '[' && event.key !== 'n') ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      event.preventDefault();
      if (event.key === 'n') startWorkspace();
      else fold();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fold, startWorkspace]);

  const shell = useMemo<Shell>(
    () => ({
      route: null,
      navigate,
      notify: setNotice,
      startWorkspace,
      // Nothing on a diff's page is left unsaved: its review state saves as it goes.
      setLeaveGuard: () => {},
    }),
    [navigate, startWorkspace],
  );
  return (
    <ShellContext.Provider value={shell}>
      <div className={`shell diff-shell${folded ? ' folded' : ''}${drawer ? ' drawer-open' : ''}`}>
        {desktop && (
          <TitleBar
            repo={repo}
            folded={folded}
            onFold={() =>
              window.matchMedia('(max-width: 899px)').matches ? setDrawer((open) => !open) : fold()
            }
            onSlots={noSlots}
          />
        )}
        <DrawerStrip open={drawer} onToggle={() => setDrawer((open) => !open)} />
        <Sidenav repo={repo} folded={folded} onFold={fold} flashed={null} />
        <div className="shell-main">{children}</div>
        <StatusBar notice={notice} />
      </div>
    </ShellContext.Provider>
  );
}
