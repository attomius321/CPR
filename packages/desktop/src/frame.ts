import type { BrowserWindowConstructorOptions } from 'electron';

/**
 * Who draws the window's frame and buttons (N1d): CPR's pages on Linux, where Electron rounds a
 * frameless window only with client-side decorations and draws no buttons over a transparent
 * one; the system on macOS and Windows, whose frameless windows are rounded already.
 */
export type Frame = 'own' | 'system';

export function frameOf(platform: string): Frame {
  return platform === 'linux' ? 'own' : 'system';
}

/** The window's background before the page paints: the viewer's `--bg`, in its theme (V31). */
const BACKGROUND = { dark: '#0a0a0a', light: '#ffffff' };

/**
 * The title bar (N1c): CPR draws it, 38 px, in the viewer's `--side`; on Windows the system's
 * buttons lie over its right end in that colour, `--text` for their symbols.
 */
export const TITLE_BAR = {
  height: 38,
  dark: { color: '#171717', symbolColor: '#fafafa' },
  light: { color: '#fafafa', symbolColor: '#0a0a0a' },
};

type FrameOptions = Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'transparent' | 'backgroundColor' | 'titleBarOverlay' | 'trafficLightPosition'
>;

/** The window's frame on `platform`, in the theme the page will paint (`light` or dark). */
export function frameOptions(platform: string, light: boolean): FrameOptions {
  if (frameOf(platform) === 'own') {
    // Clear around the page's rounded root, which carries the background.
    return { titleBarStyle: 'hidden', transparent: true, backgroundColor: '#00000000' };
  }
  const backgroundColor = light ? BACKGROUND.light : BACKGROUND.dark;
  if (platform === 'darwin') {
    return { titleBarStyle: 'hidden', backgroundColor, trafficLightPosition: { x: 14, y: 12 } };
  }
  return {
    titleBarStyle: 'hidden',
    backgroundColor,
    titleBarOverlay: { ...(light ? TITLE_BAR.light : TITLE_BAR.dark), height: TITLE_BAR.height },
  };
}
