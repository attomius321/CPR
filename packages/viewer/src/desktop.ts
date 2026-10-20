/** CPR's desktop app (N1), as its preload tells CPR's pages; absent in a browser. */
export interface DesktopApp {
  /** The system: the window's buttons are at the left on macOS, at the right elsewhere. */
  platform: string;
  /** The title bar's colours, for the window's own buttons (Windows and Linux). */
  titleBar(colors: { color: string; symbol: string }): void;
}

declare global {
  interface Window {
    cprApp?: DesktopApp;
  }
}

/** The app this page is shown in, if any: the title bar is CPR's there (N1c). */
export const desktop: DesktopApp | undefined = window.cprApp;

/** Gives the window's buttons the title bar's colours, as the theme has them now. */
export function paintTitleBar(): void {
  if (!desktop) return;
  const style = getComputedStyle(document.documentElement);
  desktop.titleBar({
    color: style.getPropertyValue('--side').trim(),
    symbol: style.getPropertyValue('--text').trim(),
  });
}
