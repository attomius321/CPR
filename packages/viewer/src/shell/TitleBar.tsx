import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { desktop, paintTitleBar } from './desktop.js';
import {
  BackIcon,
  CloseIcon,
  ForwardIcon,
  MaximizeIcon,
  MinimizeIcon,
  RestoreIcon,
} from '../ui/icons.js';
import { useTheme } from './theme.js';
import { tip } from '../ui/tip.js';

/** Whether there is a page to go back or forward to (the Navigation API). */
function useMoves(): { back: boolean; forward: boolean } {
  const read = () => window.navigation?.canGoBack ?? true;
  const back = useSyncExternalStore(subscribeMoves, read);
  const forward = useSyncExternalStore(
    subscribeMoves,
    () => window.navigation?.canGoForward ?? true,
  );
  return { back, forward };
}

function subscribeMoves(listener: () => void): () => void {
  window.navigation?.addEventListener('currententrychange', listener);
  return () => window.navigation?.removeEventListener('currententrychange', listener);
}

/** The window's buttons follow the theme's colours, the system's too when the theme is. */
function usePaintedButtons(): void {
  const theme = useTheme();
  useEffect(() => {
    paintTitleBar();
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', paintTitleBar);
    return () => media.removeEventListener('change', paintTitleBar);
  }, [theme]);
}

/** Whether the window fills the screen, as the app tells it (N1d). */
function useMaximized(): boolean {
  const subscribe = useCallback(
    (changed: () => void) => desktop?.onWindowState?.(changed) ?? (() => undefined),
    [],
  );
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.window === 'maximized',
  );
}

/** The window's buttons where Symbiote draws its frame (N1d, Linux): elsewhere they are the
 * system's. */
export function WindowButtons() {
  const maximized = useMaximized();
  const ask = desktop?.window;
  if (desktop?.frame !== 'own' || !ask) return null;
  return (
    <div className="window-buttons">
      <button
        type="button"
        className="icon-button"
        aria-label="Minimize"
        {...tip('Minimize', { side: 'bottom' })}
        onClick={() => ask('minimize')}
      >
        <MinimizeIcon />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        {...tip(maximized ? 'Restore' : 'Maximize', { side: 'bottom' })}
        onClick={() => ask(maximized ? 'restore' : 'maximize')}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        type="button"
        className="icon-button window-close"
        aria-label="Close"
        {...tip('Close', { side: 'bottom' })}
        onClick={() => ask('close')}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

/** The window's title as the page sets it (N1a): the one the taskbar and a browser's tab show. */
function useWindowTitle(): string {
  return useSyncExternalStore(subscribeTitle, () => document.title);
}

function subscribeTitle(listener: () => void): () => void {
  // Setting `document.title` replaces the text of index.html's <title>.
  const title = document.querySelector('title');
  if (!title) return () => undefined;
  const observer = new MutationObserver(listener);
  observer.observe(title, { childList: true, characterData: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * Symbiote's window's title bar (N1c): what a browser keeps in its own bar — Back, Forward, the
 * page's title — and the window's buttons where Symbiote draws them. The page under it is the one a
 * browser shows: nothing of it moves up here. Its free space moves the window.
 */
export function TitleBar() {
  usePaintedButtons();
  const moves = useMoves();
  const title = useWindowTitle();
  return (
    <header className="titlebar">
      <div className="titlebar-moves">
        <button
          type="button"
          className="icon-button"
          aria-label="Back"
          {...tip('Back', { keys: 'Alt+←', side: 'bottom' })}
          disabled={!moves.back}
          onClick={() => window.history.back()}
        >
          <BackIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Forward"
          {...tip('Forward', { keys: 'Alt+→', side: 'bottom' })}
          disabled={!moves.forward}
          onClick={() => window.history.forward()}
        >
          <ForwardIcon />
        </button>
      </div>
      <span className="titlebar-title">{title}</span>
      <WindowButtons />
    </header>
  );
}
