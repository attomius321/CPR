import { useEffect, useMemo } from 'react';
import { workspaceGroups } from './workspaces.js';
import { HISTORY_PAGE, SETTINGS_PAGE, WORKSPACES_PAGE, type Page } from './pages.js';
import { useWorkspaces } from './useWorkspaces.js';

/**
 * Workspaces · History · Settings (V25: Workspaces first; V28b: Settings), in the bar of each
 * page; the Workspaces tab counts the workspaces that need the person. `w`, `h` and `s` go to each.
 */
export function PageTabs({ active }: { active: Page }) {
  const { list, reviews } = useWorkspaces();
  const count = useMemo(
    () => (list ? workspaceGroups(list.workspaces, reviews).needsYou.length : 0),
    [list, reviews],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      // A dialog or a menu takes its own keys (the agent's terminal is a text area).
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return;
      if (event.key === 'w' && active !== 'workspaces') window.location.assign(WORKSPACES_PAGE);
      else if (event.key === 'h' && active !== 'history') window.location.assign(HISTORY_PAGE);
      else if (event.key === 's' && active !== 'settings') window.location.assign(SETTINGS_PAGE);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
  return (
    <nav className="page-tabs" aria-label="Pages">
      <a
        href={WORKSPACES_PAGE}
        title="Workspaces (w)"
        aria-current={active === 'workspaces' ? 'page' : undefined}
      >
        Workspaces
        {count > 0 && (
          <span className="page-count" title={`${count} need${count === 1 ? 's' : ''} you`}>
            {count}
          </span>
        )}
      </a>
      <a
        href={HISTORY_PAGE}
        title="History (h)"
        aria-current={active === 'history' ? 'page' : undefined}
      >
        History
      </a>
      <a
        href={SETTINGS_PAGE}
        title="Every agent's prompts (s)"
        aria-current={active === 'settings' ? 'page' : undefined}
      >
        Settings
      </a>
    </nav>
  );
}
