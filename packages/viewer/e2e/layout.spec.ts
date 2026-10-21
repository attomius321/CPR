import { expect, test } from '@playwright/test';
import { serveFixture, type Running } from './symbiote.js';

// Layouts are made in a worker (V8e): the page stays usable while one is made, the canvas keeps
// the last layout until the next arrives, and a view laid out before comes back at once.
let symbiote: Running;
const errors: string[] = [];

test.beforeAll(async () => {
  symbiote = await serveFixture('callers');
});

test.afterAll(() => symbiote.stop());

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => expect(errors).toEqual([]));

const symbols = (page: import('@playwright/test').Page) => page.locator('.react-flow__node-symbol');

test('the change list shows while the first layout is made', async ({ page }) => {
  // Hold the worker back: no layout can arrive until it is let through.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/layout-worker*.js', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(symbiote.url);

  await expect(page.locator('.layout-pending')).toHaveText('Laying out…');
  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(page.locator('.list-item').first()).toBeVisible();
  await expect(symbols(page)).toHaveCount(0);

  release();
  await expect(symbols(page).first()).toBeVisible();
  await expect(page.locator('.layout-pending')).toHaveCount(0);
});

test('a view laid out before comes back at once', async ({ page }) => {
  await page.goto(symbiote.url);
  await expect(symbols(page).first()).toBeVisible();
  const all = await symbols(page).count();
  const context = page.getByLabel('Context', { exact: true });

  await context.uncheck();
  await expect.poll(() => symbols(page).count()).toBeLessThan(all);
  await expect(page.locator('.layout-pending')).toHaveCount(0);

  // Watch for the note from now on: back to the first view, it never shows.
  await page.evaluate(() => {
    const flag = globalThis as unknown as { pendingSeen: boolean };
    flag.pendingSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('.layout-pending')) flag.pendingSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await context.check();
  await expect(symbols(page)).toHaveCount(all);
  expect(
    await page.evaluate(() => (globalThis as unknown as { pendingSeen: boolean }).pendingSeen),
  ).toBe(false);
});
