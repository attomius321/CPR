import { expect, test, type Browser, type Page } from '@playwright/test';
import { serveFixture, serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Symbiote's window (N1c) shows a page as a browser does: its title bar above, under it the same
// page, nothing moved into the bar (fix/title-bar-desktop). The app is Chromium with its preload's
// `window.symbioteApp`, which index.html reads before the first paint; a fake stands in for it
// here, on Linux's own frame (N1d). The real app's own specs are app.spec.ts (Electron, Xvfb).

const BAR = 38;
const WIDTH = 1440;
const HEIGHT = 900;

let running: { stop(): void }[] = [];
const errors: string[] = [];

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
  for (const served of running) served.stop();
  running = [];
  expect(errors).toEqual([]);
});

const serve = async (): Promise<RunningWorkspaces> => {
  const served = await serveWorkspaces();
  running.push(served);
  return served;
};

/** A page of its own, as a browser shows it or (`app`) as Symbiote's window does: `BAR` taller. */
async function open(browser: Browser, app: boolean, width = WIDTH): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT + (app ? BAR : 0) },
  });
  if (app) {
    await context.addInitScript(() => {
      Object.assign(window, {
        symbioteApp: {
          platform: 'linux',
          frame: 'own',
          maximized: false,
          titleBar: () => undefined,
          window: () => undefined,
          onWindowState: () => () => undefined,
        },
      });
    });
  }
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
}

type Box = { x: number; y: number; width: number; height: number } | null;

/** Where the first match of each selector is drawn, in whole pixels; null where none is. */
async function boxes(page: Page, selectors: readonly string[]): Promise<Record<string, Box>> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(
    (list) =>
      Object.fromEntries(
        list.map((selector) => {
          const box = document.querySelector(selector)?.getBoundingClientRect();
          return [
            selector,
            box && box.width > 0 && box.height > 0
              ? {
                  x: Math.round(box.x),
                  y: Math.round(box.y),
                  width: Math.round(box.width),
                  height: Math.round(box.height),
                }
              : null,
          ];
        }),
      ),
    selectors,
  );
}

/** The app draws each of `selectors` where the browser does, `BAR` lower. */
async function expectSamePage(browser: Page, app: Page, selectors: readonly string[]) {
  const seen = await boxes(browser, selectors);
  for (const selector of selectors) expect(seen[selector], selector).not.toBeNull();
  const shifted = Object.fromEntries(
    Object.entries(seen).map(([selector, box]) => [selector, box && { ...box, y: box.y + BAR }]),
  );
  expect(await boxes(app, selectors)).toEqual(shifted);
}

/** The sidenav's top and pages, and the main area: every page of the shell has them. */
const SHELL = [
  '.sidenav-top',
  '.sidenav-brand',
  '.sidenav-fold',
  '.sidenav-pages',
  '.sidenav-foot',
  '.shell-main',
  '.shell-main > *',
  '.statusbar',
];

test('a workspace: under the title bar, the browser’s page — its tabs in their card, Changes in its head', async ({
  browser,
}) => {
  const symbiote = await serve();
  const inBrowser = await open(browser, false);
  await inBrowser.goto(symbiote.url);
  await inBrowser.getByRole('link', { name: 'Start a workspace' }).click();
  const starting = inBrowser.getByRole('region', { name: 'Start a workspace' });
  await starting.getByRole('textbox', { name: 'Title' }).fill('Add clamp');
  await starting.getByRole('textbox', { name: 'Goal' }).fill('Add clamp');
  await starting.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  await expect(starting).toBeHidden();
  await inBrowser.getByRole('button', { name: 'New shell' }).click();
  await expect(inBrowser.getByRole('tab', { name: 'Shell 1' })).toBeVisible();
  // Loaded again, as the app loads it: the status bar's notice of the start is gone.
  await inBrowser.reload();
  // Brief: a tab whose pane does not change as the agent works.
  await inBrowser.getByRole('tab', { name: 'Brief' }).click();
  await expect(inBrowser.locator('.workspace-brief')).toBeVisible();

  const inApp = await open(browser, true);
  await inApp.goto(inBrowser.url());
  await expect(inApp.locator('.titlebar')).toBeVisible();
  await inApp.getByRole('tab', { name: 'Brief' }).click();
  await expect(inApp.getByRole('tab', { name: 'Shell 1' })).toBeVisible();
  await expect(inApp.locator('.workspace-brief')).toBeVisible();

  await expectSamePage(inBrowser, inApp, [
    ...SHELL,
    '.workspace-top',
    '.workspace-top h1',
    '.changes-toggle',
    '.workspace-main',
    '.workspace-views',
    '.workspace-views [role="tab"]',
    '.workspace-views .shell-tab',
    '.workspace-views .shell-new',
    '.workspace-brief',
  ]);
});

test('the title bar holds the window’s own: Back, Forward, the page’s title, its buttons', async ({
  browser,
}) => {
  const symbiote = await serve();
  const page = await open(browser, true);
  await page.goto(symbiote.url);
  await expect(page.locator('.commit').first()).toBeVisible();
  const bar = page.locator('.titlebar');
  const names = await bar
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
  expect(names).toEqual(['Back', 'Forward', 'Minimize', 'Maximize', 'Close']);
  await expect(bar.getByRole('tab')).toHaveCount(0);
  // The window's title, as the taskbar shows it and a browser's tab.
  await expect(bar.locator('.titlebar-title')).toHaveText(await page.title());
  await page.keyboard.press('s');
  await expect(bar.locator('.titlebar-title')).toHaveText(/^Settings · .+ — Symbiote$/);
  // Nothing of it lies outside its 38 px.
  const outside = await bar.evaluate((element) => {
    const { top, bottom } = element.getBoundingClientRect();
    return [...element.querySelectorAll('*')].filter((child) => {
      const box = child.getBoundingClientRect();
      return box.height > 0 && (box.top < top || box.bottom > bottom);
    }).length;
  });
  expect(outside).toBe(0);
});

test('every page of the shell: under the title bar, the browser’s page', async ({ browser }) => {
  const symbiote = await serve();
  const inBrowser = await open(browser, false);
  const inApp = await open(browser, true);
  const pages: [string, string[]][] = [
    ['history', ['.commits-title', '.scopes', '.commit']],
    ['scout', []],
    ['skills', []],
    ['monitor', []],
    ['workspace-history', ['.history-none']],
    ['settings', ['.settings-list']],
    ['start', ['.start-page input[name="title"]']],
  ];
  for (const [path, selectors] of pages) {
    for (const page of [inBrowser, inApp]) {
      await page.goto(`${symbiote.url}${path}`);
      await expect(page.locator('.shell-main > *').first()).toBeVisible();
      for (const selector of selectors) await expect(page.locator(selector).first()).toBeVisible();
    }
    await expectSamePage(inBrowser, inApp, [...SHELL, ...selectors]);
  }
});

test('narrow: the strip that opens the sidenav, as in a browser; the drawer under the title bar', async ({
  browser,
}) => {
  const symbiote = await serve();
  const inBrowser = await open(browser, false, 800);
  const inApp = await open(browser, true, 800);
  for (const page of [inBrowser, inApp]) {
    await page.goto(`${symbiote.url}git`);
    await expect(page.locator('.commit').first()).toBeVisible();
  }
  await expectSamePage(inBrowser, inApp, ['.shell-top', '.shell-main', '.commits-title']);
  await inApp.getByRole('button', { name: 'Open the sidenav' }).click();
  const drawer = await inApp.locator('.sidenav').boundingBox();
  expect(drawer?.y).toBe(BAR);
  await expect(inApp.locator('.titlebar').getByRole('button', { name: 'Close' })).toBeVisible();
});

test('a diff of symbiote view: under the title bar, the browser’s page, its bar’s name too', async ({
  browser,
}) => {
  const diff = await serveFixture('callers');
  running.push(diff);
  const inBrowser = await open(browser, false);
  const inApp = await open(browser, true);
  for (const page of [inBrowser, inApp]) {
    await page.goto(diff.url);
    await expect(page.getByRole('navigation', { name: 'Files' })).toBeVisible({ timeout: 20_000 });
  }
  await expectSamePage(inBrowser, inApp, [
    '.sidenav-top',
    '.sidenav-fold',
    '.sidenav-pages',
    '.sidenav-foot',
    '.app > .bar',
    '.app > .bar .page-icon',
    '.files-side',
  ]);
});
