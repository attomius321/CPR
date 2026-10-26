import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Graph, GraphEdge, GraphNode } from '@symbiote/core';
import { graphPage, serveFixture, type Running } from './symbiote.js';

// React Flow checks every edge it is given on every frame of a move (V8c). A generated change
// with more edges than a moving view draws: 21 symbols of `a.ts` call each of 20 in `b.ts`, and
// `first` also calls `c.ts`. On the map each linked file pair is one edge; while the view moves,
// only the selected symbol's edges are drawn. The `callers` fixture is small: nothing changes.
let symbiote: Running;
const errors: string[] = [];

function manyEdges(): Graph {
  const base = JSON.parse(
    readFileSync(
      new URL('../../core/test/__snapshots__/graph-callers.json', import.meta.url),
      'utf8',
    ),
  ) as Graph;
  const node = (id: string): GraphNode => ({
    id,
    kind: 'function',
    name: id.slice(id.indexOf('#') + 1),
    container: null,
    language: 'typescript',
    exported: true,
    status: 'modified',
    previousId: null,
    base: null,
    head: null,
  });
  const callers = ['src/a.ts#first', ...Array.from({ length: 20 }, (_, i) => `src/a.ts#a${i}`)];
  const callees = Array.from({ length: 20 }, (_, i) => `src/b.ts#b${i}`);
  const pairs = [
    ...callers.flatMap((from) => callees.map((to) => [from, to])),
    ['src/a.ts#first', 'src/c.ts#c'],
  ];
  const edges: GraphEdge[] = pairs.map(([from = '', to = ''], i) => ({
    id: `e${i}`,
    from,
    to,
    kind: 'call',
    side: 'both',
    resolution: 'resolved',
    sites: {},
  }));
  return {
    ...base,
    nodes: [...callers, ...callees, 'src/c.ts#c'].map(node),
    edges,
    findings: [],
    warnings: [],
  };
}

test.beforeAll(async () => {
  symbiote = await serveFixture('callers');
});

test.afterAll(() => symbiote.stop());

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => expect(errors).toEqual([]));

async function open(page: Page, graph?: Graph) {
  const url = new URL(graphPage(symbiote.url));
  if (graph) {
    await page.route('**/many-edges.json', (route) => route.fulfill({ json: graph }));
    url.searchParams.set('graph', './many-edges.json');
  }
  await page.goto(url.toString());
  await expect(page.locator('.react-flow__node-symbol').first()).toBeAttached();
}

/** Holds the mouse down on the canvas after moving it a little: the view moves until released. */
async function holdDrag(page: Page) {
  const pane = await page.locator('.react-flow__pane').boundingBox();
  if (!pane) throw new Error('no canvas');
  await page.mouse.move(pane.x + 30, pane.y + 30);
  await page.mouse.down();
  await page.mouse.move(pane.x + 90, pane.y + 60, { steps: 6 });
}

const edges = (page: Page, selector = '') => page.locator(`.react-flow__edge${selector}`);

test('on the map, one edge per linked file pair stands for their symbols’ edges', async ({
  page,
}) => {
  await open(page, manyEdges());
  const zoom = async (button: 'in' | 'out', map: boolean) => {
    for (let i = 0; i < 12; i++) {
      if ((await page.locator('.react-flow.map').count()) === (map ? 1 : 0)) return;
      await page.locator(`.react-flow__controls-zoom${button}`).click();
    }
  };
  await zoom('out', true);
  await expect(page.locator('.react-flow.map')).toBeVisible();
  const files = (from: string, to: string) =>
    page.locator(`.react-flow__edge[data-id="files:group:file:${from} → group:file:${to}"]`);
  await expect(edges(page, '.edge-files')).toHaveCount(2);
  await expect(edges(page, ':not(.edge-files)')).toHaveCount(0);
  // 420 calls weigh more than one.
  await expect(files('src/a.ts', 'src/b.ts')).toHaveClass(/edge-files-4/);
  await expect(files('src/a.ts', 'src/c.ts')).toHaveClass(/edge-files-1/);
  await test.info().attach('map', { body: await page.screenshot(), contentType: 'image/png' });

  // Out of the map, the symbols' edges are back.
  await zoom('in', false);
  await expect(page.locator('.react-flow.map')).toHaveCount(0);
  await expect(edges(page, '.edge-files')).toHaveCount(0);
  await expect.poll(() => edges(page).count()).toBeGreaterThan(2);
});

test('while the view moves, only the selected symbol’s edges are drawn', async ({ page }) => {
  await open(page, manyEdges());
  // A press that does not move the view (a click) leaves every edge drawn.
  await expect.poll(() => edges(page).count()).toBeGreaterThan(0);
  const all = await edges(page).count();
  const pane = await page.locator('.react-flow__pane').boundingBox();
  await page.mouse.move((pane?.x ?? 0) + 30, (pane?.y ?? 0) + 30);
  await page.mouse.down();
  await page.waitForTimeout(300);
  expect(await edges(page).count()).toBe(all);
  await page.mouse.up();

  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.locator('.list-link', { hasText: 'first' }).click();
  await expect(page.locator('.panel-title')).toHaveText('first');
  const others = edges(page, ':not(.edge-active)');
  await expect.poll(() => others.count()).toBeGreaterThan(0);

  await holdDrag(page);
  await expect(others).toHaveCount(0);
  await expect(edges(page, '.edge-active').first()).toBeAttached();
  await page.mouse.up();
  await expect.poll(() => others.count()).toBeGreaterThan(0);
});

test('a small graph keeps its edges while the view moves', async ({ page }) => {
  await open(page);
  await expect(edges(page)).toHaveCount(4);
  await holdDrag(page);
  await page.waitForTimeout(300);
  await expect(edges(page)).toHaveCount(4);
  await page.mouse.up();
});
