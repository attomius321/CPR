import type { Locator } from '@playwright/test';

/**
 * The middle of `text` where xterm.js drew it in a terminal's rows (`.xterm-rows`), in the page:
 * where to hover or click it (V38). xterm.js draws a space as a no-break space.
 */
export async function textAt(rows: Locator, text: string): Promise<{ x: number; y: number }> {
  const at = await rows.evaluate((element, text) => {
    for (const row of Array.from(element.children)) {
      const start = (row.textContent ?? '').replaceAll('\u00a0', ' ').indexOf(text);
      if (start < 0) continue;
      const range = document.createRange();
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let started = false;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent?.length ?? 0;
        if (!started && start < seen + length) {
          range.setStart(node, start - seen);
          started = true;
        }
        if (started && start + text.length <= seen + length) {
          range.setEnd(node, start + text.length - seen);
          break;
        }
        seen += length;
      }
      const box = range.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    return null;
  }, text);
  if (!at) throw new Error(`${text} is not in the terminal`);
  return at;
}
