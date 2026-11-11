import { expect, test, type Page } from '@playwright/test';
import { graphPage, serveFixture, wholeFirst, type Running } from './symbiote.js';

// V100 (decisions 968–970): findings where the reviewer looks. The head counts what the Findings
// tab lists, one pill per severity, and a pill opens the tab at its severity. Signature changes
// with nothing left to update fold into one row. On the map, a symbol keeps its findings count,
// scaled like the file names, and its file's name takes the worst severity's colour.
//
// `callers`: `legacy` removed and still used (error), `triple` added and unused (warning), `add`
// changed compatibly (info, settled), all in src/math.ts. `detectors`: an error, two warnings, an
// info that is not a signature change (`volume`) and a compatible one (`Shape`, settled).
let callers: Running;
let detectors: Running;
const errors: string[] = [];

test.beforeAll(async () => {
  [callers, detectors] = await Promise.all([serveFixture('callers'), serveFixture('detectors')]);
});

test.afterAll(() => {
  callers.stop();
  detectors.stop();
});

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => expect(errors).toEqual([]));

const pills = (page: Page) => page.locator('.bar .finding-pill');
const findingsTab = (page: Page) => page.getByRole('tab', { name: /Findings/ });
const rows = (page: Page, severity: string) => page.locator(`.finding-row.finding-${severity}`);

test('on callers, the head and the Findings tab give the same numbers, by severity', async ({
  page,
}) => {
  await page.goto(graphPage(callers.url));
  await expect(pills(page)).toHaveText(['1 error', '1 warning']);
  await expect(findingsTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(findingsTab(page).locator('.count')).toHaveText('2');
  await expect(rows(page, 'error')).toHaveCount(1);
  await expect(rows(page, 'warning')).toHaveCount(1);
  await expect(rows(page, 'info')).toHaveCount(0);

  // `add`, changed compatibly, is in a fold below the rest; a click opens it.
  const fold = page.locator('.finding-fold');
  await expect(fold).toHaveCount(1);
  await expect(fold).toContainText('1 signature change, nothing left to update');
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(rows(page, 'info')).toHaveText([/add changed its signature compatibly/]);
  await rows(page, 'info').click();
  await expect(page.locator('.panel-title')).toHaveText('add');
  // Opened, its findings still count in the fold, not in the head or the tab.
  await expect(pills(page)).toHaveText(['1 error', '1 warning']);
  await expect(findingsTab(page).locator('.count')).toHaveText('2');
});

test('a pill opens the Findings tab at its severity, from the Files page too', async ({ page }) => {
  await page.goto(detectors.url);
  await expect(page.locator('.file-view')).toBeVisible();
  await expect(pills(page)).toHaveText(['1 error', '2 warnings', '1 note']);

  await page.getByRole('button', { name: '1 note' }).click();
  await expect(page).toHaveURL(/[?&]view=graph/);
  await expect(findingsTab(page)).toHaveAttribute('aria-selected', 'true');
  const note = rows(page, 'info').first();
  await expect(note).toContainText('volume');
  await expect(note).toBeFocused();
  await expect(note).toBeInViewport();

  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.getByRole('button', { name: '2 warnings' }).click();
  await expect(findingsTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page, 'warning').first()).toBeFocused();
  // The settled one is folded, not counted in the tab.
  await expect(findingsTab(page).locator('.count')).toHaveText('4');
  await expect(page.locator('.finding-fold')).toContainText('1 signature change');
});

/** React Flow's zoom as drawn. */
const zoomOf = (page: Page) =>
  page
    .locator('.react-flow__viewport')
    .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);

/** Zooms with the wheel at the canvas's centre until the zoom is `zoom` (as pick.spec.ts). */
async function zoomTo(page: Page, zoom: number) {
  const pane = await page.locator('.react-flow__pane').boundingBox();
  if (!pane) throw new Error('no canvas');
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  for (let step = 0; step < 6; step++) {
    await page.waitForTimeout(350);
    const now = await zoomOf(page);
    if (Math.abs(now - zoom) < 0.002) return;
    await page.mouse.wheel(0, -Math.log2(zoom / now) / 0.002);
  }
  await page.waitForTimeout(350);
  expect(await zoomOf(page)).toBeCloseTo(zoom, 2);
}

/** The colour a token draws text in, as the page computes it. */
const tokenColour = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);

for (const theme of ['dark', 'light'] as const) {
  test(`the map keeps a finding's count, at a name's size, and colours its file (${theme})`, async ({
    page,
  }) => {
    // The whole change first (V109): this spec starts from it, not from the riskiest finding.
    await wholeFirst(page);
    await page.addInitScript((kept) => localStorage.setItem('symbiote.viewer.theme', kept), theme);
    await page.goto(graphPage(callers.url));
    const legacy = page.locator('.react-flow__node[data-id="src/math.ts#legacy"]');
    await expect(legacy).toBeVisible();
    await zoomTo(page, 0.2);
    await expect(page.locator('.react-flow.map')).toBeVisible();

    // The count is drawn at its card's 16 px on screen, whatever the zoom (decision 37: by
    // transform, not a font size), centred on the card's top-right corner, by its file's box:
    // above the box's name, which the box draws above the cards.
    const count = page.locator('.map-count[data-symbol="src/math.ts#legacy"]');
    await expect(count).toBeVisible();
    await expect(count).toHaveText('1');
    await expect(count).toHaveClass(/count-error/);
    const box = await count.boundingBox();
    const card = await legacy.boundingBox();
    expect(box?.height).toBeCloseTo(16, 0);
    expect(box?.width).toBeGreaterThanOrEqual(15.5);
    expect((box?.x ?? 0) + (box?.width ?? 0) / 2).toBeCloseTo(
      (card?.x ?? 0) + (card?.width ?? 0),
      0,
    );
    expect((box?.y ?? 0) + (box?.height ?? 0) / 2).toBeCloseTo(card?.y ?? 0, 0);
    // `add`'s settled change keeps its count on its card only; the cards' own are hidden here.
    await expect(page.locator('.map-count')).toHaveCount(2);
    await expect(page.locator('.map-count[data-symbol="src/math.ts#add"]')).toHaveCount(0);
    await expect(legacy.locator('.symbol-count')).toBeHidden();

    // math.ts holds the error: its name in the error's colour; app.ts, context, muted as before.
    const name = (file: string) =>
      page.locator('.react-flow__node-file', {
        has: page.locator('.file-name', { hasText: new RegExp(`^${file}$`) }),
      });
    await expect(name('math.ts').locator('.file-name')).toHaveCSS(
      'color',
      await tokenColour(page, '--error'),
    );
    await expect(name('app.ts').locator('.file-name')).toHaveCSS(
      'color',
      await tokenColour(page, '--muted'),
    );
  });
}
