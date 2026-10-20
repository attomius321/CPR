import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { WorkspaceStart } from '@cpr/core';
import { hrefOf, type Route } from './pages.js';
import { ShellContext, type Notice, type Shell } from './shell-context.js';
import { Sidenav } from './Sidenav.js';
import { StatusBar } from './StatusBar.js';
import { useWorkspaceStarter } from './WorkspaceStarter.js';

const FOLD_KEY = 'cpr.viewer.sidenav.diff';

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
  const started = useCallback(
    (start: WorkspaceStart) => navigate({ page: 'workspace', branch: start.workspace.branch }),
    [navigate],
  );
  const failed = useCallback((message: string) => setNotice({ text: message, error: true }), []);
  const starter = useWorkspaceStarter(started, failed);

  // [ folds and opens the sidenav; the diff's own keys are the rest.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '[' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      event.preventDefault();
      fold();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fold]);

  const shell = useMemo<Shell>(
    () => ({
      route: null,
      navigate,
      notify: setNotice,
      startWorkspace: starter.open,
      starting: starter.isOpen,
      // Nothing on a diff's page is left unsaved: its review state saves as it goes.
      setLeaveGuard: () => {},
    }),
    [navigate, starter.open, starter.isOpen],
  );
  return (
    <ShellContext.Provider value={shell}>
      <div className={`shell diff-shell${folded ? ' folded' : ''}`}>
        <Sidenav repo={repo} folded={folded} onFold={fold} flashed={null} />
        <div className="shell-main">{children}</div>
        <StatusBar notice={notice} />
        {starter.dialog}
      </div>
    </ShellContext.Provider>
  );
}
