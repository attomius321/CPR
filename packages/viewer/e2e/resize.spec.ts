import { expect, test, type Locator, type Page } from '@playwright/test';
import { serveFixture, type Running } from './cpr.js';

// The sidebar and the detail panel are as wide as the reviewer drags them, by mouse or keyboard,
// within limits that leave the canvas room; the widths are kept in the browser.
let cpr: Running;
const errors: string[] = [];

test.beforeAll(async () => {
  cpr = await serveFixture('detectors');
});

test.afterAll(() => cpr.stop());

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(cpr.url);
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Review' });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Symbol detail' });
const canvas = (page: Page) => page.locator('.canvas > .react-flow');
const sidebarHandle = (page: Page) =>
  page.getByRole('separator', { name: 'Resize review sidebar' });
const panelHandle = (page: Page) => page.getByRole('separator', { name: 'Resize detail panel' });

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

/** Opens the first finding's symbol: the detail panel. */
async function openPanel(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /Findings/ }).click();
  await page.locator('.finding-row').first().click();
  await expect(panel(page)).toBeVisible();
}

test('drags both panels wider and narrower, and remembers their widths', async ({ page }) => {
  expect(await width(sidebar(page))).toBe(300);
  const wide = await width(canvas(page));

  await drag(page, sidebarHandle(page), 100);
  await expect.poll(() => width(sidebar(page))).toBe(400);
  expect(await width(canvas(page))).toBe(wide - 100);

  // The panel is on the right: dragging its edge left widens it.
  await openPanel(page);
  expect(await width(panel(page))).toBe(520);
  await drag(page, panelHandle(page), -150);
  await expect.poll(() => width(panel(page))).toBe(670);

  // Kept across a reload, and for the next symbol opened.
  await page.reload();
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
  expect(await width(sidebar(page))).toBe(400);
  await openPanel(page);
  expect(await width(panel(page))).toBe(670);

  // A double-click restores the default, and that is kept too.
  await sidebarHandle(page).dblclick();
  await expect.poll(() => width(sidebar(page))).toBe(300);
  await panelHandle(page).dblclick();
  await expect.poll(() => width(panel(page))).toBe(520);
  await page.reload();
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
  expect(await width(sidebar(page))).toBe(300);
});

test('stops at each panel’s narrowest, and leaves the canvas room', async ({ page }) => {
  await drag(page, sidebarHandle(page), -500);
  await expect.poll(() => width(sidebar(page))).toBe(240);

  await openPanel(page);
  await drag(page, panelHandle(page), 400);
  await expect.poll(() => width(panel(page))).toBe(320);

  // As wide as it goes: the canvas keeps 240px.
  await drag(page, panelHandle(page), -2000);
  await expect.poll(() => width(canvas(page))).toBe(240);
  await drag(page, sidebarHandle(page), 500);
  expect(await width(canvas(page))).toBe(240);
  expect(await width(sidebar(page))).toBe(240);
});

test('resizes from the keyboard', async ({ page }) => {
  const handle = sidebarHandle(page);
  await handle.focus();
  await expect(handle).toHaveAttribute('aria-valuenow', '300');
  await expect(handle).toHaveAttribute('aria-valuemin', '240');

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => width(sidebar(page))).toBe(316);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => width(sidebar(page))).toBe(380);
  await expect(handle).toHaveAttribute('aria-valuenow', '380');
  await page.keyboard.press('Home');
  await expect.poll(() => width(sidebar(page))).toBe(240);
  await page.keyboard.press('End');
  await expect.poll(() => width(canvas(page))).toBe(240);
  await expect(handle).toHaveAttribute('aria-valuenow', String(await width(sidebar(page))));
  await page.keyboard.press('Home');

  // On the right, the left arrow widens the panel.
  await openPanel(page);
  await panelHandle(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => width(panel(page))).toBe(536);
});

test('the selection is in view again once a resize ends', async ({ page }) => {
  await openPanel(page);
  const selected = page.locator('.react-flow__node-symbol', { has: page.locator('.selected') });
  await drag(page, panelHandle(page), -600);
  await expect
    .poll(async () => {
      const node = await selected.boundingBox();
      const view = await canvas(page).boundingBox();
      return (
        !!node &&
        !!view &&
        node.x >= view.x &&
        node.x + node.width <= view.x + view.width &&
        node.y >= view.y &&
        node.y + node.height <= view.y + view.height
      );
    })
    .toBe(true);
});
