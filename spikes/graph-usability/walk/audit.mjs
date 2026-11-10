// What the Graph page draws at its first fit, for each graph JSON given: the zoom, the map or
// not, the on-screen size of a symbol's name, what is drawn (symbols changed and not, summaries,
// file boxes, frames, edges), names cut, and how many screens it takes to see the whole layout at
// a zoom where a name can be read. Serves packages/viewer/dist with each graph by `?graph=`.
// Usage: node audit.mjs <out.jsonl> <graph.json>… [--shots <dir>] [--light]
import { createReadStream, existsSync, mkdirSync, statSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { newPage, openBrowser, root } from './lib.mjs';
import { readCanvas } from './read-canvas.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { shots: { type: 'string' }, light: { type: 'boolean' } },
});
const [out, ...files] = positionals;
const graphs = files.map((f) => resolve(f));
const dist = join(root, 'packages/viewer/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const g = /^\/graphs\/(\d+)\.json$/.exec(url.pathname);
  const file = g ? graphs[Number(g[1])] : join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await openBrowser();

for (const [i, file] of graphs.entries()) {
  const page = await newPage(browser, values.light ? 'light' : 'dark');
  const t0 = Date.now();
  let row = { graph: basename(file, '.json') };
  try {
    await page.goto(`${base}/index.html?graph=/graphs/${i}.json`);
    await page.waitForSelector('.react-flow__node', { timeout: 120_000 });
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    row.firstPaintMs = Date.now() - t0;
    await page.waitForTimeout(700); // the fit's last frame
    const c = await page.evaluate(readCanvas);
    // Screens to see the whole layout at zoom 1 (READING_ZOOM: names at 13 px).
    const flowW = c.layoutScreen.w / c.zoom, flowH = c.layoutScreen.h / c.zoom;
    c.flow = { w: Math.round(flowW), h: Math.round(flowH) };
    c.screensAtReading = Math.ceil(flowW / c.pane.w) * Math.ceil(flowH / c.pane.h);
    c.nameOnScreenPx = c.nameFontPx && Math.round(c.nameFontPx * c.zoom * 10) / 10;
    row = { ...row, ...c, errors: page.errors };
    if (values.shots) {
      mkdirSync(values.shots, { recursive: true });
      await page.screenshot({ path: join(values.shots, `${row.graph}.png`) });
    }
  } catch (error) {
    row.error = String(error).slice(0, 200);
  }
  appendFileSync(out, JSON.stringify(row) + '\n');
  console.error(row.graph, row.error ?? `zoom ${row.zoom?.toFixed(2)} name ${row.nameOnScreenPx}px drawn ${JSON.stringify(row.drawn)}`);
  await page.context().close();
}
await browser.close();
server.close();
