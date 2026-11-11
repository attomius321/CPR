import { expect, test, type Page } from '@playwright/test';
import { graphPage, serveFixture, type RunningFixture } from './symbiote.js';

// V109 (decision 986): the Graph page opens on the riskiest finding. With an error or a warning,
// its first view is the first such finding's symbol, focused, readable, its panel open; F shows
// the whole change and back, and the choice is kept in the browser. A change with only infos, or
// none, opens as before: the whole change fitted, nothing picked.
//
// `callers`: `legacy` removed and still used by `old` (error), `triple` added and unused
// (warning), `add` changed compatibly (info, settled), `total` unchanged. Focus on `legacy` draws
// it, its user `old` and `add` it called; not `triple`, not `total`. `first-view-notes`: `volume`
// added as public API (info), `Shape` changed compatibly (info, settled), `area` changed.
let callers: RunningFixture;
let notes: RunningFixture;
const errors: string[] = [];

test.beforeAll(async () => {
  [callers, notes] = await Promise.all([
    serveFixture('callers'),
    serveFixture('packages/viewer/test/fixtures/first-view-notes'),
  ]);
});

test.afterAll(() => {
  callers.stop();
  notes.stop();
});

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => expect(errors).toEqual([]));

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const panelTitle = (page: Page) => page.locator('.panel-title');
const focusBox = (page: Page) => page.getByRole('checkbox', { name: 'Focus' });
const pending = (page: Page) => page.locator('.layout-pending');
const LEGACY = 'src/math.ts#legacy';
const TRIPLE = 'src/math.ts#triple';

/** React Flow's zoom as drawn. */
const zoomOf = (page: Page) =>
  page
    .locator('.react-flow__viewport')
    .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);

/** A name drawn at 11 px or more (V99): the graph's names are 12 px at zoom 1. */
const READABLE = 11 / 12;
/** Whole in view: 1, but for the float of a box's edge (0.9999997). */
const WHOLE = { ratio: 0.99 };

/** The risk's view: `legacy` picked and focused, readable, in view, its panel and row shown. */
async function expectRisk(page: Page) {
  await expect(panelTitle(page)).toHaveText('legacy');
  await expect(focusBox(page)).toBeChecked();
  await expect(node(page, LEGACY).locator('.symbol')).toHaveClass(/selected/);
  await expect(node(page, 'src/app.ts#old')).toBeVisible();
  await expect(node(page, TRIPLE)).toHaveCount(0);
  await expect(pending(page)).toHaveCount(0);
  await expect(node(page, LEGACY)).toBeInViewport(WHOLE);
  await expect.poll(() => zoomOf(page)).toBeGreaterThanOrEqual(READABLE);
}

/** The whole change, as before V109: nothing picked, Focus off, every symbol in view. */
async function expectWhole(page: Page) {
  await expect(panelTitle(page)).toHaveCount(0);
  await expect(focusBox(page)).not.toBeChecked();
  await expect(pending(page)).toHaveCount(0);
  for (const id of [LEGACY, TRIPLE, 'src/math.ts#add', 'src/app.ts#old', 'src/app.ts#total'])
    await expect(node(page, id)).toBeInViewport(WHOLE);
}

test('a change with an error opens Graph on it: focused, readable, its panel open', async ({
  page,
}) => {
  await page.goto(graphPage(callers.url));
  await expectRisk(page);
  // Its finding is the Findings tab's first row, the one shown.
  await expect(page.getByRole('tab', { name: /Findings/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.finding-row').first()).toHaveClass(
    /finding-error.*current|current.*finding-error/,
  );
});

test('F shows the whole change and back; a reload keeps the last choice', async ({ page }) => {
  await page.goto(graphPage(callers.url));
  await expectRisk(page);

  await page.keyboard.press('Shift+F');
  await expectWhole(page);
  await page.reload();
  await expectWhole(page);

  await page.keyboard.press('Shift+F');
  await expectRisk(page);
  await page.reload();
  await expectRisk(page);
});

test('F from any other pick shows the whole change too', async ({ page }) => {
  await page.goto(graphPage(callers.url));
  await expectRisk(page);
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.locator('.list-link', { hasText: /^add$/ }).click();
  await expect(panelTitle(page)).toHaveText('add');
  await page.keyboard.press('Shift+F');
  await expectWhole(page);
});

test('F typed in the search is a letter, not the key', async ({ page }) => {
  await page.goto(graphPage(callers.url));
  await expectRisk(page);
  await page.keyboard.press('/');
  await page.keyboard.type('F');
  await expect(page.locator('#change-search')).toHaveValue('F');
  await expect(panelTitle(page)).toHaveText('legacy');
  await expect(focusBox(page)).toBeChecked();
});

test('Esc then f shows the whole change too, without changing what opens next', async ({
  page,
}) => {
  await page.goto(graphPage(callers.url));
  await expectRisk(page);
  // As a person does, f once the whole change is drawn: pressed while it is laid out, nothing
  // would fit it (Focus off, nothing picked; as on main).
  await page.keyboard.press('Escape');
  await expect(panelTitle(page)).toHaveCount(0);
  await expect(node(page, TRIPLE)).toBeInViewport(WHOLE);
  await page.keyboard.press('f');
  await expectWhole(page);
  await page.reload();
  await expectRisk(page);
});

test('a change with only notes opens whole, as before, and F leaves it so', async ({ page }) => {
  await page.goto(graphPage(notes.url));
  await expect(page.locator('.bar .finding-pill')).toHaveText(['1 note']);
  await expect(node(page, 'src/shapes.ts#volume')).toBeInViewport(WHOLE);
  await expect(panelTitle(page)).toHaveCount(0);
  await expect(focusBox(page)).not.toBeChecked();
  const zoom = await zoomOf(page);

  await page.keyboard.press('Shift+F');
  await page.waitForTimeout(500);
  await expect(panelTitle(page)).toHaveCount(0);
  await expect(focusBox(page)).not.toBeChecked();
  expect(await zoomOf(page)).toBeCloseTo(zoom, 3);
});

test('from Files, g opens Graph on the risk; a line clicked there is picked instead', async ({
  page,
}) => {
  await page.goto(callers.url);
  await expect(page.locator('.file-view')).toBeVisible();
  await page.keyboard.press('g');
  await expectRisk(page);

  // A line of `triple` clicked on Files (V104): g picks it, and the risk is not opened.
  await page.goto(callers.url);
  await expect(page.locator('.file-path')).toHaveText('src/math.ts');
  await page.locator('.file-code [role="row"]').filter({ hasText: 'return add(a, a, a)' }).click();
  await page.keyboard.press('g');
  await expect(panelTitle(page)).toHaveText('triple');
  await expect(focusBox(page)).not.toBeChecked();
  await expect(node(page, TRIPLE)).toBeInViewport();
});
