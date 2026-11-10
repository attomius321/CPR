// A first look at a change, for exploring: opens a branch review (as a workspace's Review does)
// or a pair diff, waits for the graph, and screenshots Files and Graph in both themes into
// shots/look-<name>-*. Usage: node look.mjs <port> <name> (--branch <b> | --path <url path>)
import { parseArgs } from 'node:util';
import { newPage, openBrowser, shotBoth } from './lib.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { branch: { type: 'string' }, path: { type: 'string' } },
});
const [port, name] = positionals;
const origin = `http://127.0.0.1:${port}`;
const browser = await openBrowser();
const page = await newPage(browser, 'dark');
await page.goto(`${origin}/git`);
let path = values.path;
if (values.branch) {
  path = await page.evaluate(async (ref) => {
    const r = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify({ ref }),
    });
    return (await r.json()).url;
  }, values.branch);
}
const t0 = performance.now();
await page.goto(`${origin}${path}`);
await page.locator('.files-main').waitFor({ timeout: 300_000 });
const filesAt = performance.now() - t0;
// The graph is ready when the Files page's head shows the findings pills or the Graph tab is on.
await page.waitForFunction(() => !document.querySelector('.analysis-state'), null, {
  timeout: 600_000,
});
const readyAt = performance.now() - t0;
console.log(JSON.stringify({ path, filesMs: Math.round(filesAt), graphReadyMs: Math.round(readyAt) }));
await page.waitForTimeout(800);
await shotBoth(page, `look-${name}-files`);
await page.keyboard.press('g');
await page.locator('.react-flow__node').first().waitFor();
await page.waitForTimeout(1500);
await shotBoth(page, `look-${name}-graph`);
console.log(JSON.stringify({ url: page.url(), errors: page.errors }));
await browser.close();
