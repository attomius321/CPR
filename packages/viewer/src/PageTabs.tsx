import { useEffect, useMemo } from 'react';
import { featureGroups } from './features.js';
import { HISTORY_PAGE, WORKSPACES_PAGE } from './pages.js';
import { useFeatures } from './useFeatures.js';

/**
 * Workspaces · History (V25: Workspaces first), in the bar of both pages; the Workspaces tab
 * counts the workspaces that need the person. `w` and `h` go to each.
 */
export function PageTabs({ active }: { active: 'commits' | 'features' }) {
  const { list, reviews } = useFeatures();
  const count = useMemo(
    () => (list ? featureGroups(list.features, reviews).needsYou.length : 0),
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
      if (event.key === 'w' && active !== 'features') window.location.assign(WORKSPACES_PAGE);
      else if (event.key === 'h' && active !== 'commits') window.location.assign(HISTORY_PAGE);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
  return (
    <nav className="page-tabs" aria-label="Pages">
      <a
        href={WORKSPACES_PAGE}
        title="Workspaces (w)"
        aria-current={active === 'features' ? 'page' : undefined}
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
        aria-current={active === 'commits' ? 'page' : undefined}
      >
        History
      </a>
    </nav>
  );
}
