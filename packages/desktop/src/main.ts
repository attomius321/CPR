import { readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  shell,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
} from 'electron';
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
const config = join(configDir(process.env, process.platform, homedir()), 'app');
const stateFile = join(config, 'state.json');

// Each run its own profile, so two windows (two `cpr view`s) never share Chromium's storage.
// What lasts is in state.json; profiles of runs that ended are removed at the next start.
const profiles = join(config, 'run');
removeEndedProfiles(profiles);
app.setPath('userData', join(profiles, String(process.pid)));

/** The window's background before the page paints: the viewer's `--bg`, in its theme. */
const BACKGROUND = { dark: '#0b0b0c', light: '#f7f7f5' };

void app.whenReady().then(() => {
  const url = args.url;
  if (!url) {
    process.stderr.write('cpr app: nothing to show; it opens with `cpr view` in a repository\n');
    app.exit(2);
    return;
  }
  setMenu();
  open(url, args.title ?? 'CPR');
});

app.on('window-all-closed', () => app.quit());
// Ctrl+C on the `cpr view` that started it reaches the app too: close as the window would.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());

/** A window on the CPR server at `home`; the server's pages stay in it, nothing else does. */
function open(home: string, title: string): void {
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

  contents.on('will-navigate', (event) => {
    if (staysInWindow(event.url, home)) return;
    event.preventDefault();
    openOutside(event.url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (staysInWindow(url, home)) void contents.loadURL(url);
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

  // The page's choices: given before its scripts run, kept when it is left (the preload's).
  const fromHome = (event: IpcMainEvent) =>
    event.sender === contents && staysInWindow(event.senderFrame?.url ?? '', home);
  ipcMain.on('cpr:choices', (event) => {
    event.returnValue = fromHome(event) ? readState(stateFile).choices : {};
  });
  ipcMain.on('cpr:keep-choices', (event, choices: unknown) => {
    if (fromHome(event)) {
      const state = readState(stateFile);
      writeState(stateFile, { ...state, choices: { ...state.choices, ...readChoices(choices) } });
    }
    event.returnValue = true;
  });

  let shown = false;
  contents.on('did-finish-load', () => {
    if (shown) return;
    shown = true;
    // What `cpr view` waits for: the window is open on its server.
    process.stdout.write(`CPR window: ${home}\n`);
  });
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (shown || !isMainFrame) return;
    process.stderr.write(`cpr app: could not load ${url}: ${description} (${code})\n`);
    app.exit(1);
  });

  void window.loadURL(home);
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
