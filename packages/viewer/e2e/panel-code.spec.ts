import { expect, test, type Page } from '@playwright/test';
import { graphPage, serveFixture, type Running } from './symbiote.js';

// V103: the detail panel shows a symbol's change whole. The panel-code fixture's `summary` lost a
// parameter and gained a 211-character line.
let symbiote: Running;
const errors: string[] = [];

test.beforeAll(async () => {
  symbiote = await serveFixture('panel-code');
});

test.afterAll(() => symbiote.stop());

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => expect(errors).toEqual([]));

async function pick(page: Page, name: string) {
  await page.goto(graphPage(symbiote.url));
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.locator('.list-link', { hasText: new RegExp(`^${name}$`) }).click();
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });
  await expect(panel.locator('.code .row').first()).toBeVisible();
  return panel;
}

for (const size of [
  { width: 2560, height: 1440 },
  { width: 700, height: 900 },
]) {
  test(`wraps a long line inside the panel, under its code, in its colour (${size.width} px)`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const panel = await pick(page, 'summary');
    const long = panel.locator('.row', { hasText: 'counted in all' });
    await expect(long).toHaveClass(/row-add/);

    const seen = await panel.locator('.code').evaluate((code) => {
      const box = code.getBoundingClientRect();
      /** The boxes of an element's text, or of a text node's characters `from` to `to`. */
      const rects = (node: Node, from?: number, to?: number) => {
        const range = document.createRange();
        if (from === undefined) range.selectNodeContents(node);
        else {
          range.setStart(node, from);
          range.setEnd(node, to ?? from + 1);
        }
        return [...range.getClientRects()].filter((r) => r.width > 0);
      };
      /** The boxes of a row's words: its text but the spaces. */
      const words = (row: Element) => {
        const found: DOMRect[] = [];
        const walker = document.createTreeWalker(row.querySelector('.text')!, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode())
          for (const word of (node.textContent ?? '').matchAll(/\S+/g))
            found.push(...rects(node, word.index, word.index + word[0].length));
        return found;
      };
      const rows = [...code.querySelectorAll<HTMLElement>('.row')];
      const row = rows.find((r) => r.textContent?.includes('counted in all'))!;
      const text = row.querySelector<HTMLElement>('.text')!;
      // Lines of the wrapped text: one rect per line box, by its top.
      const lines = new Map<number, DOMRect>();
      for (const r of rects(text)) {
        const top = Math.round(r.top);
        const had = lines.get(top);
        if (!had || r.left < had.left) lines.set(top, r);
      }
      const lefts = [...lines.values()].map((r) => r.left);
      // Where the line's own code starts, after its leading spaces.
      const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
      let first: DOMRect | undefined;
      for (let node = walker.nextNode(); node && !first; node = walker.nextNode()) {
        const at = (node.textContent ?? '').search(/\S/);
        if (at >= 0) first = rects(node, at, at + 1)[0];
      }
      const mark = row.querySelector('.mark')!.getBoundingClientRect();
      return {
        scrolls: code.scrollWidth > code.clientWidth + 1,
        // A space at a wrap hangs past the line's end, unseen (pre-wrap): words are measured.
        outside: rows.filter((r) => words(r).some((rect) => rect.right > box.right + 1)).length,
        lines: lines.size,
        codeStart: first?.left ?? 0,
        markRight: mark.right,
        continuations: lefts.slice(1),
        rowHeight: row.getBoundingClientRect().height,
        gutters: [...row.querySelectorAll('.ln, .mark')].map(
          (e) => e.getBoundingClientRect().height,
        ),
        ground: getComputedStyle(row).backgroundColor,
        // The row's number and its +/−, beside its first line.
        firstTop: Math.min(...lines.keys()),
        numberTops: [...row.querySelectorAll('.ln, .mark')]
          .filter((e) => e.textContent?.trim())
          .map((e) => Math.round(rects(e)[0]?.top ?? -1)),
      };
    });
    expect(seen.scrolls).toBe(false);
    expect(seen.outside).toBe(0);
    expect(seen.lines).toBeGreaterThan(1);
    // Each continuation starts under the line's code: right of the +/− column, at its indent.
    for (const left of seen.continuations) {
      expect(left).toBeGreaterThan(seen.markRight);
      expect(Math.abs(left - seen.codeStart)).toBeLessThanOrEqual(1);
    }
    // The row keeps its colour on every line, its gutter too.
    expect(seen.ground).not.toBe('rgba(0, 0, 0, 0)');
    for (const height of seen.gutters) expect(height).toBeCloseTo(seen.rowHeight, 0);
    expect(seen.numberTops).toHaveLength(2);
    for (const top of seen.numberTops) expect(Math.abs(top - seen.firstTop)).toBeLessThanOrEqual(2);
  });
}

test('a changed signature shows once, the removed parameter struck', async ({ page }) => {
  const panel = await pick(page, 'summary');
  const signature = panel.locator('.sig');
  await expect(signature).toHaveCount(1);
  await expect(signature).toHaveText(
    'summary(rows: Row[], title: string, verbose: boolean): string',
  );
  await expect(signature.locator('del')).toHaveText([', verbose: boolean']);
  await expect(signature.locator('ins')).toHaveCount(0);
  await expect(signature.locator('del')).toHaveCSS('text-decoration-line', 'line-through');
});

test('a long signature folds to the words around its change, and shows whole on a click', async ({
  page,
}) => {
  const panel = await pick(page, 'Page');
  const signature = panel.locator('.sig');
  await expect(signature).toHaveCount(1);
  await expect(signature.locator('ins')).toHaveText([" | { page: 'p20' }"]);
  await expect(signature.locator('.sig-gap')).toHaveCount(2);
  await expect(signature).toContainText("{ page: 'p19' } | { page: 'p20' } | { page: 'p21' }");
  await expect(signature).not.toContainText("'p10'");

  await panel.getByRole('button', { name: 'Show the whole signature' }).click();
  await expect(signature.locator('.sig-gap')).toHaveCount(0);
  await expect(signature).toContainText("'p10'");
  await expect(panel.getByRole('button', { name: 'Show the whole signature' })).toHaveCount(0);
});
