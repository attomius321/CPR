// Measures what a project's name covers on the map (V96): at the opening zoom and at given map
// zooms, each project name's box against the file names and findings counts drawn, in the page.
// At a given zoom, the view visits each frame in turn (zoomed from the fitted view at its top-left
// corner, which stays where it was) and the findings of every visit are counted once.
// Usage: node scripts/viewer/map-labels.mjs <graph.json>… [--dist <viewer dist>]
//          [--zooms 0.3,0.2] [--theme dark|light] [--shot <dir>] [--width 1440 --height 900]
// Prints one JSON line per graph and zoom:
//   covered   file names drawn whole (opacity ≥ 0.9) whose box meets a project name's box
//   dimmed    file names under a project name, drawn faint (V96)
//   outside   project names wider than their frame, or past its left or right edge
//   countsUnder  findings counts (V100) a project name is drawn over
// --shot saves <dir>/<graph>-<zoom>.png. Build first (pnpm build).
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dist: { type: 'string', default: join(root, 'packages/viewer/dist') },
    zooms: { type: 'string', default: '0.3,0.2' },
    theme: { type: 'string', default: 'dark' },
    shot: { type: 'string' },
    width: { type: 'string', default: '1440' },
    height: { type: 'string', default: '900' },
  },
});
const dist = resolve(values.dist);
if (!existsSync(join(dist, 'index.html'))) throw new Error(`no viewer build in ${dist}`);
if (positionals.length === 0) throw new Error('usage: map-labels.mjs <graph.json>… [--dist <dir>]');
const graphs = positionals.map((path) => resolve(path));
const zooms = values.zooms.split(',').filter(Boolean).map(Number);

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

/** The canvas's zoom, from its viewport's transform. */
const zoomOf = (page) =>
  page.evaluate(() => {
    const viewport = globalThis.document.querySelector('.react-flow__viewport');
    return new globalThis.DOMMatrix(globalThis.getComputedStyle(viewport).transform).a;
  });

/**
 * Wheel at `at` (screen px; the canvas's centre by default) until the zoom is `target`
 * (d3-zoom: 2^(-deltaY × 0.002)). The graph point under the pointer stays where it is.
 */
async function zoomTo(page, target, at) {
  const pane = await page.locator('.react-flow__pane').boundingBox();
  const point = at ?? { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 };
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < 6; i++) {
    const now = await zoomOf(page);
    if (Math.abs(now - target) < 0.002) break;
    await page.mouse.wheel(0, -Math.log2(target / now) / 0.002);
    await page.waitForTimeout(150);
  }
  // The file names' cut and the dimming follow once the zoom rests (CUT_REST_MS, 120 ms).
  await page.waitForTimeout(400);
}

/** The canvas's transform: its pan, in screen px, and its zoom. */
const transformOf = (page) =>
  page.evaluate(() => {
    const viewport = globalThis.document.querySelector('.react-flow__viewport');
    const m = new globalThis.DOMMatrix(globalThis.getComputedStyle(viewport).transform);
    return { x: m.e, y: m.f, zoom: m.a };
  });

/** Each frame's top-left corner in graph coordinates, from the frames drawn now. */
const framesOf = (page) =>
  page.evaluate(() => {
    const { document } = globalThis;
    const pane = document.querySelector('.react-flow__pane').getBoundingClientRect();
    return [...document.querySelectorAll('.react-flow__node-project')].map((node) => {
      const r = node.getBoundingClientRect();
      return { id: node.dataset.id, x: r.left - pane.left, y: r.top - pane.top };
    });
  });

/** The opening view again, by the canvas's own button: the whole graph fitted. */
async function fitAll(page) {
  await page.locator('.react-flow__controls-fitview').click();
  await page.waitForTimeout(400);
}

/** Boxes on screen, and which of two overlapping elements is drawn on top. */
function measureLabels() {
  const { document } = globalThis;
  const box = (el) => el.getBoundingClientRect();
  const meets = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const shown = (el) => {
    const r = box(el);
    return r.width > 0 && r.height > 0 && globalThis.getComputedStyle(el).display !== 'none';
  };
  const names = [...document.querySelectorAll('.react-flow.map .project-name')].filter(shown);
  const files = [...document.querySelectorAll('.react-flow.map .file-name')].filter(shown);
  const counts = [...document.querySelectorAll('.react-flow.map .map-count')].filter(shown);
  const opacity = (el) => {
    let o = 1;
    for (let e = el; e && e !== document.body; e = e.parentElement)
      o *= Number(globalThis.getComputedStyle(e).opacity);
    return o;
  };
  const covered = [];
  const dimmed = [];
  for (const file of files) {
    const under = names.filter((name) => meets(box(name), box(file)));
    if (under.length === 0) continue;
    const entry = `${file.textContent} under ${under.map((n) => n.textContent).join(', ')}`;
    if (opacity(file) >= 0.9) covered.push(entry);
    else dimmed.push(entry);
  }
  const outside = [];
  for (const name of names) {
    const frame = box(name.closest('.project-frame'));
    const r = box(name);
    if (r.left < frame.left - 1 || r.right > frame.right + 1) outside.push(name.textContent);
  }
  // Which is on top where a count and a name meet: hit-test with every element taking the pointer.
  const style = document.createElement('style');
  style.textContent = '* { pointer-events: auto !important; }';
  document.head.append(style);
  const countsUnder = [];
  for (const count of counts) {
    const c = box(count);
    const name = names.find((n) => meets(box(n), c));
    if (!name) continue;
    const top = document
      .elementsFromPoint(c.left + c.width / 2, c.top + c.height / 2)
      .find((el) => el === count || name.contains(el) || el === name);
    if (top !== count) countsUnder.push(`${count.dataset.symbol} under ${name.textContent}`);
  }
  style.remove();
  return {
    names: names.length,
    files: files.length,
    counts: counts.length,
    covered,
    dimmed,
    outside,
    countsUnder,
  };
}

try {
  for (const [i, graph] of graphs.entries()) {
    const viewport = { width: Number(values.width), height: Number(values.height) };
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(
      (theme) => globalThis.localStorage.setItem('symbiote.viewer.theme', theme),
      values.theme,
    );
    await page.goto(`${base}/index.html?graph=/graphs/${i}.json&view=graph`);
    await page.waitForSelector('.react-flow__node-symbol', { timeout: 180_000 });
    await page.waitForTimeout(800);
    // Every frame's corner in graph coordinates, from the opening view (fitted: all are drawn).
    const opening = await transformOf(page);
    const frames = (await framesOf(page)).map((f) => ({
      id: f.id,
      x: (f.x - opening.x) / opening.zoom,
      y: (f.y - opening.y) / opening.zoom,
    }));
    for (const target of [undefined, ...zooms]) {
      const zoom = target ?? (await zoomOf(page));
      const seen = {
        names: 0,
        files: 0,
        counts: 0,
        covered: [],
        dimmed: [],
        outside: [],
        countsUnder: [],
      };
      const visits = target === undefined ? [undefined] : frames;
      for (const frame of visits) {
        // Each frame from the fitted view, zoomed at a point just inside its top-left corner.
        if (frame) {
          await fitAll(page);
          const pane = await page.locator('.react-flow__pane').boundingBox();
          const view = await transformOf(page);
          await zoomTo(page, target, {
            x: pane.x + (frame.x + 4) * view.zoom + view.x,
            y: pane.y + (frame.y + 4) * view.zoom + view.y,
          });
        }
        const now = await zoomOf(page);
        if (Math.abs(now - zoom) > 0.002) throw new Error(`the zoom moved: ${now}, not ${zoom}`);
        const result = await page.evaluate(measureLabels);
        seen.names = Math.max(seen.names, result.names);
        seen.files = Math.max(seen.files, result.files);
        seen.counts = Math.max(seen.counts, result.counts);
        for (const key of ['covered', 'dimmed', 'outside', 'countsUnder']) {
          for (const entry of result[key]) if (!seen[key].includes(entry)) seen[key].push(entry);
        }
        if (values.shot) {
          mkdirSync(values.shot, { recursive: true });
          const where = frame ? `-${frame.id.replace(/[^a-z0-9]+/gi, '_')}` : '';
          const name = `${basename(graph, '.json')}-${target ?? 'opening'}${where}-${values.theme}.png`;
          await page.screenshot({ path: join(values.shot, name) });
        }
      }
      const count = (list) => list.length;
      console.log(
        JSON.stringify({
          graph: basename(graph),
          at: target ?? 'opening',
          zoom: Math.round(zoom * 1000) / 1000,
          visits: visits.length,
          names: seen.names,
          files: seen.files,
          counts: seen.counts,
          covered: count(seen.covered),
          dimmed: count(seen.dimmed),
          outside: count(seen.outside),
          countsUnder: count(seen.countsUnder),
          detail: { covered: seen.covered, outside: seen.outside, countsUnder: seen.countsUnder },
          errors,
        }),
      );
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
