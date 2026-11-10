import { expect, test, type Page } from '@playwright/test';
import { graphPage, serveFixture, type Running } from './symbiote.js';

// V99 (decisions 966–967): a pick lands readable. A finding, a row of the change list, j/k or a
// name in the detail panel whose symbol's name would be drawn under 11 px comes to the reading
// zoom, the person's body size over the graph's 12 px names; a readable pick in view moves nothing
// (886), and one out of view pans at the person's zoom. The first fit is no closer than it.
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

const LEGACY = 'src/math.ts#legacy';
const TRIPLE = 'src/math.ts#triple';

const viewport = (page: Page) => page.locator('.react-flow__viewport');
const symbol = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

/** React Flow's viewport as it is drawn: its translation and its zoom. */
const view = (page: Page) =>
  viewport(page).evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });

/** The view once it rests: two reads 150 ms apart agree (a pick's move takes 300 ms). */
async function rested(page: Page) {
  let last = JSON.stringify(await view(page));
  await expect
    .poll(async () => {
      await page.waitForTimeout(150);
      const now = JSON.stringify(await view(page));
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return view(page);
}

/** How large `id`'s name is drawn on screen, in px: its font size at the canvas's zoom. */
const namePx = (page: Page, id: string) =>
  symbol(page, id)
    .locator('.symbol-name')
    .evaluate((name) => {
      const flow = name.closest('.react-flow__viewport');
      const zoom = flow ? new DOMMatrixReadOnly(getComputedStyle(flow).transform).a : 1;
      return Math.round(Number.parseFloat(getComputedStyle(name).fontSize) * zoom * 100) / 100;
    });

/**
 * Whether `id` is drawn whole inside the canvas (not under the detail panel); React Flow draws no
 * node off screen.
 */
async function inView(page: Page, id: string): Promise<boolean> {
  if ((await symbol(page, id).count()) === 0) return false;
  const box = await symbol(page, id).boundingBox();
  const pane = await page.locator('.react-flow__pane').boundingBox();
  return (
    !!box &&
    !!pane &&
    box.x >= pane.x &&
    box.y >= pane.y &&
    box.x + box.width <= pane.x + pane.width &&
    box.y + box.height <= pane.y + pane.height
  );
}

/**
 * Zooms the canvas to `zoom` with the wheel at `at` (the pane's centre by default): React Flow
 * scales by 2^(−deltaY × 0.002) a wheel event (d3-zoom's, in pixels).
 */
async function zoomTo(page: Page, zoom: number, at?: { x: number; y: number }) {
  const pane = await page.locator('.react-flow__pane').boundingBox();
  if (!pane) throw new Error('no canvas');
  const point = at ?? { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 };
  await page.mouse.move(point.x, point.y);
  for (let step = 0; step < 4; step++) {
    const now = (await rested(page)).zoom;
    if (Math.abs(now - zoom) < 0.002) return;
    await page.mouse.wheel(0, -Math.log2(zoom / now) / 0.002);
  }
  expect((await rested(page)).zoom).toBeCloseTo(zoom, 2);
}

/** Drags the canvas by (`dx`, `dy`) from an empty spot near its top. */
async function drag(page: Page, dx: number, dy: number) {
  const pane = await page.locator('.react-flow__pane').boundingBox();
  if (!pane) throw new Error('no canvas');
  const from = { x: pane.x + pane.width / 2, y: pane.y + 24 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
  await rested(page);
}

/** Drags the canvas so `id` sits at its centre. */
async function centre(page: Page, id: string) {
  const box = await symbol(page, id).boundingBox();
  const pane = await page.locator('.react-flow__pane').boundingBox();
  if (!box || !pane) throw new Error(`${id} not drawn`);
  await drag(
    page,
    pane.x + pane.width / 2 - (box.x + box.width / 2),
    pane.y + pane.height / 2 - (box.y + box.height / 2),
  );
}

/** The Graph page, opened with Text size `size` kept in this browser. */
async function open(page: Page, size?: 'compact' | 'large') {
  if (size) {
    await page.addInitScript(
      (kept) => localStorage.setItem('symbiote.viewer.text-size', kept),
      size,
    );
  }
  await page.goto(graphPage(symbiote.url));
  await expect(symbol(page, LEGACY)).toBeVisible();
  await rested(page);
}

/** Picks the finding on `id` in the Findings tab. */
async function pickFinding(page: Page, id: string) {
  await page.getByRole('tab', { name: /Findings/ }).click();
  const name = id.split('#')[1] ?? id;
  await page.locator('.finding-row', { hasText: name }).first().click();
  await expect(page.locator('.panel-title')).toHaveText(name);
}

test('a small change opens whole, at most at the reading zoom: its names at 15 px, not 12', async ({
  page,
}) => {
  const ids = [LEGACY, TRIPLE, 'src/math.ts#add', 'src/app.ts#total', 'src/app.ts#old'];
  // Where it has room, at the reading zoom (V93 stopped at 1×).
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page);
  expect((await view(page)).zoom).toBeCloseTo(1.25, 3);
  expect(await namePx(page, LEGACY)).toBe(15);
  for (const id of ids) expect(await inView(page, id), id).toBe(true);

  // Where it has not, whole: closer than 1× still.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(symbol(page, LEGACY)).toBeVisible();
  const { zoom } = await rested(page);
  expect(zoom).toBeLessThan(1.25);
  expect(zoom).toBeGreaterThan(1);
  for (const id of ids) expect(await inView(page, id), id).toBe(true);
});

for (const [size, px] of [
  [undefined, 15],
  ['compact', 14],
  ['large', 16],
] as const) {
  test(`zoomed out to 0.6, a finding's symbol lands at ${px} px (${size ?? 'default'} text)`, async ({
    page,
  }) => {
    await open(page, size);
    await zoomTo(page, 0.6);
    // 7.2 px: where V93 left the pick (decision 886), in view or not.
    expect(await namePx(page, LEGACY)).toBe(7.2);

    await pickFinding(page, LEGACY);
    await rested(page);
    expect(await namePx(page, LEGACY)).toBeGreaterThanOrEqual(px);
    expect(await namePx(page, LEGACY)).toBeLessThan(px + 0.01);
    expect(await inView(page, LEGACY)).toBe(true);
  });
}

test('at 1.3 a pick in view moves nothing, and one out of view pans at 1.3', async ({ page }) => {
  await open(page);
  // The detail panel open first: its width is taken from the canvas once.
  await pickFinding(page, LEGACY);
  await centre(page, LEGACY);
  await zoomTo(page, 1.3);
  expect(await inView(page, TRIPLE)).toBe(true);

  const before = await rested(page);
  await pickFinding(page, TRIPLE);
  expect(await rested(page)).toEqual(before);

  // Dragged away: the next pick comes back into view, at the person's zoom.
  const pane = await page.locator('.react-flow__pane').boundingBox();
  await drag(page, 0, (pane?.height ?? 0) - 60);
  expect(await inView(page, LEGACY)).toBe(false);

  await pickFinding(page, LEGACY);
  const after = await rested(page);
  expect(after.zoom).toBeCloseTo(1.3, 3);
  expect(await inView(page, LEGACY)).toBe(true);
});

test('from the map, a pick lands at the reading zoom, not at 1', async ({ page }) => {
  await open(page);
  await zoomTo(page, 0.3);
  await expect(page.locator('.react-flow.map')).toHaveCount(1);

  await pickFinding(page, TRIPLE);
  await expect(page.locator('.react-flow.map')).toHaveCount(0);
  expect((await rested(page)).zoom).toBeCloseTo(1.25, 3);
  expect(await namePx(page, TRIPLE)).toBe(15);
  expect(await inView(page, TRIPLE)).toBe(true);
});

test('a row of the change list zooms once; j then walks at that zoom', async ({ page }) => {
  await open(page);
  await zoomTo(page, 0.6);
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.locator('.list-link', { hasText: 'legacy' }).click();
  await expect(page.locator('.panel-title')).toHaveText('legacy');
  expect((await rested(page)).zoom).toBeCloseTo(1.25, 3);
  expect(await inView(page, LEGACY)).toBe(true);

  // Readable now: each next symbol is only brought into view, at the same zoom.
  for (let step = 0; step < 3; step++) {
    const before = await page.locator('.panel-title').textContent();
    await page.keyboard.press('j');
    await expect(page.locator('.panel-title')).not.toHaveText(before ?? '');
    expect((await rested(page)).zoom).toBeCloseTo(1.25, 3);
  }
});

test('Focus fits the neighbourhood no closer than the reading zoom (1.1 before)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page);
  await pickFinding(page, LEGACY);
  await page.keyboard.press('f');
  await expect(page.getByLabel('Focus', { exact: true })).toBeChecked();
  expect((await rested(page)).zoom).toBeCloseTo(1.25, 3);
  expect(await namePx(page, LEGACY)).toBe(15);
});
