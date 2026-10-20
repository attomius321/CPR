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
import { readRecorded, startServer, withRecent } from './launcher.js';
import {
  contextMenuRoles,
  keyAction,
  outsideAddress,
  parseAppArgs,
  staysInWindow,
} from './policy.js';
import { configDir, placeWindow, readChoices, readState, writeState } from './state.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = parseAppArgs(process.argv.slice(app.isPackaged ? 1 : 2));
const cprConfig = configDir(process.env, process.platform, homedir());
const config = join(cprConfig, 'app');
const stateFile = join(config, 'state.json');
const startPage = join(here, '..', 'start', 'index.html');
const startUrl = pathToFileURL(startPage).href;

/**
 * Two ways in. From `cpr view` (`--url`): one window on that command's server, and a profile
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

/** The window's background before the page paints: the viewer's `--bg`, in its theme. */
const BACKGROUND = { dark: '#0b0b0c', light: '#f7f7f5' };

/** What each window shows: its home (a server, or the start page), its repository and server. */
interface Shown {
  window: BrowserWindow;
  home: string;
  repo?: string;
  server?: ChildProcess;
}
const windows = new Map<WebContents, Shown>();

if (!primary) app.quit();
else {
  void app.whenReady().then(() => {
    setMenu();
    listen();
    if (args.url) {
      openServer(args.url, args.title ?? 'CPR');
      return;
    }
    const last = readState(stateFile).recent?.find((repo) => existsSync(repo));
    const repo = args.repo ?? last;
    if (repo) openRepo(repo);
    else showStart(createWindow('CPR'), {});
  });
  app.on('second-instance', (_event, argv) => {
    const again = parseAppArgs(argv);
    if (again.repo) openRepo(again.repo);
    else focus([...windows.values()].at(-1)?.window ?? createWindow('CPR'));
  });
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  for (const { server } of windows.values()) server?.kill('SIGTERM');
});
// Ctrl+C on the `cpr view` that started it reaches the app too: close as the window would.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());

/** `cpr view`'s window: says when it shows the server (what the command waits for). */
function openServer(url: string, title: string): void {
  const window = createWindow(title);
  const contents = window.webContents;
  let shown = false;
  contents.on('did-finish-load', () => {
    if (shown) return;
    shown = true;
    process.stdout.write(`CPR window: ${url}\n`);
  });
  contents.on('did-fail-load', (_event, code, description, failed, isMainFrame) => {
    if (shown || !isMainFrame) return;
    process.stderr.write(`cpr app: could not load ${failed}: ${description} (${code})\n`);
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
  const window = into ?? createWindow('CPR');
  const entry = windows.get(window.webContents);
  if (!entry) return;
  entry.repo = repo;
  showStart(window, { opening: repo });
  const recorded = readRecorded(join(cprConfig, 'app.json'));
  if (!recorded) {
    delete entry.repo;
    showStart(window, {
      error: 'CPR does not know where cpr is: run cpr app install in a terminal',
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
      showStart(window, { error: `cpr view stopped (${code ?? 'a signal'})`, repo });
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
  const theme = readState(stateFile).choices['cpr.viewer.theme'] ?? 'dark';
  void window.loadFile(startPage, { query: { ...query, theme } });
}

function show(window: BrowserWindow, home: string): void {
  const entry = windows.get(window.webContents);
  if (entry) entry.home = home;
  void window.loadURL(home);
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
  const window = new BrowserWindow({
    x: place.x,
    y: place.y,
    width: place.width,
    height: place.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title,
    backgroundColor:
      state.choices['cpr.viewer.theme'] === 'light' ? BACKGROUND.light : BACKGROUND.dark,
    icon: join(here, '..', 'icons', 'cpr.png'),
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
  windows.set(contents, { window, home: startUrl });
  const home = () => windows.get(contents)?.home ?? startUrl;

  window.once('ready-to-show', () => {
    if (place.maximized) window.maximize();
    window.show();
  });
  window.on('close', () => {
    const { x, y, width, height } = window.getNormalBounds();
    writeState(stateFile, {
      ...readState(stateFile),
      window: { x, y, width, height, maximized: window.isMaximized() },
    });
  });
  window.on('closed', () => {
    windows.get(contents)?.server?.kill('SIGTERM');
    windows.delete(contents);
  });

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
  ipcMain.on('cpr:choices', (event) => {
    event.returnValue = fromServer(event) ? readState(stateFile).choices : {};
  });
  ipcMain.on('cpr:keep-choices', (event, choices: unknown) => {
    if (fromServer(event)) {
      const state = readState(stateFile);
      writeState(stateFile, { ...state, choices: { ...state.choices, ...readChoices(choices) } });
    }
    event.returnValue = true;
  });

  // The start page's: the recent repositories, choosing one, opening one, forgetting one.
  ipcMain.on('cpr:start:recent', (event) => {
    event.returnValue = fromStart(event) ? recentRepos() : [];
  });
  ipcMain.on('cpr:start:forget', (event, repo: unknown) => {
    if (fromStart(event)) {
      const state = readState(stateFile);
      writeState(stateFile, {
        ...state,
        recent: (state.recent ?? []).filter((other) => other !== repo),
      });
    }
    event.returnValue = recentRepos();
  });
  ipcMain.on('cpr:start:open', (event, repo: unknown) => {
    const window = shownFor(event)?.window;
    if (window && fromStart(event) && typeof repo === 'string' && repo.startsWith('/')) {
      openRepo(repo, window);
    }
  });
  ipcMain.on('cpr:start:choose', (event) => {
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
