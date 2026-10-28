import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { electronBinary } from '../src/app-window.js';
import {
  cacheFolder,
  homeFolder,
  repository,
  startNexus,
  startView,
  stopRecorded,
  type Served,
} from './nexus.js';

// Symbiote nexus in Symbiote's window (NX1c, decision 524): the desktop app's `--url` mode, as
// `symbiote view` opens it, untouched. As the viewer's `e2e/app.spec.ts`: Electron's binary
// (`pnpm app:setup`) and a display of the specs' own (Xvfb), never the person's screen.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const desktop = join(root, 'packages/desktop');
const nexusBin = join(root, 'packages/nexus/dist/bin.js');
// Never by requiring Electron's package: it downloads its binary when it has none (IN1).
const electron = electronBinary(desktop);

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

/** A display of the specs' own: as the viewer's app spec starts one (its comment says why). */
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
let cache: { dir: string; remove(): void };
let repo: { dir: string; remove(): void };
let alpha: Served;
let nexus: Served;
let config: string;
const running: ElectronApplication[] = [];

/** The app's environment: its settings in `config`, on the specs' display, no lines of yours. */
function appEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'WAYLAND_DISPLAY' && key !== 'SYMBIOTE_APP')
      env[key] = value;
  }
  return { ...env, DISPLAY: display.name, XDG_CONFIG_HOME: config, SYMBIOTE_LOG: 'off' };
}

test.beforeAll(async () => {
  cache = cacheFolder();
  repo = repository('alpha');
  [display, alpha] = await Promise.all([startXvfb(), startView(repo.dir, cache.dir)]);
  nexus = await startNexus(cache.dir);
});

test.afterAll(async () => {
  await nexus.stop();
  await alpha.stop();
  display.stop();
  repo.remove();
  cache.remove();
});

test.beforeEach(() => {
  config = mkdtempSync(join(tmpdir(), 'symbiote-nexus-app-'));
});

test.afterEach(async () => {
  for (const app of running.splice(0)) await app.close().catch(() => undefined);
  rmSync(config, { recursive: true, force: true });
});

test('shows the nexus in Symbiote’s window: its buttons, and a Symbiote framed as in a browser', async () => {
  const app = await _electron.launch({
    executablePath: electron as string,
    args: [desktop, '--url', nexus.url, '--title', 'Symbiote nexus'],
    env: appEnv(),
  });
  running.push(app);
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.locator('.nexus-home h1')).toHaveText('Symbiotes');

  // Linux: the page draws the window's frame and buttons (N1d), in its row.
  await expect(page.locator('html')).toHaveAttribute('data-app', 'linux');
  await expect(page.locator('html')).toHaveAttribute('data-frame', 'own');
  const buttons = page.locator('.nexus-bar .window-buttons button');
  await expect(buttons).toHaveText(['', '', '']);
  await expect(buttons.nth(0)).toHaveAttribute('aria-label', 'Minimize');
  await expect(buttons.nth(2)).toHaveAttribute('aria-label', 'Close');

  // The framed viewer is drawn as in a browser: the app's preload is the top page's only.
  await page
    .locator('.nexus-tabs')
    .getByRole('tab', { name: /^alpha/ })
    .click();
  const framed = page.frameLocator('iframe[title="alpha"]');
  await expect(framed.getByText('second', { exact: true }).first()).toBeVisible();
  const frame = page.frame({ url: (url) => url.href.startsWith(alpha.url) });
  expect(await frame?.evaluate(() => document.documentElement.dataset.app ?? null)).toBeNull();
  await expect(framed.locator('.titlebar')).toBeHidden();

  // The window's title is the page's: the taskbar and Alt+Tab say which Symbiote is open.
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()))
    .toBe('alpha · main — Symbiote nexus');
  expect(errors).toEqual([]);
});

test('opens a Symbiote from Folders in Symbiote’s window (NX2)', async () => {
  const home = homeFolder(['beta']);
  const own = cacheFolder();
  const served = await startNexus(own.dir, home.dir);
  try {
    const app = await _electron.launch({
      executablePath: electron as string,
      args: [desktop, '--url', served.url, '--title', 'Symbiote nexus'],
      env: appEnv(),
    });
    running.push(app);
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.nexus-tabs').getByRole('tab', { name: 'Folders' }).click();
    await page.locator('.nexus-folder-open', { hasText: 'projects' }).click();
    await page.getByRole('button', { name: 'Open Symbiote in beta' }).click();
    await expect(
      page.frameLocator('iframe[title="beta"]').locator('.commit').first(),
    ).toBeVisible();
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()))
      .toBe('beta · main — Symbiote nexus');
    expect(errors).toEqual([]);
  } finally {
    await served.stop();
    await stopRecorded(own.dir);
    own.remove();
    home.remove();
  }
});

test('symbiote-nexus opens the window itself, and ends when it closes', async () => {
  const child = spawn(process.execPath, [nexusBin], {
    env: { ...appEnv(), SYMBIOTE_CACHE_DIR: cache.dir },
  });
  let out = '';
  child.stdout.on('data', (data: Buffer) => (out += data.toString()));
  const ended = new Promise<number | null>((resolve) => child.once('exit', resolve));
  await expect
    .poll(() => out, { timeout: 30_000 })
    .toContain("Symbiote nexus's window is open: close it, or Ctrl+C, to stop");
  // Its window's process (Electron's main): ended, as closing the window ends it.
  const app = execFileSync('pgrep', ['-P', String(child.pid)], { encoding: 'utf8' }).trim();
  expect(app).toMatch(/^\d+$/);
  process.kill(Number(app), 'SIGTERM');
  expect(await ended).toBe(0);
});
