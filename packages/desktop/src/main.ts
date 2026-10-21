import type { ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  shell,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import { frameOf, frameOptions } from './frame.js';
import { readRecorded, startServer, withRecent } from './launcher.js';
import { holdMaximize, holdsMaximize, type Hold } from './maximize.js';
import {
  contextMenuRoles,
  keyAction,
  outsideAddress,
  parseAppArgs,
  staysInWindow,
} from './policy.js';
import { configDir, placeWindow, readChoices, readState, writeState, type Area } from './state.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = parseAppArgs(process.argv.slice(app.isPackaged ? 1 : 2));
const symbioteConfig = configDir(process.env, process.platform, homedir());
const config = join(symbioteConfig, 'app');
const stateFile = join(config, 'state.json');
const startPage = join(here, '..', 'start', 'index.html');
const startUrl = pathToFileURL(startPage).href;

/**
 * Two ways in. From `symbiote view` (`--url`): one window on that command's server, and a profile
 * of this run's own, so two of them never share Chromium's storage (what lasts is in
 * state.json; profiles of runs that ended are removed at the next start). From the desktop
 * (N1b): one app, its windows each on a repository whose server it starts; launched again, the
 * running app takes it.
 */
const fromLauncher = args.url === undefined;
if (fromLauncher) {
  app.setPath('userData', join(config, 'launcher'));
} else {
  removeEndedProfiles(join(config, 'run'));
  app.setPath('userData', join(config, 'run', String(process.pid)));
}
const primary = !fromLauncher || app.requestSingleInstanceLock();

/** Who draws the window's frame and buttons here (N1d): Symbiote's pages on Linux. */
const frame = frameOf(process.platform);
/** Where Symbiote holds a maximized window itself (N1d): WSLg's X11; the work areas it has learned. */
const holding = frame === 'own' && holdsMaximize(process.platform, process.env);
const workAreas: Area[] = [];
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * What each window shows: its home (a server, or the start page), its repository and server; and
 * its maximize, where Symbiote holds it.
 */
interface Shown {
  window: BrowserWindow;
  home: string;
  repo?: string;
  server?: ChildProcess;
  hold?: Hold;
}
const windows = new Map<WebContents, Shown>();

if (!primary) app.quit();
else {
  void app.whenReady().then(() => {
    setMenu();
    listen();
    if (args.url) {
      openServer(args.url, args.title ?? 'Symbiote');
      return;
    }
    const last = readState(stateFile).recent?.find((repo) => existsSync(repo));
    const repo = args.repo ?? last;
    if (repo) openRepo(repo);
    else showStart(createWindow('Symbiote'), {});
  });
  app.on('second-instance', (_event, argv) => {
    const again = parseAppArgs(argv);
    if (again.repo) openRepo(again.repo);
    else focus([...windows.values()].at(-1)?.window ?? createWindow('Symbiote'));
  });
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  for (const { server } of windows.values()) server?.kill('SIGTERM');
});
// Ctrl+C on the `symbiote view` that started it reaches the app too: close as the window would.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());

/** `symbiote view`'s window: says when it shows the server (what the command waits for). */
function openServer(url: string, title: string): void {
  const window = createWindow(title);
  const contents = window.webContents;
  let shown = false;
  contents.on('did-finish-load', () => {
    if (shown) return;
    shown = true;
    process.stdout.write(`Symbiote window: ${url}\n`);
  });
  contents.on('did-fail-load', (_event, code, description, failed, isMainFrame) => {
    if (shown || !isMainFrame) return;
    process.stderr.write(`symbiote app: could not load ${failed}: ${description} (${code})\n`);
    app.exit(1);
  });
  show(window, url);
}

/**
 * A repository in a window, its server started by the app: the window that shows it already,
 * else `into` (a start page's) or a new one. Until the server serves, the start page says so;
 * if it does not, the start page says why.
 */
function openRepo(repo: string, into?: BrowserWindow): void {
  const open = [...windows.values()].find((shown) => shown.repo === repo);
  if (open) {
    focus(open.window);
    return;
  }
  const window = into ?? createWindow('Symbiote');
  const entry = windows.get(window.webContents);
  if (!entry) return;
  entry.repo = repo;
  showStart(window, { opening: repo });
  const recorded = readRecorded(join(symbioteConfig, 'app.json'));
  if (!recorded) {
    delete entry.repo;
    showStart(window, {
      error: 'Symbiote does not know where symbiote is: run symbiote app install in a terminal',
    });
    return;
  }
  void startServer(repo, recorded, process.env).then((started) => {
    if (window.isDestroyed()) {
      if ('child' in started) started.child.kill('SIGTERM');
      return;
    }
    if ('error' in started) {
      delete entry.repo;
      showStart(window, { error: started.error, repo });
      return;
    }
    entry.server = started.child;
    started.child.once('exit', (code) => {
      if (window.isDestroyed() || entry.server !== started.child) return;
      delete entry.server;
      delete entry.repo;
      showStart(window, { error: `symbiote view stopped (${code ?? 'a signal'})`, repo });
    });
    const state = readState(stateFile);
    writeState(stateFile, { ...state, recent: withRecent(state.recent ?? [], repo) });
    show(window, started.url);
  });
}

/** The start page: open a repository, the recent ones, and what went wrong if anything did. */
function showStart(
  window: BrowserWindow,
  query: { opening?: string; error?: string; repo?: string },
) {
  const entry = windows.get(window.webContents);
  if (entry) entry.home = startUrl;
  const theme = readState(stateFile).choices['symbiote.viewer.theme'] ?? 'dark';
  void window.loadFile(startPage, { query: { ...query, theme } });
}

function show(window: BrowserWindow, home: string): void {
  const entry = windows.get(window.webContents);
  if (entry) entry.home = home;
  void window.loadURL(home);
}

/** Maximizes `window`: through its hold, where Symbiote holds it. */
function maximize(window: BrowserWindow, hold: Hold | undefined): void {
  if (hold) hold.maximize();
  else window.maximize();
}

function focus(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.focus();
}

/** A window whose home's pages stay in it, nothing else does. */
function createWindow(title: string): BrowserWindow {
  const state = readState(stateFile);
  const place = placeWindow(
    state.window,
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea,
  );
  const light = state.choices['symbiote.viewer.theme'] === 'light';
  const window = new BrowserWindow({
    x: place.x,
    y: place.y,
    width: place.width,
    height: place.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title,
    ...frameOptions(process.platform, light),
    icon: join(here, '..', 'icons', 'symbiote.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      zoomFactor: 1.2 ** (state.zoom ?? 0),
    },
  });
  const contents = window.webContents;
  // Where Symbiote draws the frame (N1d), its pages square their corners while the window fills the
  // screen. Told by the window's events: a window manager may answer `isMaximized` late.
  const tell = (maximized: boolean) => {
    if (!contents.isDestroyed()) contents.send('symbiote:window-state', { maximized });
  };
  const hold = holding ? holdMaximize(window, tell, workAreas) : undefined;
  windows.set(contents, { window, home: startUrl, ...(hold ? { hold } : {}) });
  const home = () => windows.get(contents)?.home ?? startUrl;

  window.once('ready-to-show', () => {
    if (place.maximized && hold) {
      // On WSLg, maximized once it is shown: see `maximizeOnceShown`.
      window.show();
      hold.maximizeOnceShown();
      return;
    }
    if (place.maximized) window.maximize();
    window.show();
  });
  window.on('close', () => {
    const { x, y, width, height } = hold?.normal ?? window.getNormalBounds();
    const maximized = !!hold?.maximized || window.isMaximized();
    writeState(stateFile, { ...readState(stateFile), window: { x, y, width, height, maximized } });
  });
  window.on('closed', () => {
    hold?.stop();
    windows.get(contents)?.server?.kill('SIGTERM');
    windows.delete(contents);
  });

  if (frame === 'own') {
    window.on('maximize', () => {
      if (hold) hold.onMaximize();
      else tell(true);
    });
    window.on('unmaximize', () => {
      if (hold) hold.onUnmaximize();
      else tell(false);
    });
    window.on('enter-full-screen', () => tell(true));
    window.on('leave-full-screen', () => tell(window.isMaximized() || !!hold?.maximized));
  }
  if (hold) {
    window.on('move', () => hold.onBoundsChange());
    window.on('resize', () => hold.onBoundsChange());
  }

  contents.on('will-navigate', (event) => {
    if (staysInWindow(event.url, home())) return;
    event.preventDefault();
    openOutside(event.url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (staysInWindow(url, home())) void contents.loadURL(url);
    else openOutside(url);
    return { action: 'deny' };
  });

  contents.on('before-input-event', (event, input) => {
    const action = keyAction(input, process.platform);
    if (!action) return;
    event.preventDefault();
    if (action === 'devtools') {
      contents.toggleDevTools();
      return;
    }
    const level = contents.getZoomLevel();
    const zoom =
      action === 'zoom-reset'
        ? 0
        : Math.max(-8, Math.min(9, level + (action === 'zoom-in' ? 1 : -1)));
    contents.setZoomLevel(zoom);
    writeState(stateFile, { ...readState(stateFile), zoom });
  });

  // A page that asks before it is left (Settings with a prompt not saved): Electron would keep
  // the window open and say nothing, so the app asks, as a browser does.
  contents.on('will-prevent-unload', (event) => {
    const leave = dialog.showMessageBoxSync(window, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      title: 'Symbiote',
      message: 'Leave this page? What you changed is not saved.',
    });
    if (leave === 0) event.preventDefault();
  });

  contents.on('context-menu', (_event, params) => {
    const roles = contextMenuRoles(params);
    if (roles.length === 0) return;
    Menu.buildFromTemplate(
      roles.map((role): MenuItemConstructorOptions =>
        role === 'separator' ? { type: 'separator' } : { role },
      ),
    ).popup({ window });
  });
  return window;
}

/** The pages' messages: each answered for the window it comes from, and only from its home. */
function listen(): void {
  const shownFor = (event: IpcMainEvent) => windows.get(event.sender);
  const fromServer = (event: IpcMainEvent) => {
    const entry = shownFor(event);
    return !!entry && staysInWindow(event.senderFrame?.url ?? '', entry.home);
  };
  const fromStart = (event: IpcMainEvent) =>
    !!shownFor(event) && (event.senderFrame?.url ?? '').startsWith(startUrl);

  // The viewer's choices: given before its scripts run, kept when it is left (the preload's).
  ipcMain.on('symbiote:choices', (event) => {
    event.returnValue = fromServer(event) ? readState(stateFile).choices : {};
  });
  ipcMain.on('symbiote:keep-choices', (event, choices: unknown) => {
    if (fromServer(event)) {
      const state = readState(stateFile);
      writeState(stateFile, { ...state, choices: { ...state.choices, ...readChoices(choices) } });
    }
    event.returnValue = true;
  });

  // Who draws the frame, and whether the window fills the screen (N1d): asked before the page's
  // scripts run, so its first paint has the right corners.
  ipcMain.on('symbiote:frame', (event) => {
    const entry = shownFor(event);
    const window = entry?.window;
    const own = !!window && frame === 'own' && (fromServer(event) || fromStart(event));
    event.returnValue = {
      frame: own ? 'own' : 'system',
      maximized:
        !!window && (window.isMaximized() || window.isFullScreen() || !!entry.hold?.maximized),
    };
  });

  // The window's own buttons, where Symbiote draws them (N1d): only its own pages may ask.
  ipcMain.on('symbiote:window', (event, action: unknown) => {
    const entry = shownFor(event);
    const window = entry?.window;
    if (!window || frame !== 'own' || !(fromServer(event) || fromStart(event))) return;
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') maximize(window, entry.hold);
    else if (action === 'restore') {
      if (window.isFullScreen()) window.setFullScreen(false);
      else if (!entry.hold?.restore()) window.unmaximize();
    } else if (action === 'close') window.close();
  });

  // The title bar's colours, as the page's theme has them (N1c).
  ipcMain.on('symbiote:title-bar', (event, colors: unknown) => {
    const window = shownFor(event)?.window;
    // No overlay where Symbiote draws the frame (N1d): Electron throws if asked to paint one.
    if (!window || !fromServer(event) || process.platform === 'darwin' || frame === 'own') return;
    const { color, symbol } = (colors ?? {}) as { color?: unknown; symbol?: unknown };
    if (typeof color !== 'string' || typeof symbol !== 'string') return;
    if (HEX.test(color) && HEX.test(symbol)) {
      window.setTitleBarOverlay({ color, symbolColor: symbol });
    }
  });

  // The start page's: the recent repositories, choosing one, opening one, forgetting one.
  ipcMain.on('symbiote:start:recent', (event) => {
    event.returnValue = fromStart(event) ? recentRepos() : [];
  });
  ipcMain.on('symbiote:start:forget', (event, repo: unknown) => {
    if (fromStart(event)) {
      const state = readState(stateFile);
      writeState(stateFile, {
        ...state,
        recent: (state.recent ?? []).filter((other) => other !== repo),
      });
    }
    event.returnValue = recentRepos();
  });
  ipcMain.on('symbiote:start:open', (event, repo: unknown) => {
    const window = shownFor(event)?.window;
    if (window && fromStart(event) && typeof repo === 'string' && repo.startsWith('/')) {
      openRepo(repo, window);
    }
  });
  ipcMain.on('symbiote:start:choose', (event) => {
    const window = shownFor(event)?.window;
    if (!window || !fromStart(event)) return;
    void dialog
      .showOpenDialog(window, { title: 'Open a repository', properties: ['openDirectory'] })
      .then(({ canceled, filePaths: [repo] }) => {
        if (!canceled && repo && !window.isDestroyed()) openRepo(repo, window);
      });
  });
}

/** The recent repositories still there. */
function recentRepos(): string[] {
  return (readState(stateFile).recent ?? []).filter((repo) => existsSync(repo));
}

function openOutside(url: string): void {
  const address = outsideAddress(url);
  if (address) void shell.openExternal(address);
}

/** No menu bar on Linux and Windows; macOS keeps its menus, where ⌘C and ⌘Q live. */
function setMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
  );
}

/** Removes the profiles of runs whose process is gone. */
function removeEndedProfiles(folder: string): void {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return;
  }
  for (const name of names) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid === process.pid || isRunning(pid)) continue;
    rmSync(join(folder, name), { recursive: true, force: true });
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
