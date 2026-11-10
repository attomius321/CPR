// A screenshot of each problem, at 1x on the person's screen, in both themes, into shots/.
// Each problem sets up its view on a running `symbiote view` (ports as in the README's method),
// then shoots it whole or cropped to what the problem is about.
// Usage: node problems.mjs [p01 p02 …]   (none: all)
import { newPage, openBrowser, shotBoth } from './lib.mjs';

const PORTS = { flakes: 47311, issues: 47312, cli: 47313, bitwarden: 47314, qwik: 47315 };
const PATHS = {
  flakes: '/review/fix%2Fe2e-flakes/',
  issues: '/review/feature%2Fissues-page/',
  cli: '/review/refactor%2Fcli-services/',
  bitwarden: '/diff/0cb1967fc1c3b838c1ac2c4fa27ed8a029c89c4e..737ee3f3435fa99ef5636f7a15d31d6f05d39877/',
  qwik: '/diff/e4d0a19c0b8e5454f3c65766de653411cf58526f..65661bf49bcf419c4f8fdd43520b2f8c06dcdd73/',
};
const url = (change, view = 'graph') =>
  `http://127.0.0.1:${PORTS[change]}${PATHS[change]}${view === 'graph' ? '?view=graph' : ''}`;

const settle = (page, ms = 900) => page.waitForTimeout(ms);
const BRANCHES = { flakes: 'fix/e2e-flakes', issues: 'feature/issues-page', cli: 'refactor/cli-services' };
const opened = new Set();
/** A branch review is opened as a workspace's Review does (POST /api/reviews), once per run. */
async function open(page, change) {
  if (!BRANCHES[change] || opened.has(change)) return;
  await page.goto(`http://127.0.0.1:${PORTS[change]}/git`);
  await page.evaluate(async (ref) => {
    await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify({ ref }),
    });
  }, BRANCHES[change]);
  await page.goto(url(change, 'files'));
  await page.waitForFunction(() => document.querySelector('.files-main') && !document.querySelector('.analysis-state'), null, { timeout: 300_000 });
  opened.add(change);
}
async function graph(page, change) {
  await open(page, change);
  await page.goto(url(change));
  await page.locator('.react-flow__node').first().waitFor({ timeout: 120_000 });
  await settle(page);
}
async function pickFinding(page, i = 0) {
  await page.locator('.sidebar .finding-row').nth(i).click();
  await page.locator('.panel').waitFor();
  await settle(page, 700);
}
const zoomNow = (page) =>
  page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
async function zoomToOneAtSelected(page) {
  const b = await page.locator('.symbol.selected').first().boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < 40 && (await zoomNow(page)) < 0.99; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(60);
  }
  await settle(page, 500);
}
/** Marks an element for the reader of a screenshot: a dashed ring, nothing else moves. */
async function ring(page, selector) {
  // Inside the canvas a width is in the layout's px: 3 px on screen at any zoom.
  const z = await zoomNow(page);
  await page.addStyleTag({
    content: `${selector} { outline: ${3 / z}px dashed #ff3da5 !important; outline-offset: ${6 / z}px !important; }`,
  });
}

const problems = {
  async p01(page) {
    await graph(page, 'flakes');
    await shotBoth(page, 'p01-first-view-small-fix');
    await graph(page, 'issues');
    await shotBoth(page, 'p01-first-view-feature');
  },
  async p02(page) {
    await graph(page, 'flakes');
    await pickFinding(page);
    await zoomToOneAtSelected(page);
    await shotBoth(page, 'p02-graph-type-at-zoom-1', { x: 60, y: 60, width: 1500, height: 720 });
  },
  async p03(page) {
    await graph(page, 'flakes');
    await pickFinding(page);
    await ring(page, '.react-flow__node:has(.symbol.selected)');
    await shotBoth(page, 'p03-pick-keeps-the-zoom');
  },
  async p04(page) {
    await graph(page, 'bitwarden');
    await pickFinding(page);
    await page.keyboard.press('f');
    await settle(page, 1200);
    await shotBoth(page, 'p04-focus-draws-no-users');
    await graph(page, 'flakes');
    await pickFinding(page);
    await page.keyboard.press('f');
    await settle(page, 1200);
    await shotBoth(page, 'p04-focus-users-unlinked');
  },
  async p05(page) {
    await graph(page, 'issues');
    await ring(page, '.react-flow__node[data-id$="#Route"]');
    await shotBoth(page, 'p05-map-hides-findings', { x: 0, y: 60, width: 2100, height: 800 });
  },
  async p06(page) {
    await graph(page, 'flakes');
    await shotBoth(page, 'p06-head-vs-findings-tab', { x: 0, y: 0, width: 2560, height: 150 });
    await graph(page, 'cli');
    await shotBoth(page, 'p06-findings-flood', { x: 60, y: 60, width: 340, height: 1350 });
  },
  async p07(page) {
    await open(page, 'issues');
    await page.goto(url('issues', 'files'));
    await page.locator('.files-main .file-code, .files-main .hint').first().waitFor({ timeout: 60_000 });
    await settle(page);
    await shotBoth(page, 'p07-files-opens-on-docs');
  },
  async p08(page) {
    await graph(page, 'issues');
    await pickFinding(page);
    await page.keyboard.press('g');
    await page.locator('.files-main').waitFor();
    await settle(page);
    await shotBoth(page, 'p08-g-forgets-the-symbol');
  },
  async p09(page) {
    await graph(page, 'flakes');
    await pickFinding(page);
    await shotBoth(page, 'p09-panel-code-cut', { x: 2205, y: 60, width: 355, height: 1350 });
    await graph(page, 'bitwarden');
    await pickFinding(page);
    await shotBoth(page, 'p09-signature-no-diff', { x: 2205, y: 60, width: 355, height: 1350 });
  },
  async p10(page) {
    // The small fix after every symbol was marked reviewed on Graph (walk.mjs --finish).
    await graph(page, 'flakes');
    await page.getByRole('tab', { name: /Changes/ }).click();
    await settle(page, 400);
    for (const box of await page.locator('.list-item:not(.done) [aria-label^="Mark "]').all()) {
      await box.click();
    }
    await page.mouse.move(1500, 700);
    await settle(page, 400);
    await shotBoth(page, 'p10-graph-all-reviewed', { x: 60, y: 60, width: 340, height: 700 });
    await page.keyboard.press('g');
    await page.locator('.files-main').waitFor();
    await page.mouse.move(1500, 700);
    await settle(page);
    await shotBoth(page, 'p10-files-none-viewed', { x: 60, y: 60, width: 340, height: 700 });
  },
  async p11(page) {
    await graph(page, 'flakes');
    await pickFinding(page);
    await zoomToOneAtSelected(page);
    await shotBoth(page, 'p11-context-louder-than-change', { x: 395, y: 700, width: 1810, height: 660 });
  },
  async p12(page) {
    await graph(page, 'issues');
    await shotBoth(page, 'p12-map-labels', { x: 770, y: 120, width: 1440, height: 1230 });
  },
  async p13(page) {
    await graph(page, 'flakes');
    await pickFinding(page);
    await page.locator('.panel .neighbours .link:not([disabled])').first().click();
    await settle(page, 600);
    await shotBoth(page, 'p13-no-way-back', { x: 2205, y: 60, width: 355, height: 700 });
  },
  async p14(page) {
    await graph(page, 'bitwarden');
    await pickFinding(page);
    await shotBoth(page, 'p14-compare-has-no-review');
  },
  async p15(page) {
    await graph(page, 'issues');
    await shotBoth(page, 'p15-stylesheet-rules', { x: 770, y: 120, width: 1300, height: 260 });
  },
};

const which = process.argv.slice(2);
const browser = await openBrowser();
for (const [id, run] of Object.entries(problems)) {
  if (which.length && !which.includes(id)) continue;
  const page = await newPage(browser, 'dark');
  try {
    await run(page);
    console.log(id, 'ok', page.errors.length ? page.errors : '');
  } catch (error) {
    console.log(id, 'failed', String(error).split('\n')[0]);
  }
  await page.context().close();
}
await browser.close();
