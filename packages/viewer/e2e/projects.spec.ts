import { expect, test, type Page } from '@playwright/test';
import { serveFixture, type Running } from './cpr.js';

// `cpr view` on a monorepo (npm workspaces): two apps call a shared library, and a library is
// removed. Each project is a frame; on the map their names read first.
let cpr: Running;
const errors: string[] = [];

test.beforeAll(async () => {
  cpr = await serveFixture('projects');
});

test.afterAll(() => cpr.stop());

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(cpr.url);
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const frame = (page: Page, folder: string) => node(page, `project:${folder}`);

test('draws each project as a frame around its files', async ({ page }) => {
  const names = await page.locator('.react-flow__node-project .project-name').allInnerTexts();
  expect(names.sort()).toEqual(['@acme/admin', '@acme/legacy', '@acme/shop', '@acme/ui']);
  await expect(frame(page, 'apps/admin')).toContainText('apps/admin');
  await expect(frame(page, 'apps/admin')).toContainText('1 changed');
  // The shop only holds a user of the changed button: a lighter frame.
  await expect(frame(page, 'apps/shop').locator('.project-frame')).toHaveClass(/context/);
  await expect(frame(page, 'apps/shop')).toContainText('context only');

  // Inside its frame a file's path starts at the project's folder; the full path is its title.
  const label = node(page, 'group:file:apps/admin/src/page.ts').locator('.file-label');
  await expect(label).toHaveText('src/page.ts');
  await expect(label).toHaveAttribute('title', 'apps/admin/src/page.ts');

  // Both apps' calls to the library cross a boundary, and the legend says what that looks like.
  await expect(page.locator('.react-flow__edge.edge-cross')).toHaveCount(2);
  await expect(page.locator('.legend')).toContainText('edge between projects');
  await expect(page.locator('.legend')).toContainText('project (app or library)');
});

test('a click inside a frame is a click on the canvas', async ({ page }) => {
  await node(page, 'apps/admin/src/page.ts#page').click();
  await expect(page.locator('.panel-title')).toHaveText('page');

  // Below the file box, inside the frame: nothing there but the canvas, which closes the panel.
  const box = await frame(page, 'apps/admin').boundingBox();
  if (!box) throw new Error('frame not drawn');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 6);
  await expect(page.locator('.panel-title')).toHaveCount(0);
});

test('zoomed out, project names read first, and a click on one zooms into it', async ({ page }) => {
  const zoomOut = page.locator('.react-flow__controls-zoomout');
  for (let i = 0; i < 12 && (await page.locator('.react-flow.map').count()) === 0; i++) {
    await zoomOut.click();
  }
  await expect(page.locator('.react-flow.map')).toBeVisible();

  const name = frame(page, 'libs/ui').locator('.project-name');
  const file = node(page, 'group:file:libs/ui/src/index.ts').locator('.file-name');
  await expect(name).toBeVisible();
  await expect(file).toBeVisible();
  const size = (locator: typeof name) =>
    locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await size(name)).toBeGreaterThanOrEqual(1.5 * (await size(file)));

  await name.click();
  await expect(page.locator('.react-flow.map')).toHaveCount(0);
  await expect(node(page, 'libs/ui/src/index.ts#button').locator('.symbol-name')).toBeVisible();
  await test.info().attach('frames', { body: await page.screenshot(), contentType: 'image/png' });
});
