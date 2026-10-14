import { useMemo } from 'react';
import { featureGroups } from './features.js';
import { useFeatures } from './useFeatures.js';

/**
 * Commits · Features (V18b), in the bar of both pages; the Features tab counts the features that
 * need the person.
 */
export function PageTabs({ active }: { active: 'commits' | 'features' }) {
  const { list, reviews } = useFeatures();
  const count = useMemo(
    () => (list ? featureGroups(list.features, reviews).needsYou.length : 0),
    [list, reviews],
  );
  return (
    <nav className="page-tabs" aria-label="Pages">
      <a href="/" aria-current={active === 'commits' ? 'page' : undefined}>
        Commits
      </a>
      <a href="/features" aria-current={active === 'features' ? 'page' : undefined}>
        Features
        {count > 0 && (
          <span className="page-count" title={`${count} need${count === 1 ? 's' : ''} you`}>
            {count}
          </span>
        )}
      </a>
    </nav>
  );
}
