import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { paintTitleBar } from './desktop.js';
import { BackIcon, CprIcon, ForwardIcon, SidenavIcon } from './icons.js';
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
 * Shows `children` in the title bar of CPR's window (N1c), where the page's tabs are; in a
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

/**
 * CPR's window's title bar (N1c), after Orca's: over the sidenav, CPR and the repository, the
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
        <a className="titlebar-brand" href={HISTORY_PAGE} title={repo ? `CPR · ${repo}` : 'CPR'}>
          <CprIcon />
          <span className="titlebar-name">
            CPR{repo && <span className="titlebar-repo"> · {repo}</span>}
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
    </header>
  );
}
