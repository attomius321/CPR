import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Graph, GraphEdge, GraphNode } from '@cpr/core';
import { serveFixture, type Running } from './cpr.js';

// A large change, generated: a changed `hub` used by 40 symbols in 12 files, and 30 changed
// symbols in files of their own. It opens as a map; the hub's users are one summary node.
let cpr: Running;
const errors: string[] = [];

const HUB = 'src/hub.ts#hub';

function largeGraph(): Graph {
  const base = JSON.parse(
    readFileSync(
      new URL('../../core/test/__snapshots__/graph-callers.json', import.meta.url),
      'utf8',
    ),
  ) as Graph;
  const node = (id: string, changed: boolean): GraphNode => ({
    id,
    kind: 'function',
    name: id.slice(id.indexOf('#') + 1),
    container: null,
    language: 'typescript',
    exported: true,
    status: changed ? 'modified' : 'unchanged',
    previousId: null,
    base: null,
    head: null,
  });
  const users = Array.from({ length: 40 }, (_, i) => `src/users${i % 12}.ts#caller${i}`);
  // `piece1x` is not part of `piece11x`, so names find exactly one item.
  const others = Array.from({ length: 30 }, (_, i) => `src/piece${i}x.ts#piece${i}x`);
  const edges: GraphEdge[] = users.map((from, i) => ({
    id: `e${i}`,
    from,
    to: HUB,
    kind: 'call',
    side: 'both',
    resolution: 'resolved',
    sites: {},
  }));
  return {
    ...base,
    nodes: [
      node(HUB, true),
      ...others.map((id) => node(id, true)),
      ...users.map((id) => node(id, false)),
    ],
    edges,
    findings: [],
    warnings: [],
  };
}

test.beforeAll(async () => {
  cpr = await serveFixture('callers');
});

test.afterAll(() => cpr.stop());

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  const graph = largeGraph();
  await page.route('**/large-graph.json', (route) => route.fulfill({ json: graph }));
  const url = new URL(cpr.url);
  url.searchParams.set('graph', './large-graph.json');
  await page.goto(url.toString());
  await expect(page.locator('.react-flow__node-symbol').first()).toBeAttached();
});

test.afterEach(() => expect(errors).toEqual([]));

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const summary = (page: Page) => page.locator('.react-flow__node-summary');
/** Only nodes on screen are in the page; the minimap draws them all. */
const drawn = (page: Page) => page.locator('.react-flow__minimap-node').count();

/** Every node's place on the canvas (its transform), by id. */
const positions = (page: Page) =>
  page.evaluate((): Record<string, string> =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(
        (n): [string, string] => [n.dataset.id ?? '', n.style.transform],
      ),
    ),
  );

test('shows many users as one node that shows and hides them', async ({ page }) => {
  await expect(summary(page)).toHaveCount(1);
  await expect(summary(page)).toContainText('40 users');
  await expect(summary(page)).toContainText('in 12 files');
  const collapsed = await drawn(page);

  // Open the hub's users: 40 symbols in 12 more boxes, and the canvas fits them.
  await summary(page).click();
  await expect(summary(page)).toContainText('hide');
  await expect.poll(() => drawn(page)).toBe(collapsed + 40 + 12);
  // Fitting them zooms out to the map, where a click picks a file: zoom into the hub's first.
  await expect(page.locator('.react-flow.map')).toBeVisible();
  await node(page, 'group:file:src/hub.ts').click({ position: { x: 2, y: 2 } });
  await expect(page.locator('.react-flow.map')).toHaveCount(0);
  await summary(page).click();
  await expect(summary(page)).toContainText('show');
  await expect.poll(() => drawn(page)).toBe(collapsed);
});

test('zoomed out, the canvas is a map of files, and a click zooms into one', async ({ page }) => {
  const zoomOut = page.locator('.react-flow__controls-zoomout');
  for (let i = 0; i < 12 && (await page.locator('.react-flow.map').count()) === 0; i++) {
    await zoomOut.click();
  }
  await expect(page.locator('.react-flow.map')).toBeVisible();
  // File names, not symbols, are what is readable there.
  await expect(node(page, 'group:file:src/hub.ts').locator('.file-name')).toBeVisible();
  await expect(node(page, 'group:file:src/hub.ts').locator('.file-name')).toHaveText('hub.ts');
  await expect(node(page, HUB).locator('.symbol-name')).toBeHidden();

  await node(page, 'group:file:src/hub.ts').click({ position: { x: 2, y: 2 } });
  await expect(page.locator('.react-flow.map')).toHaveCount(0);
  await expect(node(page, HUB).locator('.symbol-name')).toBeVisible();
});

test('walking and marking never move a node, and the selection stays in view', async ({ page }) => {
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.locator('.list-link', { hasText: 'piece1x' }).click();
  await expect(page.locator('.panel-title')).toHaveText('piece1x');
  const before = await positions(page);

  await page.keyboard.press('r');
  await page.keyboard.press('j');
  await expect(page.locator('.panel-title')).not.toHaveText('piece1x');
  await page.keyboard.press('r');
  // Only nodes on screen are drawn: compare those drawn both times.
  const after = await positions(page);
  const both = Object.keys(before).filter((id) => id in after);
  expect(both.length).toBeGreaterThan(5);
  for (const id of both) expect(after[id], id).toBe(before[id]);

  // The selected symbol is fully inside the canvas, not under the detail panel.
  const selected = page.locator('.react-flow__node.selected');
  await expect(selected).toHaveCount(1);
  await page.waitForTimeout(400); // the pan to the selection is animated
  const box = await selected.boundingBox();
  const panel = await page.locator('.panel').boundingBox();
  expect(box && panel && box.x + box.width <= panel.x).toBe(true);
});

test('a user picked in the detail panel is shown even when grouped', async ({ page }) => {
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.locator('.list-link', { hasText: 'hub' }).click();
  const collapsed = await drawn(page);
  await page.locator('.panel .link', { hasText: 'caller7' }).click();
  await expect(page.locator('.panel-title')).toHaveText('caller7');
  // Its group opens, and the canvas comes to it.
  await expect(node(page, 'src/users7.ts#caller7')).toBeVisible();
  expect(await drawn(page)).toBe(collapsed + 40 + 12);
});

test('the search narrows the change list, and j/k walk what it leaves', async ({ page }) => {
  const items = page.locator('.list-item');
  await expect(page.getByRole('tab', { name: /Changes/ })).toHaveAttribute('aria-selected', 'true');
  await expect(items).toHaveCount(31);

  // `/` puts the cursor in the search; typing doesn't walk the list.
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search changes')).toBeFocused();
  await page.keyboard.type('PIECE1');
  await expect(items).toHaveCount(11); // piece1x and piece10x…piece19x
  await expect(page.locator('.search .count')).toHaveText('11/31');
  await expect(page.locator('.panel-title')).toHaveCount(0);

  // Enter opens the first match; j walks on among the matches only, wrapping around.
  const names = await page.locator('.list-link').allTextContents();
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel-title')).toHaveText(names[0] ?? '');
  for (const name of [...names.slice(1), names[0]]) {
    await page.keyboard.press('j');
    await expect(page.locator('.panel-title')).toHaveText(name ?? '');
  }

  // A file path finds its symbols too, and words narrow further.
  await page.getByLabel('Search changes').fill('hub.ts hub');
  await expect(items).toHaveCount(1);
  await page.getByLabel('Search changes').fill('nothing here');
  await expect(items).toHaveCount(0);
  await expect(page.locator('.list')).toContainText('No changed file or symbol matches');

  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(items).toHaveCount(31);
});
