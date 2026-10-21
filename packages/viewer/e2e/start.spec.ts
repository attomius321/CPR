import { expect, test, type Page } from '@playwright/test';
import { serveFixture, serveWorkspaces, type RunningWorkspaces } from './cpr.js';

// Start a workspace as a page (V30a): /start in the main area, right of the sidenav; the brief and
// the run side by side; back to where it was opened from; a start takes its place in the history.
let running: { stop(): void }[] = [];
const errors: string[] = [];
const serve = async (): Promise<RunningWorkspaces> => {
  const served = await serveWorkspaces();
  running.push(served);
  return served;
};

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  for (const served of running) served.stop();
  running = [];
  expect(errors).toEqual([]);
});

const sidenav = (page: Page) => page.getByRole('complementary', { name: 'Pages and workspaces' });
const startLink = (page: Page) => sidenav(page).getByRole('link', { name: 'Start a workspace' });
const start = (page: Page) => page.getByRole('region', { name: 'Start a workspace' });
const title = (page: Page) => start(page).getByRole('textbox', { name: 'Title' });
const goal = (page: Page) => start(page).getByRole('textbox', { name: 'Goal' });
const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);

test('Start a workspace is a page right of the sidenav, at /start', async ({ page }) => {
  const cpr = await serve();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${cpr.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await startLink(page).click();
  await expect(page).toHaveURL(`${cpr.url}start`);
  await expect(start(page)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(title(page)).toBeFocused();
  await expect(startLink(page)).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle(/^Start a workspace · /);
  await expect(start(page)).toContainText(`From main at ${short(cpr.shas.at(-1))}`);
  // The whole main area: from the sidenav's edge to the window's.
  const nav = await sidenav(page).boundingBox();
  const box = await start(page).boundingBox();
  expect(Math.abs((box?.x ?? 0) - ((nav?.x ?? 0) + (nav?.width ?? 0)))).toBeLessThanOrEqual(1);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBe(1440);

  // Its address loads it.
  await page.reload();
  await expect(title(page)).toBeVisible();
  // The sidenav stays usable: History opens in place.
  await sidenav(page).getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(`${cpr.url}history`);
  await expect(start(page)).toHaveCount(0);
});

test('n opens it from any page; on it, n goes back to the title', async ({ page }) => {
  const cpr = await serve();
  await page.goto(`${cpr.url}settings`);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('n');
  await expect(page).toHaveURL(`${cpr.url}start`);
  await expect(title(page)).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('n');
  await expect(title(page)).toBeFocused();
  await expect(title(page)).toHaveValue('');
});

test('Escape and Cancel go back to the page it was opened from; the draft stays', async ({
  page,
}) => {
  const cpr = await serve();
  await page.goto(`${cpr.url}settings`);
  await startLink(page).click();
  await title(page).fill('Keep me');
  await title(page).press('Escape');
  await expect(page).toHaveURL(`${cpr.url}settings`);
  await startLink(page).click();
  await expect(title(page)).toHaveValue('Keep me');

  await sidenav(page).getByRole('link', { name: 'History' }).click();
  await startLink(page).click();
  await start(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(`${cpr.url}history`);

  // Opened by its address, with no page of CPR's before it: Cancel goes to History.
  const fresh = await page.context().newPage();
  await fresh.goto(`${cpr.url}start`);
  await start(fresh).getByRole('button', { name: 'Cancel' }).click();
  await expect(fresh).toHaveURL(`${cpr.url}history`);
  await expect(title(fresh)).toHaveCount(0);
});

test('a start takes its place in the history: Back goes to the page before it', async ({
  page,
}) => {
  const cpr = await serve();
  await page.goto(`${cpr.url}history`);
  await startLink(page).click();
  await title(page).fill('Add clamp');
  await goal(page).fill('Clamp a value.');
  await goal(page).press('Control+Enter');
  await expect(page).toHaveURL(`${cpr.url}?branch=feature%2Fadd-clamp`);
  await expect(page.getByRole('region', { name: 'Workspace feature/add-clamp' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`${cpr.url}history`);
});

test('the brief and the run side by side; More open without a scroll at 1440 × 900; one column on a phone', async ({
  page,
}) => {
  const cpr = await serve();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${cpr.url}start`);
  const brief = page.locator('.start-brief');
  const run = page.locator('.start-run');
  await start(page).getByRole('button', { name: /^More/ }).click();
  await expect(start(page).getByRole('textbox', { name: 'Notes optional' })).toBeVisible();
  let b = await brief.boundingBox();
  let r = await run.boundingBox();
  expect(r?.x ?? 0).toBeGreaterThanOrEqual((b?.x ?? 0) + (b?.width ?? 0));
  expect(Math.abs((r?.y ?? 0) - (b?.y ?? 0))).toBeLessThanOrEqual(1);
  // The text areas use the room: wider than the dialog's 598 px.
  expect((await goal(page).boundingBox())?.width ?? 0).toBeGreaterThan(640);
  const scrolls = await page
    .locator('.start-body')
    .evaluate((body) => body.scrollHeight > body.clientHeight);
  expect(scrolls).toBe(false);
  await expect(start(page).getByRole('button', { name: 'Start', exact: true })).toBeInViewport();

  await page.setViewportSize({ width: 390, height: 844 });
  b = await brief.boundingBox();
  r = await run.boundingBox();
  expect(r?.y ?? 0).toBeGreaterThanOrEqual((b?.y ?? 0) + (b?.height ?? 0));
  // The head and its Start stay in view while the form scrolls.
  await run.scrollIntoViewIfNeeded();
  await expect(start(page).getByRole('button', { name: 'Start', exact: true })).toBeInViewport();
});

test("from a diff, the sidenav's Start and n load /start", async ({ page }) => {
  const diff = await serveFixture('callers');
  running.push(diff);
  await page.goto(diff.url);
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('[');
  await startLink(page).click();
  await expect(page).toHaveURL(new URL('/start', diff.url).href);
  await expect(title(page)).toBeVisible();

  await page.goBack();
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('n');
  await expect(page).toHaveURL(new URL('/start', diff.url).href);
});
