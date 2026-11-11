import { expect, test, type Page } from '@playwright/test';
import { graphPage, serveFixture, type RunningFixture } from './symbiote.js';

// V104 (decisions 977–978): Graph and Files follow the pick. `g` with a symbol picked opens its
// file on Files at its first changed row; a removed symbol, or one moved to another file, at its
// deleted rows in the file it left. `g` on Files picks the symbol holding the line last clicked.
// The fixture: src/shapes.ts gains an 84-line table above `area` (changed) and loses `perimeter`,
// so both are far down its diff; `toCentimetres` moves from src/units.ts to src/convert.ts. No
// finding: the list is in git's order, src/convert.ts first.
let symbiote: RunningFixture;
const errors: string[] = [];

test.beforeAll(async () => {
  symbiote = await serveFixture('packages/viewer/test/fixtures/graph-files-follow');
});

test.afterAll(() => symbiote.stop());

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => expect(errors).toEqual([]));

const AREA = 'src/shapes.ts#area';

/** A row of the open file's diff, by its place: `head:<line>` or `base:<line>`. */
const row = (page: Page, key: string) => page.locator(`.file-code [data-key="${key}"]`);
const line = (page: Page, text: string) =>
  page.locator('.file-code [role="row"]').filter({ hasText: text });
const active = (page: Page) => page.locator('.page-switch .scope.active');
const panelTitle = (page: Page) => page.locator('.panel-title');
/** Picks a symbol on the Graph page from the change list. */
const pick = (page: Page, name: string) =>
  page.locator('.list-link', { hasText: new RegExp(`^${name}$`) }).click();

test('g with a symbol picked shows its first changed line on Files', async ({ page }) => {
  await page.goto(graphPage(symbiote.url));
  await pick(page, 'area');
  await expect(panelTitle(page)).toHaveText('area');

  await page.keyboard.press('g');
  await expect(active(page)).toHaveText('Files');
  await expect(page.locator('.file-path')).toHaveText('src/shapes.ts');
  await expect(page.locator('.file-position')).toHaveText('2 of 4');
  // Its first added line, 86 rows down, in view and marked.
  const first = row(page, 'head:86');
  await expect(first).toContainText('export function area');
  await expect(first).toBeInViewport();
  await expect(first).toHaveClass(/anchored/);
});

test('a removed symbol shows its deleted rows; one moved away, them in the file it left', async ({
  page,
}) => {
  await page.goto(graphPage(symbiote.url));
  await pick(page, 'perimeter');
  await page.keyboard.press('g');
  await expect(page.locator('.file-path')).toHaveText('src/shapes.ts');
  await expect(row(page, 'base:5')).toContainText('export function perimeter');
  await expect(row(page, 'base:5')).toBeInViewport();

  // Back, the pick kept: no line was clicked.
  await page.keyboard.press('g');
  await expect(active(page)).toHaveText('Graph');
  await expect(panelTitle(page)).toHaveText('perimeter');

  // Moved to src/convert.ts unchanged: its deleted rows in src/units.ts.
  await pick(page, 'toCentimetres');
  await page.keyboard.press('g');
  await expect(page.locator('.file-path')).toHaveText('src/units.ts');
  await expect(row(page, 'base:7')).toContainText('export function toCentimetres');
  await expect(row(page, 'base:7')).toHaveClass(/row-del/);
  await expect(row(page, 'base:7')).toBeInViewport();
});

test('g on Files picks the symbol holding the line clicked, and the canvas shows it', async ({
  page,
}) => {
  await page.goto(symbiote.url);
  await expect(page.locator('.file-path')).toHaveText('src/convert.ts');
  await page.getByRole('button', { name: 'Show the changes to src/shapes.ts' }).click();
  // No review on this page: a click takes no comment, but marks the line.
  await line(page, 'return Math.abs').click();
  await expect(line(page, 'return Math.abs')).toHaveClass(/anchored/);

  await page.keyboard.press('g');
  await expect(active(page)).toHaveText('Graph');
  await expect(panelTitle(page)).toHaveText('area');
  const area = page.locator(`.react-flow__node[data-id="${AREA}"]`);
  await expect(area.locator('.symbol')).toHaveClass(/selected/);
  await expect(area).toBeInViewport();

  // A deleted line: the symbol it was in, on the base side.
  await page.keyboard.press('g');
  await expect(page.locator('.file-path')).toHaveText('src/shapes.ts');
  await line(page, 'return 2 * (w + h)').click();
  await page.keyboard.press('g');
  await expect(panelTitle(page)).toHaveText('perimeter');

  // A line clicked, then another file shown: g leaves the pick as it was.
  await page.keyboard.press('g');
  await line(page, 'return Math.abs').click();
  await page.keyboard.press('j');
  await expect(page.locator('.file-path')).toHaveText('src/units.ts');
  await page.keyboard.press('g');
  await expect(active(page)).toHaveText('Graph');
  await expect(panelTitle(page)).toHaveText('perimeter');
});

test('"Show its lines" in the panel does what g does', async ({ page }) => {
  await page.goto(graphPage(symbiote.url));
  await pick(page, 'toCentimetres');
  await page
    .getByRole('complementary', { name: 'Symbol detail' })
    .getByRole('button', { name: 'Show its lines' })
    .click();
  await expect(active(page)).toHaveText('Files');
  await expect(page.locator('.file-path')).toHaveText('src/units.ts');
  await expect(row(page, 'base:7')).toBeInViewport();
});

test('without a pick, g goes back to the file read', async ({ page }) => {
  await page.goto(symbiote.url);
  await page.getByRole('button', { name: 'Show the changes to README.md' }).click();
  await page.keyboard.press('g');
  await expect(active(page)).toHaveText('Graph');
  await page.keyboard.press('g');
  await expect(page.locator('.file-path')).toHaveText('README.md');

  // A pick cleared with Esc: the same.
  await page.keyboard.press('g');
  await pick(page, 'area');
  await page.keyboard.press('Escape');
  await page.keyboard.press('g');
  await expect(page.locator('.file-path')).toHaveText('README.md');
});
