// How the viewer feels on real graphs: for each interaction a reviewer does, how long it took,
// how long the main thread was blocked (long animation frames over 50 ms) and the worst frame;
// on the map, how many file-box click spots reach the box, and what its page elements are.
// Usage: node scripts/viewer/interactions.mjs <graph.json>… [--dist <viewer dist>] [--rounds 3]
//          [--json <out.json>]
// Build first (pnpm build). Rounds are run back to back; the median is reported (timings vary
// by ±30 % on a busy machine). To compare with main, run it with --dist of a main worktree.
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
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
    rounds: { type: 'string', default: '3' },
    json: { type: 'string' },
  },
});
const dist = resolve(values.dist);
if (!existsSync(join(dist, 'index.html')))
  throw new Error(`no viewer build in ${dist}: pnpm build`);
if (positionals.length === 0)
  throw new Error('usage: interactions.mjs <graph.json>… [--dist <dir>]');
const graphs = positionals.map((p) => resolve(p));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const g = /^\/graphs\/(\d+)\.json$/.exec(url.pathname);
  const file = g
    ? graphs[Number(g[1])]
    : join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file || !existsSync(file) || statSync(file).isDirectory())
    return void res.writeHead(404).end();
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

// Page code reaches its globals through globalThis.
const OBSERVE = () => {
  globalThis.__loaf = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) globalThis.__loaf.push([e.startTime, e.duration]);
  }).observe({ type: 'long-animation-frame', buffered: true });
};

/** One pass over a graph: every interaction once, in a reviewer's order. */
async function pass(index) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(OBSERVE);
  const settle = async (ms) => {
    await page.waitForTimeout(ms);
    await page.evaluate(
      () =>
        new Promise((ok) =>
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(ok)),
        ),
    );
  };
  const rows = {};
  const measure = async (name, action, wait = 500) => {
    const from = await page.evaluate(() => globalThis.performance.now());
    const started = Date.now();
    try {
      await action();
    } catch (error) {
      rows[name] = { error: String(error.message).split('\n')[0] };
      return;
    }
    const took = Date.now() - started;
    await settle(wait);
    rows[name] = {
      took,
      ...(await page.evaluate((from) => {
        const frames = globalThis.__loaf.filter(([t]) => t >= from).map(([, d]) => d);
        return {
          blocked: Math.round(frames.reduce((s, d) => s + Math.max(0, d - 50), 0)),
          worst: Math.round(Math.max(0, ...frames)),
        };
      }, from)),
    };
  };
  const center = async () => {
    const b = await page.locator('.react-flow__pane').boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const wheel = async (dy, n) => {
    const { x, y } = await center();
    await page.mouse.move(x, y);
    for (let k = 0; k < n; k++) {
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(30);
    }
  };
  const drag = async () => {
    const { x, y } = await center();
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let k = 1; k <= 30; k++) await page.mouse.move(x + k * 10, y + k * 5);
    await page.mouse.up();
  };

  const started = Date.now();
  await page.goto(`${base}/index.html?graph=/graphs/${index}.json`);
  await page.waitForSelector('.react-flow__node-symbol', { timeout: 180_000 });
  await settle(0);
  const took = Date.now() - started;
  const painted = await page.evaluate(() => globalThis.performance.now());
  // A long frame is reported after it ends: read them once the page is idle, or the last (and
  // longest) frame of opening is missed at random (V8c: main's open read 135 or 454 ms).
  await settle(600);
  rows.open = {
    took,
    ...(await page.evaluate((painted) => {
      const frames = globalThis.__loaf.filter(([t]) => t < painted).map(([, d]) => d);
      return {
        blocked: Math.round(frames.reduce((s, d) => s + Math.max(0, d - 50), 0)),
        worst: Math.round(Math.max(0, ...frames)),
      };
    }, painted)),
  };
  const map = await mapState(page);

  await measure('pan, overview', drag);
  await page.getByRole('tab', { name: /Changes/ }).click();
  await measure('select a change', async () => {
    await page
      .locator('.list-link')
      .nth(Math.min(3, (await page.locator('.list-link').count()) - 1))
      .click();
    await page.waitForSelector('.panel-title');
  });
  await measure('pan, zoomed in', drag);
  await measure('next change (j) ×8', async () => {
    for (let k = 0; k < 8; k++) {
      await page.keyboard.press('j');
      await page.waitForTimeout(120);
    }
  });
  await measure('mark reviewed (r)', () => page.keyboard.press('r'));
  await measure('zoom out ×20', () => wheel(120, 20));
  await measure('zoom in ×10', () => wheel(-120, 10));
  await measure('context off', () => page.getByLabel('Context', { exact: true }).uncheck(), 800);
  await measure('context on', () => page.getByLabel('Context', { exact: true }).check(), 800);
  if ((await page.locator('.list-project').count()) > 0) {
    await measure('next project (p)', () => page.keyboard.press('p'), 800);
  }
  await page.close();
  return { rows, map, errors };
}

/** On the opening view (the map, for large graphs): click reach and page elements by kind. */
async function mapState(page) {
  return page.evaluate(() => {
    const { document } = globalThis;
    const pane = document.querySelector('.react-flow__pane').getBoundingClientRect();
    let spots = 0;
    let reached = 0;
    for (const box of document.querySelectorAll('.react-flow__node-file')) {
      const r = box.getBoundingClientRect();
      for (const [fx, fy] of [
        [0.1, 0.1],
        [0.5, 0.5],
        [0.9, 0.9],
      ]) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (x < pane.left || x > pane.right || y < pane.top || y > pane.bottom) continue;
        spots++;
        if (document.elementFromPoint(x, y)?.closest('.react-flow__node') === box) reached++;
      }
    }
    const inside = (selector) =>
      [...document.querySelectorAll(selector)].reduce(
        (n, el) => n + 1 + el.getElementsByTagName('*').length,
        0,
      );
    return {
      map: Boolean(document.querySelector('.react-flow.map')),
      clicksReachFile: spots ? Math.round((100 * reached) / spots) : null,
      elements: {
        page: document.getElementsByTagName('*').length,
        symbols: inside('.react-flow__node-symbol'),
        edges: inside('.react-flow__edges'),
        files: inside('.react-flow__node-file'),
        frames: inside('.react-flow__node-project'),
      },
    };
  });
}

const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const report = [];
try {
  for (const [index, graph] of graphs.entries()) {
    const passes = [];
    for (let round = 0; round < Number(values.rounds); round++) passes.push(await pass(index));
    const names = Object.keys(passes[0].rows);
    const rows = Object.fromEntries(
      names.map((name) => {
        const ok = passes.map((p) => p.rows[name]).filter((r) => r && !r.error);
        if (ok.length === 0) return [name, passes[0].rows[name]];
        return [
          name,
          Object.fromEntries(
            ['took', 'blocked', 'worst'].map((k) => [k, median(ok.map((r) => r[k]))]),
          ),
        ];
      }),
    );
    const entry = {
      graph: basename(graph),
      rows,
      map: passes[0].map,
      errors: passes.flatMap((p) => p.errors),
    };
    report.push(entry);
    console.log(`\n## ${entry.graph} (median of ${passes.length})`);
    console.log(
      `${'interaction'.padEnd(22)}${'took ms'.padStart(9)}${'blocked ms'.padStart(12)}${'worst frame'.padStart(13)}`,
    );
    for (const [name, r] of Object.entries(rows)) {
      if (r.error) console.log(`${name.padEnd(22)}  ✗ ${r.error}`);
      else
        console.log(
          `${name.padEnd(22)}${String(r.took).padStart(9)}${String(r.blocked).padStart(12)}${String(r.worst).padStart(13)}`,
        );
    }
    const m = entry.map;
    console.log(
      `map: ${m.map ? 'yes' : 'no'}; file clicks reach the file ${m.clicksReachFile ?? '–'} %; elements ${JSON.stringify(m.elements)}`,
    );
    if (entry.errors.length) console.log(`page errors: ${[...new Set(entry.errors)].join('; ')}`);
  }
} finally {
  await browser.close();
  server.close();
}
if (values.json) writeFileSync(values.json, JSON.stringify(report, null, 2));
