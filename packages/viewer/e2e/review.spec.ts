import { expect, test, type Page } from '@playwright/test';
import { serveFixture, type Running } from './cpr.js';

// The detectors fixture: a removed method still called (error), two orphans (warnings), a
// compatible interface change and public API (info).
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

const symbol = (page: Page, name: string) =>
  page.locator('.react-flow__node-symbol', {
    has: page.locator('.symbol-name', { hasText: name }),
  });

test('shows the change summary and every changed symbol', async ({ page }) => {
  await expect(page.locator('.summary')).toContainText('HEAD~1');
  await expect(page.locator('.summary .badge-error')).toHaveText('1 error');
  await expect(page.locator('.summary .badge-warning')).toHaveText('2 warnings');
  await expect(symbol(page, 'Canvas.clear').locator('.symbol')).toHaveClass(/tone-removed/);
  await expect(symbol(page, 'perimeter').locator('.symbol')).toHaveClass(/tone-added/);
});

test('opens a finding and shows the code that changed', async ({ page }) => {
  await page.getByRole('tab', { name: /Findings/ }).click();
  await page.locator('.finding-row', { hasText: 'removed-still-referenced' }).click();
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });
  await expect(panel.locator('.panel-title')).toHaveText('Canvas.clear');
  await expect(panel).toContainText('was removed but is still used by 1 symbol: render');
  await expect(panel.locator('.row-del')).toHaveText(/clear\(\): void \{\}/);
  await panel.getByRole('button', { name: 'render' }).click();
  await expect(panel.locator('.panel-title')).toHaveText('render');
});

test('walks the changes with the keyboard and remembers reviewed symbols', async ({ page }) => {
  await page.getByRole('tab', { name: /Changes/ }).click();
  const changes = page.getByRole('tab', { name: /Changes/ });
  await expect(changes).toContainText('0/');
  await page.keyboard.press('j');
  const first = await page.locator('.panel-title').innerText();
  await page.keyboard.press('r');
  await expect(changes).toContainText('1/');
  await page.keyboard.press('j');
  await expect(page.locator('.panel-title')).not.toHaveText(first);
  await page.keyboard.press('k');
  await expect(page.locator('.panel-title')).toHaveText(first);
  await expect(page.getByRole('button', { name: '✓ Reviewed' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('tab', { name: /Changes/ })).toContainText('1/');
  await page.keyboard.press('Escape');
});

test('focus shows only the neighbourhood of the selection', async ({ page }) => {
  const all = await page.locator('.react-flow__node-symbol').count();
  await symbol(page, 'render').click();
  await page.keyboard.press('f');
  await expect(page.locator('.react-flow__node-symbol')).toHaveCount(3); // render, Canvas, Canvas.clear
  expect(all).toBeGreaterThan(3);
  await page.keyboard.press('f');
  await expect(page.locator('.react-flow__node-symbol')).toHaveCount(all);
});

test('colours a changed line across its full width when the code scrolls', async ({ page }) => {
  // A narrow window: the panel is narrower than perimeter's first line.
  await page.setViewportSize({ width: 700, height: 900 });
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.locator('.list-link', { hasText: 'perimeter' }).click();
  const code = page.getByRole('complementary', { name: 'Symbol detail' }).locator('.code');
  await expect(code.locator('.row-add').first()).toBeVisible();

  const widths = await code.evaluate((el) => ({
    visible: el.clientWidth,
    content: el.scrollWidth,
    rows: [...el.querySelectorAll('.row')].map((row) => row.getBoundingClientRect().width),
  }));
  expect(widths.content).toBeGreaterThan(widths.visible); // the code does scroll
  for (const row of widths.rows) expect(row).toBeGreaterThanOrEqual(widths.content - 1);
});
