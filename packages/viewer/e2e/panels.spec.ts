import { expect, test, type Locator, type Page } from '@playwright/test';
import { graphPage, serveFixture, serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// V34: the shell's sidenav and a workspace's changes are as wide as the person drags them, by mouse
// or keyboard, within limits that leave the main area and the terminal room; the widths are kept
// in the browser. The diff's own panels: resize.spec.ts.
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

const POLL = { timeout: 12_000 };
const BRANCH = 'feature/add-a-half-function';
const sidenav = (page: Page) => page.getByRole('complementary', { name: 'Pages and workspaces' });
const main = (page: Page) => page.locator('.shell-main');
const sidenavHandle = (page: Page) => page.getByRole('separator', { name: 'Resize sidebar' });
const workspace = (page: Page) => page.getByRole('region', { name: `Workspace ${BRANCH}` });
const changes = (page: Page) => workspace(page).getByRole('complementary', { name: 'Changes' });
const terminal = (page: Page) => workspace(page).locator('.workspace-main');
const changesHandle = (page: Page) => page.getByRole('separator', { name: 'Resize changes panel' });
const history = async (page: Page, url: string) => {
  await page.goto(`${url}history`);
  await expect(page.locator('.commit').first()).toBeVisible();
};
const start = async (page: Page) => {
  await sidenav(page).getByRole('link', { name: 'Start a workspace' }).click();
  const form = page.getByRole('region', { name: 'Start a workspace' });
  await form.getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await form.getByRole('textbox', { name: 'Goal' }).fill('Add a half function');
  await form.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  await expect(form).toBeHidden();
  await expect(changes(page)).toBeVisible();
};
/** The size the fake agent last printed: its terminal's columns. */
const columns = async (page: Page) => {
  const text = (await workspace(page).locator('.xterm-rows').textContent()) ?? '';
  return Number([...text.matchAll(/\[(\d+)x(\d+)\]/g)].at(-1)?.[1] ?? 0);
};

const width = (locator: Locator) =>
  locator.evaluate((el) => Math.round(el.getBoundingClientRect().width));

/** Drags a handle sideways by `dx` pixels. */
async function drag(page: Page, handle: Locator, dx: number): Promise<void> {
  const box = await handle.boundingBox();
  if (!box) throw new Error('handle not drawn');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

test('drags the sidenav wider and narrower; kept across a reload and a fold', async ({ page }) => {
  const symbiote = await serve();
  await history(page, symbiote.url);
  expect(await width(sidenav(page))).toBe(300);
  const wide = await width(main(page));

  await drag(page, sidenavHandle(page), 100);
  await expect.poll(() => width(sidenav(page))).toBe(400);
  expect(await width(main(page))).toBe(wide - 100);

  await page.reload();
  await expect(page.locator('.commit').first()).toBeVisible();
  expect(await width(sidenav(page))).toBe(400);

  // Folded, a rail without a handle; opened, the width it had.
  await page.keyboard.press('[');
  await expect(sidenav(page)).toHaveClass(/rail/);
  expect(await width(sidenav(page))).toBeLessThanOrEqual(56);
  await expect(sidenavHandle(page)).toHaveCount(0);
  await page.keyboard.press('[');
  await expect.poll(() => width(sidenav(page))).toBe(400);

  // A double-click restores the default, and that is kept too.
  await sidenavHandle(page).dblclick();
  await expect.poll(() => width(sidenav(page))).toBe(300);
  await page.reload();
  await expect(page.locator('.commit').first()).toBeVisible();
  expect(await width(sidenav(page))).toBe(300);
});

test('the sidenav stops at 180 and 480 px, and leaves the main area 480 px', async ({ page }) => {
  const symbiote = await serve();
  await history(page, symbiote.url);
  await drag(page, sidenavHandle(page), -500);
  await expect.poll(() => width(sidenav(page))).toBe(180);
  await drag(page, sidenavHandle(page), 1000);
  await expect.poll(() => width(sidenav(page))).toBe(480);

  await page.setViewportSize({ width: 920, height: 900 });
  await sidenavHandle(page).dblclick();
  await expect.poll(() => width(sidenav(page))).toBe(300);
  await drag(page, sidenavHandle(page), 1000);
  await expect.poll(() => width(main(page))).toBe(480);
  expect(await width(sidenav(page))).toBe(440);
});

test('resizes the sidenav from the keyboard', async ({ page }) => {
  const symbiote = await serve();
  await history(page, symbiote.url);
  const handle = sidenavHandle(page);
  await handle.focus();
  // 300 px at first since V79 (264 since V61, 240 before).
  await expect(handle).toHaveAttribute('aria-valuenow', '300');
  await expect(handle).toHaveAttribute('aria-valuemin', '180');
  await expect(handle).toHaveAttribute('aria-valuemax', '480');

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => width(sidenav(page))).toBe(316);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => width(sidenav(page))).toBe(380);
  await expect(handle).toHaveAttribute('aria-valuenow', '380');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => width(sidenav(page))).toBe(364);
  await page.keyboard.press('Home');
  await expect.poll(() => width(sidenav(page))).toBe(180);
  await page.keyboard.press('End');
  await expect.poll(() => width(sidenav(page))).toBe(480);
});

test('narrow: the sidenav is a drawer, without a handle', async ({ page }) => {
  const symbiote = await serve();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${symbiote.url}git`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await expect(sidenavHandle(page)).toBeHidden();
  await page.getByRole('button', { name: 'Open the sidenav' }).click();
  await expect(sidenav(page)).toBeVisible();
  await expect(sidenavHandle(page)).toBeHidden();
});

test("a diff's sidenav, once opened, resizes too", async ({ page }) => {
  const diff = await serveFixture('callers');
  running.push(diff);
  await page.goto(graphPage(diff.url));
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  // A rail at first (decision 182): no handle.
  await expect(sidenavHandle(page)).toHaveCount(0);
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('[');
  await expect(sidenav(page)).not.toHaveClass(/rail/);
  await drag(page, sidenavHandle(page), 60);
  await expect.poll(() => width(sidenav(page))).toBe(360);
  await page.reload();
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  expect(await width(sidenav(page))).toBe(360);
});

test("drags a workspace's changes wider and narrower; the terminal follows", async ({ page }) => {
  const symbiote = await serve();
  await history(page, symbiote.url);
  await start(page);
  expect(await width(changes(page))).toBe(256);
  await expect.poll(() => columns(page), POLL).toBeGreaterThan(0);
  const before = await columns(page);

  // The panel is on the right: dragging its edge left widens it.
  await drag(page, changesHandle(page), -144);
  await expect.poll(() => width(changes(page))).toBe(400);
  // 144 px is 16 cells of 9 px (Geist Mono at 15 px since V61; 18 of 8 px at 14).
  await expect.poll(() => columns(page), POLL).toBe(before - 16);

  await page.reload();
  await expect(changes(page)).toBeVisible();
  expect(await width(changes(page))).toBe(400);

  // Hidden and shown again, the width it had.
  await workspace(page).getByRole('button', { name: 'Changes' }).click();
  await expect(changes(page)).toBeHidden();
  await expect(changesHandle(page)).toHaveCount(0);
  await workspace(page).getByRole('button', { name: 'Changes' }).click();
  await expect.poll(() => width(changes(page))).toBe(400);

  await changesHandle(page).dblclick();
  await expect.poll(() => width(changes(page))).toBe(256);
});

test("a workspace's changes stop at 200 px, and leave the terminal 480 px", async ({ page }) => {
  const symbiote = await serve();
  await history(page, symbiote.url);
  await start(page);
  await drag(page, changesHandle(page), 500);
  await expect.poll(() => width(changes(page))).toBe(200);
  await drag(page, changesHandle(page), -2000);
  await expect.poll(() => width(terminal(page))).toBe(480);

  // From the keyboard: on the right, the left arrow widens it.
  const handle = changesHandle(page);
  await handle.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => width(changes(page))).toBe(200);
  await expect(handle).toHaveAttribute('aria-valuenow', '200');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => width(changes(page))).toBe(216);
  await page.keyboard.press('End');
  await expect.poll(() => width(terminal(page))).toBe(480);
});
