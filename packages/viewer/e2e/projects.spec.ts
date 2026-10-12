import { expect, test, type Locator, type Page } from '@playwright/test';
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

/** Where it is once the canvas stops moving: a selection pans to it, animated. */
async function settledBox(locator: Locator) {
  let last = await locator.boundingBox();
  for (let i = 0; i < 30; i++) {
    await locator.page().waitForTimeout(100);
    const box = await locator.boundingBox();
    if (box && last && box.x === last.x && box.y === last.y && box.width === last.width) {
      return box;
    }
    last = box;
  }
  throw new Error('the canvas did not settle');
}

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
  const box = await settledBox(frame(page, 'apps/admin'));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 6);
  await expect(page.locator('.panel-title')).toHaveCount(0);
});

test('zoomed out, project names read first, and a click inside a frame zooms into it', async ({
  page,
}) => {
  const zoomOut = page.locator('.react-flow__controls-zoomout');
  for (let i = 0; i < 12 && (await page.locator('.react-flow.map').count()) === 0; i++) {
    await zoomOut.click();
  }
  await expect(page.locator('.react-flow.map')).toBeVisible();

  const name = frame(page, 'libs/ui').locator('.project-name');
  const file = node(page, 'group:file:libs/ui/src/index.ts').locator('.file-name');
  await expect(name).toBeVisible();
  await expect(file).toBeVisible();
  // As drawn on screen: names are scaled, not only sized.
  const height = async (locator: typeof name) => (await locator.boundingBox())?.height ?? 0;
  expect(await height(name)).toBeGreaterThanOrEqual(1.5 * (await height(file)));

  // Every spot of every file box is the file's: frames and their names never take the click.
  const reach = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.react-flow__node-file')].flatMap((box) => {
      const r = box.getBoundingClientRect();
      return [0.1, 0.5, 0.9].map((f) => {
        const hit = document.elementFromPoint(r.left + r.width * f, r.top + r.height * f);
        return `${box.dataset.id} ${hit?.closest('.react-flow__node') === box ? 'file' : (hit?.className ?? 'nothing')}`;
      });
    }),
  );
  expect(reach.filter((spot) => !spot.endsWith(' file'))).toEqual([]);

  // Inside the frame but on no file (its bottom edge): the frame, zoomed into.
  const box = await settledBox(frame(page, 'libs/ui'));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 2);
  await expect(page.locator('.react-flow.map')).toHaveCount(0);
  await expect(node(page, 'libs/ui/src/index.ts#button').locator('.symbol-name')).toBeVisible();
  await test.info().attach('frames', { body: await page.screenshot(), contentType: 'image/png' });
});

const group = (page: Page, name: string) => page.getByRole('region', { name });

test('lists the changes by project, with progress and paths from the project', async ({ page }) => {
  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(page.locator('.list-project-name')).toHaveText([
    '@acme/admin',
    '@acme/legacy',
    '@acme/ui',
  ]);
  const ui = group(page, '@acme/ui');
  await expect(ui.locator('.list-project-progress')).toHaveText('0/1');
  await expect(ui.locator('.list-file-name')).toHaveText('src/index.ts');
  await expect(ui.locator('.list-file-name')).toHaveAttribute('title', 'libs/ui/src/index.ts');
  await ui.getByLabel('Mark button reviewed').check();
  await expect(ui.locator('.list-project-progress')).toHaveText('1/1');

  // A folded project hides its files, and j/k pass it by.
  await group(page, '@acme/admin').locator('.list-project-toggle').click();
  await expect(group(page, '@acme/admin').locator('.list-item')).toHaveCount(0);
  await page.keyboard.press('j');
  await expect(page.locator('.panel-title')).toHaveText('legacy');
  await expect(page.locator('.panel-file')).toHaveText('@acme/legacy › src/index.ts');

  // The search finds project names too.
  await page.getByLabel('Search changes').fill('acme/ui');
  await expect(page.locator('.list-item')).toHaveCount(1);
  await expect(page.locator('.list-project-name')).toHaveText(['@acme/ui']);
});

test('shows one project and what it is linked to, and p walks the projects', async ({ page }) => {
  await page.getByRole('tab', { name: /Changes/ }).click();
  const symbols = page.locator('.react-flow__node-symbol');
  await expect(symbols).toHaveCount(4);

  // The library: its changed button and both apps' calls to it.
  await group(page, '@acme/ui').getByRole('button', { name: 'only' }).click();
  await expect(page.locator('.project-note')).toContainText('Only @acme/ui');
  await expect(page.locator('.list-project-name')).toHaveText(['@acme/ui']);
  await expect(symbols).toHaveCount(3);
  await expect(node(page, 'apps/shop/src/cart.ts#cart')).toBeVisible();

  // p: after the last project, all of them; then the first.
  await page.keyboard.press('p');
  await expect(page.locator('.project-note')).toHaveCount(0);
  await expect(symbols).toHaveCount(4);
  await page.keyboard.press('p');
  await expect(page.locator('.project-note')).toContainText('Only @acme/admin');
  await expect(symbols).toHaveCount(2);

  await page.getByRole('button', { name: 'Show all projects' }).click();
  await expect(page.locator('.list-project')).toHaveCount(3);
  await expect(symbols).toHaveCount(4);
});

test('findings name the project of their symbol', async ({ page }) => {
  await page.getByRole('tab', { name: /Findings/ }).click();
  const project = (rule: string) =>
    page.locator('.finding-row', { hasText: rule }).locator('.finding-row-project');
  await expect(project('exported-api-changed')).toHaveText('@acme/legacy');
  await expect(project('signature-changed')).toHaveText('@acme/ui');
});
