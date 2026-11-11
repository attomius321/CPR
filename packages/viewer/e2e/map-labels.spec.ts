import { expect, test, type Page } from '@playwright/test';
import { graphPage, serveFixture, type Running } from './symbiote.js';

// V96 (decisions 938–939): on the map, a project's name never covers a file's name. The name sits
// on its frame's top edge, half outside, inside its frame's width; a file name it still covers is
// drawn faint once the zoom rests, its box keeping the click; a finding's count stays above it.
//
// `projects`: a monorepo of four projects (two apps, two libraries), each a frame with a file in
// its first row; `legacy`'s warning is counted on the map.
let symbiote: Running;
const errors: string[] = [];

test.beforeAll(async () => {
  symbiote = await serveFixture('projects');
});

test.afterAll(() => symbiote.stop());

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(graphPage(symbiote.url));
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

/** React Flow's zoom as drawn. */
const zoomOf = (page: Page) =>
  page
    .locator('.react-flow__viewport')
    .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);

/** Zooms with the wheel at the canvas's centre until the zoom is `zoom` (as findings.spec.ts). */
async function zoomTo(page: Page, zoom: number) {
  const pane = await page.locator('.react-flow__pane').boundingBox();
  if (!pane) throw new Error('no canvas');
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  for (let step = 0; step < 6; step++) {
    await page.waitForTimeout(350);
    const now = await zoomOf(page);
    if (Math.abs(now - zoom) < 0.002) break;
    await page.mouse.wheel(0, -Math.log2(zoom / now) / 0.002);
  }
  // At rest: the cut and the dimming follow the zoom 120 ms after it stops (CUT_REST_MS).
  await page.waitForTimeout(350);
  expect(await zoomOf(page)).toBeCloseTo(zoom, 2);
}

/** Every project name's and file name's box on screen, and what each name covers. */
const labels = (page: Page) =>
  page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const meets = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const opacity = (el: Element) => Number(getComputedStyle(el).opacity);
    const names = [...document.querySelectorAll('.react-flow.map .project-name')];
    const files = [...document.querySelectorAll('.react-flow.map .file-name')];
    const under = (file: Element) =>
      names.filter((name) => meets(box(name), box(file))).map((name) => name.textContent);
    // Which is drawn on top where a count meets a name: hit-tested with every element taking
    // the pointer (frames and counts take none on the map).
    const style = document.createElement('style');
    style.textContent = '* { pointer-events: auto !important; }';
    document.head.append(style);
    const countsUnder = [...document.querySelectorAll<HTMLElement>('.react-flow.map .map-count')]
      .filter((count) => {
        const c = box(count);
        const name = names.find((n) => meets(box(n), c));
        if (!name) return false;
        const top = document
          .elementsFromPoint(c.left + c.width / 2, c.top + c.height / 2)
          .find((el) => el === count || name.contains(el));
        return top !== count;
      })
      .map((count) => count.dataset.symbol);
    style.remove();
    return {
      names: names.length,
      counts: document.querySelectorAll('.react-flow.map .map-count').length,
      // File names drawn whole under a project's name: none may be.
      covered: files
        .filter((file) => opacity(file) >= 0.9 && under(file).length > 0)
        .map((file) => `${file.textContent} under ${under(file).join(', ')}`),
      dimmed: files.filter((file) => opacity(file) < 0.9).map((file) => file.textContent),
      // Faint only where a name is over it, or within the model's 2 px of it.
      dimmedFar: files
        .filter((file) => {
          if (opacity(file) >= 0.9) return false;
          const f = box(file);
          const near = new DOMRect(f.x - 3, f.y - 3, f.width + 6, f.height + 6);
          return !names.some((name) => meets(box(name), near));
        })
        .map((file) => file.textContent),
      outside: names
        .filter((name) => {
          const frame = box(name.closest('.project-frame') as Element);
          const r = box(name);
          return r.left < frame.left - 1 || r.right > frame.right + 1;
        })
        .map((name) => name.textContent),
      countsUnder,
    };
  });

for (const zoom of [0.3, 0.12]) {
  test(`at ${zoom}, no project name covers a file name drawn whole, or a count`, async ({
    page,
  }) => {
    await zoomTo(page, zoom);
    await expect(page.locator('.react-flow.map')).toBeVisible();
    const seen = await labels(page);
    expect(seen.names).toBe(4);
    expect(seen.covered).toEqual([]);
    expect(seen.outside).toEqual([]);
    // The legacy library's warning: counted on the map, above its frame's name.
    expect(seen.counts).toBe(1);
    expect(seen.countsUnder).toEqual([]);
    // The rule bites: first rows' files are under their frames' names at both zooms.
    expect(seen.dimmed.length).toBeGreaterThan(0);
    // The model errs to dim, not to miss, by 2 px at most.
    expect(seen.dimmedFar).toEqual([]);
    await test.info().attach(`map at ${zoom}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test("a faint file name's box keeps its click: a click zooms into the file", async ({ page }) => {
  await zoomTo(page, 0.2);
  // The dimmed names, as the page draws them.
  const dimmed = await page.evaluate(() =>
    [...document.querySelectorAll('.react-flow.map .file-name')]
      .filter((name) => Number(getComputedStyle(name).opacity) < 0.9)
      .map((name) => {
        const r = name.getBoundingClientRect();
        const node = name.closest<HTMLElement>('.react-flow__node');
        return { id: node?.dataset.id ?? '', x: r.left + 4, y: r.top + r.height / 2 };
      }),
  );
  expect(dimmed.length).toBeGreaterThan(0);
  // Under the name drawn over it, the point is the file box's: frames take no pointer on the map.
  const [target] = dimmed;
  if (!target) throw new Error('nothing dimmed');
  const hit = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>('.react-flow__node')?.dataset.id,
    target,
  );
  expect(hit).toBe(target.id);
  await page.mouse.click(target.x, target.y);
  // The click zooms into the file, off the map.
  await expect(page.locator('.react-flow.map')).toHaveCount(0);
});
