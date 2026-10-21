import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { desktop, paintTitleBar } from './desktop.js';
import {
  BackIcon,
  CloseIcon,
  SymbioteIcon,
  ForwardIcon,
  MaximizeIcon,
  MinimizeIcon,
  RestoreIcon,
  SidenavIcon,
} from './icons.js';
import { HISTORY_PAGE } from './pages.js';
import { useTheme } from './theme.js';

/** Where a page puts its tabs (`page`) and its panel's toggle (`end`) in the title bar. */
export interface TitleBarSlots {
  page: HTMLElement | null;
  end: HTMLElement | null;
}

const SlotsContext = createContext<TitleBarSlots | null>(null);
export const TitleBarSlotsProvider = SlotsContext.Provider;

/**
 * Shows `children` in the title bar of Symbiote's window (N1c), where the page's tabs are; in a
 * browser, where they are.
 */
export function InTitleBar({
  at = 'page',
  children,
}: {
  at?: keyof TitleBarSlots;
  children: ReactNode;
}) {
  const slot = useContext(SlotsContext)?.[at];
  return slot ? createPortal(children, slot) : children;
}

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

/** The window's buttons where Symbiote draws its frame (N1d, Linux): elsewhere they are the system's. */
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
        title="Minimize"
        onClick={() => ask('minimize')}
      >
        <MinimizeIcon />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => ask(maximized ? 'restore' : 'maximize')}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        type="button"
        className="icon-button window-close"
        aria-label="Close"
        title="Close"
        onClick={() => ask('close')}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

/**
 * Symbiote's window's title bar (N1c): over the sidenav, Symbiote and the repository, the
 * sidenav's fold and back and forward; then the page's tabs (or its name); its panel's toggle at
 * the end, before the system's buttons. Its free space moves the window.
 */
export function TitleBar({
  repo,
  folded,
  onFold,
  label,
  onSlots,
}: {
  repo?: string | undefined;
  folded: boolean;
  onFold: () => void;
  /** The page's name, for a page without tabs. */
  label?: string | undefined;
  onSlots: (slots: TitleBarSlots) => void;
}) {
  usePaintedButtons();
  const moves = useMoves();
  const [page, setPage] = useState<HTMLElement | null>(null);
  const [end, setEnd] = useState<HTMLElement | null>(null);
  useEffect(() => onSlots({ page, end }), [page, end, onSlots]);
  return (
    <header className="titlebar">
      <div className="titlebar-side">
        <a
          className="titlebar-brand"
          href={HISTORY_PAGE}
          title={repo ? `Symbiote · ${repo}` : 'Symbiote'}
        >
          <SymbioteIcon />
          <span className="titlebar-name">
            Symbiote{repo && <span className="titlebar-repo"> · {repo}</span>}
          </span>
        </a>
        <button
          type="button"
          className="icon-button"
          aria-label={folded ? 'Open the sidenav' : 'Fold the sidenav'}
          title={folded ? 'Open the sidenav ([)' : 'Fold the sidenav ([)'}
          aria-expanded={!folded}
          onClick={onFold}
        >
          <SidenavIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Back"
          title="Back (Alt+←)"
          disabled={!moves.back}
          onClick={() => window.history.back()}
        >
          <BackIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Forward"
          title="Forward (Alt+→)"
          disabled={!moves.forward}
          onClick={() => window.history.forward()}
        >
          <ForwardIcon />
        </button>
      </div>
      <div className="titlebar-page">
        {label && <span className="titlebar-label">{label}</span>}
        <div className="titlebar-slot" ref={setPage} />
      </div>
      <div className="titlebar-end" ref={setEnd} />
      <WindowButtons />
    </header>
  );
}
