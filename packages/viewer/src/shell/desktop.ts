/** Symbiote's desktop app (N1), as its preload tells Symbiote's pages; absent in a browser. */
export interface DesktopApp {
  /** The system: the window's buttons are at the left on macOS, at the right elsewhere. */
  platform: string;
  /** The title bar's colours, for the system's buttons over it (Windows). */
  titleBar(colors: { color: string; symbol: string }): void;
  /** Who draws the window's frame and buttons (N1d): `own` (the page) on Linux. */
  frame?: 'own' | 'system';
  /** Whether the window filled the screen when the page loaded. */
  maximized?: boolean;
  /** Asks the window, where the page draws its buttons (a function of the preload's, unbound). */
  window?: (action: 'minimize' | 'maximize' | 'restore' | 'close') => void;
  /** Called as the window fills the screen or leaves it; returns how to stop. */
  onWindowState?: (listener: (state: { maximized: boolean }) => void) => () => void;
  /** How many things wait for the person (N2): the dot on the window's icon. Absent before N2. */
  waiting?: (count: number) => void;
}

declare global {
  interface Window {
    symbioteApp?: DesktopApp;
  }
}

/** The app this page is shown in, if any: the title bar is Symbiote's there (N1c). */
export const desktop: DesktopApp | undefined = window.symbioteApp;

/** Gives the window's buttons the title bar's colours, as the theme has them now. */
export function paintTitleBar(): void {
  // Where the page draws the window's buttons (N1d), there is no overlay to paint.
  if (!desktop || desktop.frame === 'own') return;
  const style = getComputedStyle(document.documentElement);
  desktop.titleBar({
    color: style.getPropertyValue('--side').trim(),
    symbol: style.getPropertyValue('--text').trim(),
  });
}
