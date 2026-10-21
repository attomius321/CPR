import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { serveCommits, serveWorkspaces, type RunningCommits } from './symbiote.js';

// Symbiote's desktop app (N1): the window `symbiote view` opens on its server. It needs Electron's binary
// (`pnpm app:setup`) and Xvfb: the app's windows open on a display of the specs' own, never on
// the screen of whoever runs them (Symbiote's merge check, on the person's desktop), where a window
// manager would also move them.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const desktop = join(root, 'packages/desktop');
const electron = ((): string | null => {
  try {
    const path: unknown = createRequire(join(desktop, 'package.json'))('electron');
    return typeof path === 'string' && existsSync(path) ? path : null;
  } catch {
    return null;
  }
})();

const xvfb = (() => {
  try {
    execFileSync('which', ['Xvfb'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test.skip(electron === null, 'the app is not set up: pnpm app:setup');
test.skip(!xvfb, "the app's specs need Xvfb, a display of their own");

/**
 * A display of the specs' own: Xvfb on the first free number from :99, as xvfb-run picks one;
 * it is ready when it writes that number back (`-displayfd`). Left to choose a number itself,
 * Xvfb finds none on WSL (/tmp/.X11-unix is not world-writable), and there it listens on an
 * abstract socket only: no socket file to wait for.
 */
async function startXvfb(): Promise<{ name: string; stop(): void }> {
  for (let number = 99; number < 140; number++) {
    if (existsSync(`/tmp/.X${number}-lock`)) continue;
    const server = spawn(
      'Xvfb',
      [`:${number}`, '-displayfd', '3', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'],
      { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] },
    );
    const ready = await new Promise<boolean>((resolve) => {
      (server.stdio[3] as Readable).once('data', () => resolve(true));
      server.once('exit', () => resolve(false));
      server.once('error', () => resolve(false));
    });
    if (ready) return { name: `:${number}`, stop: () => server.kill() };
  }
  throw new Error('no free display for Xvfb');
}

let display: { name: string; stop(): void };

/** The environment for the app: its settings in `config`, on the specs' own display (X11). */
function appEnv(config: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'WAYLAND_DISPLAY') env[key] = value;
  }
  return { ...env, DISPLAY: display.name, XDG_CONFIG_HOME: config };
}

let symbiote: RunningCommits;
let config: string;
const errors: string[] = [];
const running: ElectronApplication[] = [];

test.beforeAll(async () => {
  [symbiote, display] = await Promise.all([serveCommits(), startXvfb()]);
});

test.afterAll(() => {
  symbiote.stop();
  display.stop();
});

test.beforeEach(() => {
  config = mkdtempSync(join(tmpdir(), 'symbiote-app-'));
  errors.length = 0;
});

test.afterEach(async () => {
  for (const app of running.splice(0)) await app.close().catch(() => undefined);
  rmSync(config, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

/** The app on `url`: its first window. */
async function launch(url = symbiote.url): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    executablePath: electron as string,
    args: [desktop, '--url', url, '--title', 'repo'],
    env: appEnv(config),
  });
  running.push(app);
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.locator('.commit').first()).toBeVisible();
  return { app, page };
}

/**
 * Presses a key as the system would: Playwright's keys reach the page but not Electron's
 * `before-input-event`, where the app's own keys (zoom) are taken.
 */
const press = (app: ElectronApplication, keyCode: string, modifiers: ('control' | 'alt')[]) =>
  app.evaluate(
    ({ BrowserWindow }, key) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      contents?.sendInputEvent({ type: 'keyDown', ...key });
      contents?.sendInputEvent({ type: 'keyUp', ...key });
    },
    { keyCode, modifiers },
  );

const zoomLevel = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomLevel());

/**
 * Records what the page asks of the first window (N1d) instead of doing it: the specs' display
 * has no window manager, and a closed window would end the app.
 */
const recordWindow = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    const asked: string[] = [];
    Object.assign(globalThis, { asked });
    for (const name of ['minimize', 'maximize', 'unmaximize', 'close'] as const) {
      window[name] = () => {
        asked.push(name);
      };
    }
  });

const calls = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { asked?: string[] }).asked ?? []);

const style = (page: Page, selector: string, property: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

test('opens the server in a window of its own: no menu bar, the page’s title', async () => {
  const { app, page } = await launch();
  expect(page.url()).toBe(`${symbiote.url}history`);
  const window = await app.evaluate(({ BrowserWindow, Menu }) => {
    const windows = BrowserWindow.getAllWindows();
    return {
      count: windows.length,
      title: windows[0]?.getTitle(),
      visible: windows[0]?.isVisible(),
      menu: Menu.getApplicationMenu(),
    };
  });
  expect(window).toEqual({ count: 1, title: await page.title(), visible: true, menu: null });
  expect(window.title).toMatch(/^History · .+ — Symbiote$/);
});

test("keeps Symbiote's pages in the window and hands other links to the browser", async () => {
  const { app, page } = await launch();
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { opened });
    shell.openExternal = (url: string) => {
      opened.push(url);
      return Promise.resolve();
    };
  });
  const here = page.url();
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.id = 'out';
    link.href = 'https://example.com/pull/1';
    link.target = '_blank';
    link.textContent = 'a pull request';
    document.body.append(link);
  });
  await page.locator('#out').click();
  await page.evaluate(() => window.location.assign('https://example.com/elsewhere'));
  await page.evaluate(() => window.location.assign('file:///etc/passwd'));
  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
    .toEqual(['https://example.com/pull/1', 'https://example.com/elsewhere']);
  expect(page.url()).toBe(here);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('back and forward with Alt+arrows, zoom with Ctrl+= and Ctrl+0', async () => {
  const { app, page } = await launch();
  await page.keyboard.press('s');
  await expect(page).toHaveURL(/\/settings$/);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page).toHaveURL(/\/history$/);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page).toHaveURL(/\/settings$/);

  await press(app, '=', ['control']);
  await expect.poll(() => zoomLevel(app)).toBe(1);
  await press(app, '0', ['control']);
  await expect.poll(() => zoomLevel(app)).toBe(0);
});

test('remembers the window, the zoom and the page’s choices for the next run', async () => {
  const first = await launch();
  await first.page.evaluate(() => window.localStorage.setItem('symbiote.viewer.theme', 'light'));
  await press(first.app, '=', ['control']);
  await expect.poll(() => zoomLevel(first.app)).toBe(1);
  await first.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 40, y: 30, width: 1000, height: 700 }),
  );
  await first.app.close();
  const state = JSON.parse(readFileSync(join(config, 'symbiote', 'app', 'state.json'), 'utf8')) as {
    window: unknown;
    choices: unknown;
  };
  expect(state).toMatchObject({
    window: { x: 40, y: 30, width: 1000, height: 700, maximized: false },
    zoom: 1,
    choices: { 'symbiote.viewer.theme': 'light' },
  });

  // Another server is another origin, with empty storage: the choices come back before the
  // page's own scripts read them.
  const other = await serveCommits();
  try {
    const second = await launch(other.url);
    expect(await second.page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
    expect(await zoomLevel(second.app)).toBe(1);
    expect(
      await second.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getBounds(),
      ),
    ).toEqual({ x: 40, y: 30, width: 1000, height: 700 });
  } finally {
    other.stop();
  }
});

test('closing the window ends the app', async () => {
  const { app } = await launch();
  const ended = new Promise((resolve) => app.process().once('exit', resolve));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await ended;
});

test('says so and ends when the server is not there', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));

  const child = spawn(electron as string, [desktop, '--url', `http://127.0.0.1:${port}/`], {
    env: appEnv(config),
  });
  let stderr = '';
  child.stderr.on('data', (data: Buffer) => (stderr += data.toString()));
  const code = await new Promise((resolve) => child.once('exit', resolve));
  expect(code).toBe(1);
  expect(stderr).toMatch(
    new RegExp(`^symbiote app: could not load http://127\\.0\\.0\\.1:${port}/: `, 'm'),
  );
});

test('symbiote view opens its window, and ends when the window closes', async () => {
  const cli = spawn(process.execPath, [join(root, 'packages/cli/dist/bin.js'), 'view'], {
    cwd: symbiote.repo,
    env: {
      ...appEnv(config),
      SYMBIOTE_CLAUDE: '/nonexistent/claude',
      SYMBIOTE_CODEX: '/nonexistent/codex',
      SYMBIOTE_USAGE: 'off',
    },
  });
  let output = '';
  cli.stdout.on('data', (data: Buffer) => (output += data.toString()));
  cli.stderr.on('data', (data: Buffer) => (output += data.toString()));
  const ended = new Promise((resolve) => cli.once('exit', resolve));
  try {
    await expect.poll(() => output).toMatch(/Symbiote viewer: http:\/\/127\.0\.0\.1:\d+\//);
    await expect.poll(() => output, { timeout: 30_000 }).toContain("Symbiote's window is open");
    // The app is the command's child, found by its command line: the command's other children
    // (git) come and go.
    const app = execFileSync('pgrep', ['-P', String(cli.pid), '-f', 'packages/desktop'], {
      encoding: 'utf8',
    }).trim();
    expect(app).toMatch(/^\d+$/);
    process.kill(Number(app), 'SIGTERM');
    expect(await ended).toBe(0);
    expect(output).not.toContain('opening the browser');
  } finally {
    cli.kill();
  }
});

// Symbiote's own title bar (N1c): no system frame, the OS's buttons over Symbiote's colour.
test.describe('the title bar', () => {
  test('Symbiote and the repository, fold, back and forward, the page’s tabs, the OS’s buttons', async () => {
    const { page } = await launch();
    const bar = page.locator('.titlebar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.titlebar-brand')).toHaveText(/^Symbiote · .+/);
    expect(
      await bar.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region')),
    ).toBe('drag');
    // On Linux the window's buttons are Symbiote's (N1d): no overlay of the system's over the page.
    expect(
      await page.evaluate(
        () =>
          (navigator as Navigator & { windowControlsOverlay: { visible: boolean } })
            .windowControlsOverlay.visible,
      ),
    ).toBe(false);
    for (const name of ['Minimize', 'Maximize', 'Close']) {
      await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(bar.getByRole('button', { name: 'All branches' })).toBeVisible();

    const back = bar.getByRole('button', { name: 'Back' });
    const forward = bar.getByRole('button', { name: 'Forward' });
    await expect(back).toBeDisabled();
    await page.keyboard.press('s');
    await expect(page).toHaveURL(/\/settings$/);
    await expect(bar.locator('.titlebar-label')).toHaveText('Settings');
    await back.click();
    await expect(page).toHaveURL(/\/history$/);
    await forward.click();
    await expect(page).toHaveURL(/\/settings$/);

    await bar.getByRole('button', { name: 'Fold the sidenav' }).click();
    await expect(page.locator('.shell')).toHaveClass(/folded/);
  });

  test('the window’s buttons take the theme’s colour: drawn by Symbiote on Linux, no overlay', async () => {
    const { app, page } = await launch();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) return;
      const calls: Electron.TitleBarOverlayOptions[] = [];
      Object.assign(globalThis, { overlay: calls });
      const set = window.setTitleBarOverlay.bind(window);
      window.setTitleBarOverlay = (options) => {
        calls.push(options);
        set(options);
      };
    });
    const close = page.locator('.titlebar').getByRole('button', { name: 'Close', exact: true });
    const colour = () => close.evaluate((el) => getComputedStyle(el).color);
    await page.keyboard.press('s');
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    // The text's colour, Symbiote's style since V31.
    await expect.poll(colour).toBe('rgb(10, 10, 10)');
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect.poll(colour).toBe('rgb(250, 250, 250)');
    // The overlay is the system's buttons' on Windows: none on Linux.
    expect(await app.evaluate(() => (globalThis as { overlay?: unknown[] }).overlay?.length)).toBe(
      0,
    );
  });

  test('on Linux the corners are Symbiote’s: round until maximized; its buttons ask the window (N1d)', async () => {
    const { app, page } = await launch();
    await recordWindow(app);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-frame', 'own');
    await expect(html).toHaveAttribute('data-window', 'normal');
    // The page carries the window's background and corners; around it, the window is clear.
    expect(await style(page, 'html', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    expect(await style(page, '#root', 'background-color')).toBe('rgb(10, 10, 10)');
    expect(await style(page, '#root', 'border-radius')).toBe('10px');

    const bar = page.locator('.titlebar');
    await bar.getByRole('button', { name: 'Minimize', exact: true }).click();
    await bar.getByRole('button', { name: 'Maximize', exact: true }).click();
    await expect.poll(() => calls(app)).toEqual(['minimize', 'maximize']);
    // The window says it is maximized (the display has no window manager to do it): square.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.emit('maximize'));
    await expect(html).toHaveAttribute('data-window', 'maximized');
    expect(await style(page, '#root', 'border-radius')).toBe('0px');
    await bar.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect.poll(() => calls(app)).toEqual(['minimize', 'maximize', 'unmaximize']);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.emit('unmaximize'));
    await expect(html).toHaveAttribute('data-window', 'normal');
    await expect(bar.getByRole('button', { name: 'Maximize', exact: true })).toBeVisible();
    // Full screen is square too.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.emit('enter-full-screen'),
    );
    await expect(html).toHaveAttribute('data-window', 'maximized');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.emit('leave-full-screen'),
    );
    await expect(html).toHaveAttribute('data-window', 'normal');

    await bar.getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(() => calls(app)).toEqual(['minimize', 'maximize', 'unmaximize', 'close']);
  });

  test('a workspace: its tabs and its changes’ toggle in the bar', async () => {
    const served = await serveWorkspaces();
    try {
      const { page } = await launch(served.url);
      // A workspace started opens in the main area.
      await page.getByRole('link', { name: 'Start a workspace' }).click();
      const starting = page.getByRole('region', { name: 'Start a workspace' });
      await starting.getByRole('textbox', { name: 'Title' }).fill('Add clamp');
      await starting.getByRole('textbox', { name: 'Goal' }).fill('Add clamp');
      await starting.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
      await expect(starting).toBeHidden();
      const bar = page.locator('.titlebar');
      await expect(bar.getByRole('tab', { name: 'Thread' })).toBeVisible();
      await expect(bar.getByRole('button', { name: 'Changes' })).toBeVisible();
      await bar.getByRole('tab', { name: 'Brief' }).click();
      await expect(page.locator('.workspace-brief')).toBeVisible();
    } finally {
      served.stop();
    }
  });

  test('closing with a prompt not saved asks first, in a dialog of the system', async () => {
    const { app, page } = await launch();
    await page.goto(`${symbiote.url}settings?prompt=start.spike`);
    await page
      .locator('.settings-editor')
      .getByRole('textbox', { name: 'Spike prompt' })
      .fill('Spike {branch}.\n\n{brief}\n');
    await app.evaluate(({ dialog }) => {
      const asked: string[] = [];
      Object.assign(globalThis, { asked });
      dialog.showMessageBoxSync = ((_window: unknown, options: { message: string }) => {
        asked.push(options.message);
        return 1;
      }) as typeof dialog.showMessageBoxSync;
    });
    // Playwright hears the page's beforeunload too. With a listener it leaves it to the app;
    // without one it dismisses a dialog Electron never shows, and fails.
    page.on('dialog', () => undefined);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect
      .poll(() => app.evaluate(() => (globalThis as { asked?: string[] }).asked))
      .toEqual(['Leave this page? What you changed is not saved.']);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 0;
    });
    const ended = new Promise((resolve) => app.process().once('exit', resolve));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await ended;
  });
});

// From the desktop's launcher (N1b): the app starts the repository's server itself.
test.describe('from the launcher', () => {
  const cli = join(root, 'packages/cli/dist/bin.js');

  /** What `symbiote app install` records, and the repositories opened before. */
  function installed(recent: string[] = [], record = true) {
    mkdirSync(join(config, 'symbiote', 'app'), { recursive: true });
    if (record) {
      writeFileSync(
        join(config, 'symbiote', 'app.json'),
        JSON.stringify({ node: process.execPath, cli, path: process.env.PATH }),
      );
    }
    writeFileSync(
      join(config, 'symbiote', 'app', 'state.json'),
      JSON.stringify({ choices: {}, recent }),
    );
  }

  /** The app as a launcher starts it: no address; never a real agent or your usage. */
  const launcherEnv = () => ({
    ...appEnv(config),
    SYMBIOTE_CLAUDE: '/nonexistent/claude',
    SYMBIOTE_CODEX: '/nonexistent/codex',
    SYMBIOTE_USAGE: 'off',
  });

  async function fromLauncher(): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await _electron.launch({
      executablePath: electron as string,
      args: [desktop],
      env: launcherEnv(),
    });
    running.push(app);
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    return { app, page };
  }

  /** The `symbiote view` the app started: its process ID. */
  const server = (app: ElectronApplication) => {
    try {
      const pid = String(app.process().pid);
      return execFileSync('pgrep', ['-P', pid, '-f', 'bin.js view --no-open'], {
        encoding: 'utf8',
      }).trim();
    } catch {
      return '';
    }
  };

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  test('opens the last repository on a server of its own, stopped with the window', async () => {
    installed([symbiote.repo]);
    const { app, page } = await fromLauncher();
    await expect(page.locator('.commit').first()).toBeVisible({ timeout: 20_000 });
    expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/history$/);
    await expect.poll(() => server(app)).toMatch(/^\d+$/);
    const pid = Number(server(app));

    const ended = new Promise((resolve) => app.process().once('exit', resolve));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await ended;
    await expect.poll(() => alive(pid)).toBe(false);
  });

  test('its server ends with the app, even a killed one', async () => {
    installed([symbiote.repo]);
    const { app, page } = await fromLauncher();
    await expect(page.locator('.commit').first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => server(app)).toMatch(/^\d+$/);
    const pid = Number(server(app));
    app.process().kill('SIGKILL');
    await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false);
  });

  test('the start page: a folder that is no repository, then one; the recent list', async () => {
    installed();
    const { app, page } = await fromLauncher();
    await expect(page.getByRole('heading', { name: 'Symbiote', exact: true })).toBeVisible();
    await expect(page.getByText('The repositories you open show here.')).toBeVisible();

    const notes = mkdtempSync(join(tmpdir(), 'symbiote-notes-'));
    try {
      await app.evaluate(
        ({ dialog }, chosen) => {
          dialog.showOpenDialog = () =>
            Promise.resolve({ canceled: false, filePaths: [chosen.shift() ?? ''] });
        },
        [notes, symbiote.repo],
      );
      await page.getByRole('button', { name: /Open a repository/ }).click();
      await expect(page.getByRole('status')).toContainText('not inside a git working tree');
      await page.getByRole('button', { name: /Open a repository/ }).click();
      await expect(page.locator('.commit').first()).toBeVisible({ timeout: 20_000 });
      const state = JSON.parse(
        readFileSync(join(config, 'symbiote', 'app', 'state.json'), 'utf8'),
      ) as {
        recent: string[];
      };
      expect(state.recent).toEqual([symbiote.repo]);
    } finally {
      rmSync(notes, { recursive: true, force: true });
    }
  });

  test('the start page draws the frame and the window’s buttons too, on Linux (N1d)', async () => {
    installed();
    const { app, page } = await fromLauncher();
    await expect(page.getByRole('heading', { name: 'Symbiote', exact: true })).toBeVisible();
    await recordWindow(app);
    await expect(page.locator('html')).toHaveAttribute('data-frame', 'own');
    expect(await style(page, '#root', 'border-radius')).toBe('10px');
    const bar = page.locator('.start-bar');
    await bar.getByRole('button', { name: 'Maximize', exact: true }).click();
    await bar.getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(() => calls(app)).toEqual(['maximize', 'close']);
  });

  test('launched again, the running app takes it: one window', async () => {
    installed([symbiote.repo]);
    const { app, page } = await fromLauncher();
    await expect(page.locator('.commit').first()).toBeVisible({ timeout: 20_000 });
    const again = spawn(electron as string, [desktop], { env: launcherEnv() });
    expect(await new Promise((resolve) => again.once('exit', resolve))).toBe(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  });

  test('says what to run when symbiote app install never ran', async () => {
    installed([symbiote.repo], false);
    const { page } = await fromLauncher();
    await expect(page.getByRole('status')).toContainText('run symbiote app install in a terminal');
  });
});
