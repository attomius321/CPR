import { expect, test, type Locator, type Page } from '@playwright/test';
import { serveFixture, type Running } from './cpr.js';

// The layout is computed, not arranged by hand: dragging anywhere, a file box or a symbol
// included, moves the view and never a box.
let cpr: Running;

test.beforeAll(async () => {
  cpr = await serveFixture('detectors');
});

test.afterAll(() => cpr.stop());

const transform = (locator: Locator) =>
  locator.evaluate((el) => (el as HTMLElement).style.transform);
const viewport = (page: Page) => page.locator('.react-flow__viewport');

/** Drags from a point inside `locator` by (dx, dy) pixels. */
async function drag(page: Page, locator: Locator, dx: number, dy: number): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not drawn');
  const x = box.x + 8;
  const y = box.y + 8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

for (const kind of ['file', 'symbol']) {
  test(`dragging a ${kind} pans the canvas and leaves the ${kind} in place`, async ({ page }) => {
    await page.goto(cpr.url);
    const node = page.locator(`.react-flow__node-${kind}`).first();
    await expect(node).toBeVisible();
    // Let the opening fit settle.
    await page.waitForTimeout(500);
    const position = await transform(node);
    const view = await transform(viewport(page));

    await drag(page, node, 60, 40);

    expect(await transform(node)).toBe(position);
    expect(await transform(viewport(page))).not.toBe(view);
  });
}
