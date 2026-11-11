import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Graph, GraphEdge, GraphNode } from '@symbiote/core';
import { serveFixture, type Running } from './symbiote.js';

// The change louder than its context (V106, decision 981): a changed `hub` used by 12 unchanged
// symbols (one summary card), a changed `leaf` used by two unchanged ones and using a package's
// export (cards of their own). Text is drawn in the change's cards first: no text of the context
// is larger or bolder than a changed symbol's name.
let symbiote: Running;
const errors: string[] = [];

function contextGraph(): Graph {
  const base = JSON.parse(
    readFileSync(
      new URL('../../core/test/__snapshots__/graph-callers.json', import.meta.url),
      'utf8',
    ),
  ) as Graph;
  const node = (id: string, changed: boolean, kind: GraphNode['kind'] = 'function'): GraphNode => ({
    id,
    kind,
    name: id.slice(id.indexOf('#') + 1),
    container: null,
    language: 'typescript',
    exported: true,
    status: changed ? 'modified' : 'unchanged',
    previousId: null,
    base: null,
    head: null,
  });
  const call = (from: string, to: string): GraphEdge => ({
    id: `${from}->${to}`,
    from,
    to,
    kind: 'call',
    side: 'both',
    resolution: 'resolved',
    sites: {},
  });
  const users = Array.from({ length: 12 }, (_, i) => `src/users${i % 4}.ts#caller${i}`);
  const near = ['src/near.ts#nearOne', 'src/near.ts#nearTwo'];
  const outside = 'node#"node:fs".readFileSync';
  return {
    ...base,
    nodes: [
      node('src/hub.ts#hub', true),
      node('src/leaf.ts#leaf', true),
      ...users.map((id) => node(id, false)),
      ...near.map((id) => node(id, false)),
      { ...node(outside, false, 'external'), name: '"node:fs".readFileSync', exported: false },
    ],
    edges: [
      ...users.map((from) => call(from, 'src/hub.ts#hub')),
      ...near.map((from) => call(from, 'src/leaf.ts#leaf')),
      call('src/leaf.ts#leaf', outside),
    ],
    findings: [],
    warnings: [],
  };
}

test.beforeAll(async () => {
  symbiote = await serveFixture('callers');
});

test.afterAll(() => symbiote.stop());

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  const graph = contextGraph();
  await page.route('**/context-graph.json', (route) => route.fulfill({ json: graph }));
  const url = new URL(symbiote.url);
  url.searchParams.set('graph', './context-graph.json');
  await page.goto(url.toString());
  await expect(page.locator('.react-flow__node-summary')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
});

test.afterEach(() => expect(errors).toEqual([]));

interface Drawn {
  where: 'change' | 'context';
  part: string;
  text: string;
  size: number;
  weight: number;
  color: string;
}

/**
 * Every text drawn in a node's card, with its computed size, weight and colour: a changed
 * symbol's card is the change; a summary, an unchanged symbol, a package's export or a dynamic
 * call the context. All of them share the canvas's zoom, so what holds here holds at any zoom
 * where text is drawn.
 */
const drawn = (page: Page) =>
  page.evaluate((): Drawn[] => {
    const context =
      '.summary-node, .symbol.tone-context, .symbol.tone-external, .symbol.tone-unknown';
    const out: Drawn[] = [];
    for (const card of document.querySelectorAll('.summary-node, .symbol')) {
      const where = card.matches(context) ? 'context' : 'change';
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const element = text.parentElement;
        if (!element || !text.textContent?.trim()) continue;
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        out.push({
          where,
          part: element.className,
          text: text.textContent.trim(),
          size: Number.parseFloat(style.fontSize),
          weight: Number(style.fontWeight),
          color: style.color,
        });
      }
    }
    return out;
  });

test('no text of the context is larger or bolder than a changed symbol’s name, in both themes', async ({
  page,
}) => {
  // Text is drawn: the canvas is not a map.
  await expect(page.locator('.react-flow.map')).toHaveCount(0);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    const texts = await drawn(page);
    const names = texts.filter((t) => t.where === 'change' && t.part === 'symbol-name');
    const context = texts.filter((t) => t.where === 'context');
    expect(names.map((n) => n.text).sort()).toEqual(['hub', 'leaf']);
    // The summary, two unchanged users and the package's export are all drawn.
    expect(context.map((t) => t.text)).toEqual(
      expect.arrayContaining(['12 users', 'nearOne', 'nearTwo', '"node:fs".readFileSync']),
    );
    const nameSize = Math.min(...names.map((n) => n.size));
    const nameWeight = Math.min(...names.map((n) => n.weight));
    const louder = context.filter((t) => t.size > nameSize || t.weight > nameWeight);
    expect(louder, `context louder than a ${nameSize} px, ${nameWeight} name`).toEqual([]);

    // A summary's count is drawn as an unchanged symbol's name; its "show" keeps the text's ink.
    const count = context.find((t) => t.part === 'summary-count');
    const unchangedName = context.find((t) => t.text === 'nearOne');
    expect(count && { size: count.size, weight: count.weight, color: count.color }).toEqual(
      unchangedName && {
        size: unchangedName.size,
        weight: unchangedName.weight,
        color: unchangedName.color,
      },
    );
    expect(context.find((t) => t.part === 'summary-action')?.color).toBe(names[0]?.color);
  }
});
