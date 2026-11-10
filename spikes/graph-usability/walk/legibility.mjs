// Legibility of the Graph page's text, both themes, at zoom 1: each label's size (and with
// Settings' Text size at large), its colour against what is behind it, and the contrast ratio.
// Usage: node legibility.mjs <graph page url>
import { newPage, openBrowser } from './lib.mjs';

const [url] = process.argv.slice(2);
const browser = await openBrowser();
const out = {};
for (const theme of ['dark', 'light']) {
  for (const size of ['default', 'large']) {
    const page = await newPage(browser, theme);
    await page.addInitScript((s) => localStorage.setItem('symbiote.viewer.text-size', s), size);
    await page.goto(url);
    await page.locator('.react-flow__node-symbol').first().waitFor({ timeout: 120_000 });
    await page.waitForTimeout(800);
    out[`${theme}/${size}`] = await page.evaluate(() => {
      const parse = (c) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean);
        return [Number(r), Number(g), Number(b), Number(a)];
      };
      const lum = ([r, g, b]) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const over = (top, under) => {
        const a = top[3];
        return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
      };
      /** The colour behind an element: the first opaque-ish ground up its parents. */
      const ground = (el) => {
        const layers = [];
        for (let e = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c && c[3] > 0) {
            layers.push(c);
            if (c[3] >= 1) break;
          }
        }
        let g = parse(getComputedStyle(document.body).backgroundColor) ?? [0, 0, 0, 1];
        for (const l of layers.reverse()) g = over(l, g);
        return g;
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
      };
      const probe = (label, sel) => {
        const el = document.querySelector(sel);
        if (!el) return [label, null];
        const cs = getComputedStyle(el);
        const fg = parse(cs.color);
        const bg = ground(el);
        return [label, { px: parseFloat(cs.fontSize), weight: cs.fontWeight, contrast: fg && ratio(over(fg, bg), bg) }];
      };
      const strokeProbe = (label, sel) => {
        const el = document.querySelector(sel);
        if (!el) return [label, null];
        const fg = parse(getComputedStyle(el).stroke);
        const bg = ground(document.querySelector('.react-flow__pane') ?? document.body);
        return [label, { width: getComputedStyle(el).strokeWidth, contrast: fg && ratio(over(fg, bg), bg) }];
      };
      return Object.fromEntries([
        probe('body text (sidebar finding)', '.finding-row-message'),
        probe('changed symbol: name', '.symbol:not(.tone-context) .symbol-name'),
        probe('changed symbol: kind', '.symbol:not(.tone-context) .symbol-kind'),
        probe('changed symbol: signature line', '.symbol:not(.tone-context) .symbol-file'),
        probe('unchanged symbol: name', '.symbol.tone-context .symbol-name'),
        probe('unchanged symbol: "unchanged"', '.symbol.tone-context .symbol-unchanged'),
        probe('file box: path', '.react-flow__node-file *'),
        probe('summary: count', '.react-flow__node-summary *'),
        probe('frame: name', '.react-flow__node-project *'),
        probe('finding count on a node', '.symbol-count'),
        probe('legend', '.legend, .canvas-card *'),
        strokeProbe('edge (call)', '.react-flow__edge-path'),
      ]);
    });
    await page.context().close();
  }
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
