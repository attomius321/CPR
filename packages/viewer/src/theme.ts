// The page's theme (V29b, decision 179): dark unless the person chose light or the system's, in
// Settings, for this browser. index.html's inline script sets it before the first paint; this
// module reads and changes it afterwards.
import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light' | 'system';

/** Where the choice is kept (index.html's script reads the same key). */
export const THEME_KEY = 'symbiote.viewer.theme';

/** The theme for what storage holds: dark unless light or system was chosen. */
export function themeOf(stored: string | null): Theme {
  return stored === 'light' || stored === 'system' ? stored : 'dark';
}

/** The theme on <html>, as index.html's script set it or Settings changed it. */
function current(): Theme {
  return themeOf(document.documentElement.dataset.theme ?? null);
}

const listeners = new Set<() => void>();

/** Shows `theme` now and keeps it for this browser's next pages. */
export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Chosen in another tab: followed here.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_KEY) return;
    document.documentElement.dataset.theme = themeOf(event.newValue);
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The theme shown, updated when the person changes it. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current);
}
