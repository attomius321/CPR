// Opens graph JSON files in the built viewer (Chromium) and measures what a reviewer feels:
// first paint, selecting a symbol from the change list, marking it reviewed, panning.
// Usage: node scripts/viewer/measure.mjs <graph.json>… [--shot <dir>] [--width 1440 --height 900]
// Build first (pnpm build). Prints one JSON line per graph; --shot saves <dir>/<graph>.png.
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'packages/viewer/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('build the viewer first: pnpm build');

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    shot: { type: 'string' },
    width: { type: 'string', default: '1440' },
    height: { type: 'string', default: '900' },
  },
});
if (positionals.length === 0) throw new Error('usage: measure.mjs <graph.json>… [--shot <dir>]');
const graphs = positionals.map((path) => resolve(path));

// The viewer's files, and each graph at /graphs/<n>.json.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const graph = /^\/graphs\/(\d+)\.json$/.exec(url.pathname);
  const file = graph
    ? graphs[Number(graph[1])]
    : join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
  if (
    !file ||
    !file.startsWith(graph ? '/' : dist) ||
    !existsSync(file) ||
    statSync(file).isDirectory()
  ) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/json' });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const { chromium } = createRequire(join(root, 'package.json'))('@playwright/test');
const preinstalled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  existsSync(preinstalled) ? { executablePath: preinstalled } : {},
);
const frame = (page) =>
  page.evaluate(
    () =>
      new Promise((ok) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(ok)),
      ),
  );

try {
  for (const [i, graph] of graphs.entries()) {
    const viewport = { width: Number(values.width), height: Number(values.height) };
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    let started = Date.now();
    await page.goto(`${base}/index.html?graph=/graphs/${i}.json`);
    await page.waitForSelector('.react-flow__node-symbol', { timeout: 180_000 });
    await frame(page);
    const firstPaint = Date.now() - started;
    // These functions run in the page: its globals are reached through globalThis.
    const dom = await page.evaluate(() => {
      const { document } = globalThis;
      return {
        nodes: document.querySelectorAll('.react-flow__node').length,
        edges: document.querySelectorAll('.react-flow__edge').length,
        elements: document.getElementsByTagName('*').length,
      };
    });
    if (values.shot) {
      mkdirSync(values.shot, { recursive: true });
      await page.screenshot({ path: join(values.shot, `${basename(graph, '.json')}.png`) });
    }

    // As a reviewer: open the first change from the list, then mark it reviewed (r).
    await page.getByRole('tab', { name: /Changes/ }).click();
    started = Date.now();
    await page.locator('.list-link').first().click();
    await page.waitForSelector('.panel-title');
    await frame(page);
    const select = Date.now() - started;
    started = Date.now();
    await page.keyboard.press('r');
    await frame(page);
    const review = Date.now() - started;

    // Pan for a moment and count animation frames.
    const pane = await page.locator('.react-flow__pane').boundingBox();
    const x = (pane?.x ?? 0) + (pane?.width ?? 0) / 2;
    const y = (pane?.y ?? 0) + (pane?.height ?? 0) / 2;
    await page.mouse.move(x, y);
    await page.evaluate(() => {
      globalThis.__frames = 0;
      const tick = () => {
        globalThis.__frames++;
        globalThis.__raf = globalThis.requestAnimationFrame(tick);
      };
      tick();
    });
    await page.mouse.down();
    started = Date.now();
    for (let step = 0; step < 30; step++) await page.mouse.move(x + step * 8, y + step * 4);
    await page.mouse.up();
    const panMs = Date.now() - started;
    const frames = await page.evaluate(() => {
      globalThis.cancelAnimationFrame(globalThis.__raf);
      return globalThis.__frames;
    });

    const size = readFileSync(graph).length;
    console.log(
      JSON.stringify({
        graph: basename(graph),
        bytes: size,
        firstPaint,
        select,
        review,
        panFps: Math.round((frames / panMs) * 1000),
        dom,
        errors,
      }),
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
