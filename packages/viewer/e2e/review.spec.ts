import { expect, test, type Page } from '@playwright/test';
import { graphPage, serveFixture, wholeFirst, type Running } from './symbiote.js';

// The detectors fixture: a removed method still called (error), two orphans (warnings), a
// compatible interface change and public API (info).
let symbiote: Running;
const errors: string[] = [];

test.beforeAll(async () => {
  symbiote = await serveFixture('detectors');
});

test.afterAll(() => symbiote.stop());

test.beforeEach(async ({ page }) => {
  // The whole change first (V109): this spec starts from it, not from the riskiest finding.
  await wholeFirst(page);
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(graphPage(symbiote.url));
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

const symbol = (page: Page, name: string) =>
  page.locator('.react-flow__node-symbol', {
    has: page.locator('.symbol-name', { hasText: name }),
  });

test('shows the change summary and every changed symbol', async ({ page }) => {
  // The commits compared are the head's title on a plain diff (V72); the counts its line.
  await expect(page.locator('.bar .revisions')).toContainText('HEAD~1');
  // The findings are the head's pills (V90); each symbol's kind a mark.
  await expect(page.locator('.bar .finding-pill.pill-error')).toHaveText('1 error');
  await expect(page.locator('.bar .finding-pill.pill-warning')).toHaveText('2 warnings');
  await expect(symbol(page, 'Canvas.clear').locator('.symbol')).toHaveClass(/tone-removed/);
  await expect(symbol(page, 'Canvas.clear').locator('.symbol-mark')).toHaveText('−');
  await expect(symbol(page, 'perimeter').locator('.symbol')).toHaveClass(/tone-added/);
  await expect(symbol(page, 'perimeter').locator('.symbol-mark')).toHaveText('+');
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
  // How far the review is, in words under the tabs (V90).
  const changes = page.locator('.review-progress');
  await expect(changes).toContainText('0 of ');
  await page.keyboard.press('j');
  const first = await page.locator('.panel-title').innerText();
  await page.keyboard.press('r');
  await expect(changes).toContainText('1 of ');
  await page.keyboard.press('j');
  await expect(page.locator('.panel-title')).not.toHaveText(first);
  await page.keyboard.press('k');
  await expect(page.locator('.panel-title')).toHaveText(first);
  await expect(page.getByRole('button', { name: 'Reviewed', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator('.review-progress')).toContainText('1 of ');
  await page.keyboard.press('Escape');
});

test('focus shows only the neighbourhood of the selection', async ({ page }) => {
  // Only nodes on screen are in the page; the minimap draws every node of the graph.
  const drawn = page.locator('.react-flow__minimap-node');
  const all = await drawn.count();
  await symbol(page, 'render').click();
  await page.keyboard.press('f');
  await expect(page.locator('.react-flow__node-symbol')).toHaveCount(3); // render, Canvas, Canvas.clear
  expect(all).toBeGreaterThan(await drawn.count());
  await page.keyboard.press('f');
  await expect(drawn).toHaveCount(all);
});

// V101: `Shape`, whose signature changed, is linked to its four users only by type references,
// which the canvas hides by default: `perimeter` and `volume` (added) are drawn, `area` and
// `Canvas.draw` (unchanged) are not.
const typeReferences = (page: Page) => page.locator('.react-flow__edge.edge-type-reference');

test('a pick raises its type references; the panel marks the users not on the canvas', async ({
  page,
}) => {
  await expect(typeReferences(page)).toHaveCount(0);
  await symbol(page, 'Shape').click();
  await expect(typeReferences(page)).toHaveCount(2);
  await expect(page.locator('.react-flow__edge.edge-type-reference.edge-raised')).toHaveCount(2);
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });
  const away = panel.locator('.neighbours li', { has: page.locator('.neighbour-away') });
  await expect(away).toHaveCount(2);
  await expect(away.filter({ hasText: 'area' })).toHaveCount(1);
  await expect(away.filter({ hasText: 'Canvas.draw' })).toHaveCount(1);
  await expect(panel.locator('.neighbour-away').first()).toHaveText('not on the canvas');
  await expect(panel.locator('.neighbours-hint')).toHaveText(
    'Press f to see the 2 not on the canvas.',
  );
  // Another pick raises its own: `perimeter` has one; with no pick, none is drawn.
  await panel.getByRole('button', { name: 'perimeter', exact: true }).click();
  await expect(panel.locator('.panel-title')).toHaveText('perimeter');
  await expect(typeReferences(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(typeReferences(page)).toHaveCount(0);
});

test('focus draws every link of the pick, type references included', async ({ page }) => {
  await symbol(page, 'Shape').click();
  await page.keyboard.press('f');
  // Shape and its four users, each linked to it.
  await expect(page.locator('.react-flow__node-symbol')).toHaveCount(5);
  await expect(symbol(page, 'area')).toBeVisible();
  await expect(symbol(page, 'Canvas.draw')).toBeVisible();
  await expect(typeReferences(page)).toHaveCount(4);
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });
  await expect(panel.locator('.neighbour-away')).toHaveCount(0);
  await expect(panel.locator('.neighbours-hint')).toHaveCount(0);
  // The toggle is left as it was.
  await expect(page.getByLabel('Type references')).not.toBeChecked();
  await page.keyboard.press('f');
  await expect(symbol(page, 'area')).toHaveCount(0);
  await expect(typeReferences(page)).toHaveCount(2);
});
