// Runs in each Symbiote page of the app, sandboxed, before the page's own scripts. CommonJS: a
// sandboxed preload cannot load modules, its own files included.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS, as said above
import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;
const mac = process.platform === 'darwin';

// The viewer's choices (theme, folded sidenav…): each run's server is a new origin with empty
// storage, so the app gives them back here and keeps them when the page is left.
try {
  const choices = ipcRenderer.sendSync('symbiote:choices') as Record<string, string>;
  for (const [key, value] of Object.entries(choices)) window.localStorage.setItem(key, value);
} catch {
  // Storage blocked: the page starts with its defaults.
}

function keepChoices(): void {
  try {
    const choices: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      const value = key?.startsWith('symbiote.viewer.') ? window.localStorage.getItem(key) : null;
      if (key && value !== null) choices[key] = value;
    }
    ipcRenderer.sendSync('symbiote:keep-choices', choices);
  } catch {
    // Nothing to keep.
  }
}
window.addEventListener('pagehide', keepChoices);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') keepChoices();
});

// Back, forward and reload, as a browser has them, where the page leaves the key alone: the
// agent's terminal keeps Ctrl+R and Alt+arrows (it stops them first).
window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.isComposing || event.shiftKey) return;
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const nav = mac ? mod && !event.altKey : event.altKey && !event.ctrlKey && !event.metaKey;
  if (nav && event.key === (mac ? '[' : 'ArrowLeft')) window.history.back();
  else if (nav && event.key === (mac ? ']' : 'ArrowRight')) window.history.forward();
  else if (event.key === 'F5' || (mod && !event.altKey && event.key.toLowerCase() === 'r')) {
    window.location.reload();
  } else return;
  event.preventDefault();
});

// The mouse's back and forward buttons.
window.addEventListener('mouseup', (event) => {
  if (event.button === 3) window.history.back();
  else if (event.button === 4) window.history.forward();
});

/** The window's state, as Symbiote's pages see it (N1d): maximized or full screen, or neither. */
interface WindowState {
  maximized: boolean;
}

// Who draws the window's frame (N1d): Symbiote's pages on Linux, with their own corners and
// buttons. The page's first script marks <html> with it; the window's state is kept on <html> here.
const framed = (() => {
  try {
    return ipcRenderer.sendSync('symbiote:frame') as { frame: string; maximized: boolean };
  } catch {
    return { frame: 'system', maximized: false };
  }
})();
const stateListeners = new Set<(state: WindowState) => void>();
ipcRenderer.on('symbiote:window-state', (_event, state: WindowState) => {
  document.documentElement.dataset.window = state.maximized ? 'maximized' : 'normal';
  for (const listener of stateListeners) listener({ maximized: state.maximized });
});
/** What both kinds of page get of the window, where Symbiote draws its frame. */
const ownFrame = {
  frame: framed.frame,
  maximized: framed.maximized,
  window: (action: 'minimize' | 'maximize' | 'restore' | 'close') =>
    ipcRenderer.send('symbiote:window', action),
  onWindowState: (listener: (state: WindowState) => void) => {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  },
};

// Symbiote's pages (N1c): that they are in the app, on which system (its window's buttons are at
// the left on macOS), and the title bar's colours for those buttons, which follow the page's theme.
if (window.location.protocol === 'http:') {
  contextBridge.exposeInMainWorld('symbioteApp', {
    platform: process.platform,
    titleBar: (colors: { color: string; symbol: string }) =>
      ipcRenderer.send('symbiote:title-bar', colors),
    ...ownFrame,
  });
}

// The start page (N1b), a file of the app's own: what it may ask the app. Server pages get
// none of it.
if (window.location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('symbioteStart', {
    recent: (): unknown => ipcRenderer.sendSync('symbiote:start:recent'),
    forget: (repo: string): unknown => ipcRenderer.sendSync('symbiote:start:forget', repo),
    open: (repo: string) => ipcRenderer.send('symbiote:start:open', repo),
    choose: () => ipcRenderer.send('symbiote:start:choose'),
    ...ownFrame,
  });
}
