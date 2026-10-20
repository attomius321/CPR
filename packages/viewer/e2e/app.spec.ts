import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './cpr.js';

// CPR's desktop app (N1): the window `cpr view` opens on its server. It needs Electron's binary
// (`pnpm app:setup`) and a display: CI runs it under xvfb-run.
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

test.skip(electron === null, 'the app is not set up: pnpm app:setup');

/** The environment for the app: its settings in `config`, on X11 (the test's display). */
function appEnv(config: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'WAYLAND_DISPLAY') env[key] = value;
  }
  return { ...env, XDG_CONFIG_HOME: config };
}

let cpr: RunningCommits;
let config: string;
const errors: string[] = [];
const running: ElectronApplication[] = [];

test.beforeAll(async () => {
  cpr = await serveCommits();
});

test.afterAll(() => cpr.stop());

test.beforeEach(() => {
  config = mkdtempSync(join(tmpdir(), 'cpr-app-'));
  errors.length = 0;
});

test.afterEach(async () => {
  for (const app of running.splice(0)) await app.close().catch(() => undefined);
  rmSync(config, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

/** The app on `url`: its first window. */
async function launch(url = cpr.url): Promise<{ app: ElectronApplication; page: Page }> {
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

test('opens the server in a window of its own: no menu bar, the page’s title', async () => {
  const { app, page } = await launch();
  expect(page.url()).toBe(`${cpr.url}history`);
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
  expect(window.title).toMatch(/^History · .+ — CPR$/);
});

test("keeps CPR's pages in the window and hands other links to the browser", async () => {
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
  await first.page.evaluate(() => window.localStorage.setItem('cpr.viewer.theme', 'light'));
  await press(first.app, '=', ['control']);
  await expect.poll(() => zoomLevel(first.app)).toBe(1);
  await first.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 40, y: 30, width: 1000, height: 700 }),
  );
  await first.app.close();
  const state = JSON.parse(readFileSync(join(config, 'cpr', 'app', 'state.json'), 'utf8')) as {
    window: unknown;
    choices: unknown;
  };
  expect(state).toMatchObject({
    window: { x: 40, y: 30, width: 1000, height: 700, maximized: false },
    zoom: 1,
    choices: { 'cpr.viewer.theme': 'light' },
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
    new RegExp(`^cpr app: could not load http://127\\.0\\.0\\.1:${port}/: `, 'm'),
  );
});

test('cpr view opens its window, and ends when the window closes', async () => {
  const cli = spawn(process.execPath, [join(root, 'packages/cli/dist/bin.js'), 'view'], {
    cwd: cpr.repo,
    env: {
      ...appEnv(config),
      CPR_CLAUDE: '/nonexistent/claude',
      CPR_CODEX: '/nonexistent/codex',
      CPR_USAGE: 'off',
    },
  });
  let output = '';
  cli.stdout.on('data', (data: Buffer) => (output += data.toString()));
  cli.stderr.on('data', (data: Buffer) => (output += data.toString()));
  const ended = new Promise((resolve) => cli.once('exit', resolve));
  try {
    await expect.poll(() => output).toMatch(/CPR viewer: http:\/\/127\.0\.0\.1:\d+\//);
    // The app is the command's child; nothing went to a browser.
    const app = () => {
      try {
        return execFileSync('pgrep', ['-P', String(cli.pid)], { encoding: 'utf8' }).trim();
      } catch {
        return '';
      }
    };
    await expect.poll(app, { timeout: 20_000 }).toMatch(/^\d+$/);
    await expect.poll(() => output, { timeout: 20_000 }).not.toContain('did not open');
    process.kill(Number(app()), 'SIGTERM');
    expect(await ended).toBe(0);
    expect(output).not.toContain('opening the browser');
  } finally {
    cli.kill();
  }
});
