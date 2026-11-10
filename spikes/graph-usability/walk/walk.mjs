// Walks a reviewer's tasks on one change, served by a real `symbiote view`, on the shortest path
// the screen offers (found by exploring first): open the diff, find the riskiest change, follow
// its callers, read a finding and get to its code, comment, mark reviewed, know when done.
// Counts each operation, times each wait, and writes walk-<name>.json beside the shots.
// Usage: node walk.mjs <port> <name> (--branch <b> | --path </diff/…/>) [--finish]
//   --finish: on a small change, mark every symbol and file and finish the review (Comment);
//   only in a scratch repository: it writes the review there.
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Walker, here, klm, newPage, openBrowser, shot } from './lib.mjs';
import { readCanvas } from './read-canvas.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    branch: { type: 'string' },
    path: { type: 'string' },
    finish: { type: 'boolean' },
  },
});
const [port, name] = positionals;
const origin = `http://127.0.0.1:${port}`;
const browser = await openBrowser();
const page = await newPage(browser, 'dark');
const w = new Walker(page, name);
const facts = {};
const frame = () =>
  page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
const pane = async () => (await page.locator('.react-flow').boundingBox()) ?? { x: 0, y: 0, width: 1, height: 1 };
/** The selected symbol's card on screen, and whether it is inside the canvas. */
const selectedBox = async () => {
  const box = await page.locator('.symbol.selected').first().boundingBox().catch(() => null);
  if (!box) return null;
  const p = await pane();
  const inView =
    box.x >= p.x && box.y >= p.y && box.x + box.width <= p.x + p.width && box.y + box.height <= p.y + p.height;
  return { ...box, inView };
};
const zoomNow = () =>
  page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);

try {
  // ---- 1. Open the diff: a workspace's Review (one click), then the Files page, then the graph.
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
  w.start('open the diff');
  w.count('click'); // Review, on the workspace's card or head
  await w.wait('Files page (or the analysis steps) drawn', async () => {
    await page.goto(`${origin}${path}`);
    await page.locator('.files-main, .opening, .react-flow').first().waitFor({ timeout: 600_000 });
  });
  await w.wait('analysis done, graph ready', () =>
    page.waitForFunction(() => !document.querySelector('.analysis-state'), null, { timeout: 900_000 }),
  );
  await page.locator('.files-main').waitFor({ timeout: 60_000 });
  await frame();
  facts.files = await page.evaluate(() =>
    [...document.querySelectorAll('.files-list .changes-file')].map((e) => e.getAttribute('aria-label') ?? e.textContent),
  );
  facts.firstFileShown = await page.locator('.file-head, .files-head, .file-title').first().textContent().catch(() => null);
  facts.headPills = await page.locator('.finding-pill').allTextContents();
  w.read('the head: title, facts, pills');
  await shot(page, `walk-${name}-1-files`);
  w.end();

  // ---- 2. Find the riskiest change: Files has no findings; Graph's Findings tab lists them.
  w.start('find the riskiest change');
  w.count('switch');
  w.count('key'); // g
  await w.wait('Graph page drawn', async () => {
    await page.keyboard.press('g');
    await page.locator('.react-flow__node').first().waitFor({ timeout: 120_000 });
    await frame();
  });
  await page.waitForTimeout(800); // the fit's animation
  facts.fit = await page.evaluate(readCanvas);
  facts.findingsTab = await page.getByRole('tab', { name: /Findings/ }).textContent();
  const findings = page.locator('.sidebar .finding-row');
  facts.findingsListed = await findings.count();
  facts.findingSeverities = await page.evaluate(() =>
    [...document.querySelectorAll('.sidebar .finding-row')].map((e) => e.className.match(/finding-(error|warning|info)/)?.[1]),
  );
  if (facts.findingsListed === 0) {
    w.note('no findings: the riskiest change has to be guessed from the change list or the canvas');
    await page.getByRole('tab', { name: /Changes/ }).click();
    w.count('click');
    w.read('the change list');
    await w.wait('first change selected', async () => {
      await page.locator('.list-link').first().click();
      await page.locator('.panel').waitFor();
    });
    w.count('click');
  } else {
    w.read('the findings list');
    facts.firstFinding = await findings.first().textContent();
    await w.wait('finding selected, panel drawn', async () => {
      await findings.first().click();
      await page.locator('.panel').waitFor();
      await frame();
    });
    w.count('click');
    w.read('the finding in the panel');
  }
  await page.waitForTimeout(400);
  facts.selectedAfterPick = await selectedBox();
  facts.zoomAfterPick = await zoomNow();
  facts.panelTitle = await page.locator('.panel-head').first().textContent();
  await shot(page, `walk-${name}-2-riskiest`);
  w.end({ zoom: facts.zoomAfterPick, selected: facts.selectedAfterPick });

  // ---- 3. Follow who calls it and what it calls: the panel's lists, then the canvas.
  w.start('follow callers and callees');
  const lists = await page.evaluate(() =>
    [...document.querySelectorAll('.panel .panel-block')]
      .map((b) => ({ title: b.querySelector('h3, h4, .panel-block-title, header')?.textContent?.trim() ?? b.textContent.trim().slice(0, 20), links: b.querySelectorAll('.neighbours .link').length }))
      .filter((b) => b.links > 0),
  );
  facts.neighbourLists = lists;
  w.read('used by / uses lists');
  const firstUser = page.locator('.panel .neighbours .link:not([disabled])').first();
  const selectedId = await page.locator('.panel-head').first().textContent();
  if (await firstUser.count()) {
    facts.followed = await firstUser.textContent();
    await w.wait('a caller selected', async () => {
      await firstUser.click();
      await page.waitForFunction((was) => document.querySelector('.panel-head')?.textContent !== was, selectedId);
      await frame();
    });
    w.count('click');
    await page.waitForTimeout(400);
    facts.callerOnCanvas = await selectedBox();
    w.read('the caller in the panel');
    // Back: the panel has no back; the finding (or the list) again.
    if (facts.findingsListed > 0) {
      await findings.first().click();
      w.count('click');
      w.note('no back from a followed symbol: re-picked the finding');
    } else {
      await page.keyboard.press('k');
      w.count('key');
    }
    await page.locator('.panel').waitFor();
  } else {
    w.note('no neighbours listed for this symbol');
  }
  // On the canvas: Focus (f) narrows to the symbol's neighbourhood and fits it.
  const before = await zoomNow();
  await w.wait('Focus laid out and fitted', async () => {
    await page.keyboard.press('f');
    await page.waitForTimeout(350); // fitView's 300 ms
    await frame();
  });
  w.count('key');
  await page.waitForTimeout(300);
  facts.focus = await page.evaluate(readCanvas);
  await shot(page, `walk-${name}-3-focus`);
  await page.keyboard.press('f');
  w.count('key');
  await page.waitForTimeout(800);
  // Leaving Focus keeps its zoom: the fit button shows the whole change again.
  await page.locator('.react-flow__controls-fitview').first().click();
  w.count('click');
  await page.waitForTimeout(800);
  facts.zoomAfterFocusOffAndFit = await zoomNow();
  // Without Focus: wheel at the selected card until its name is at its 12 px (zoom 1).
  const box = await selectedBox();
  let notches = 0;
  if (box) {
    const p = await pane();
    const x = Math.min(Math.max(box.x + box.width / 2, p.x + 10), p.x + p.width - 10);
    const y = Math.min(Math.max(box.y + box.height / 2, p.y + 10), p.y + p.height - 10);
    while ((await zoomNow()) < 0.99 && notches < 40) {
      await w.wheel(x, y, -100);
      notches++;
    }
    await page.waitForTimeout(400);
    facts.zoomInNotches = notches;
    facts.zoomedFrom = before;
    facts.afterZoomIn = await selectedBox();
    await shot(page, `walk-${name}-3-zoomed`);
    // Back to the whole change: fit (the canvas's fit button).
    await page.locator('.react-flow__controls-fitview, [aria-label*="Fit"]').first().click().catch(() => {});
    w.count('click');
    await page.waitForTimeout(600);
  }
  w.end({ zoomInNotches: notches });

  // ---- 4. Read a finding and get to its code: the panel's excerpt, then the lines in Files.
  w.start('read a finding, get to its code');
  const code = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.panel .code-rows > *')];
    const box = document.querySelector('.panel .code');
    const right = box?.getBoundingClientRect().right ?? 0;
    const textRight = (row) => {
      const range = document.createRange();
      range.selectNodeContents(row.lastElementChild ?? row);
      return range.getBoundingClientRect().right;
    };
    const changed = document.querySelector('.panel .code-rows .row-add, .panel .code-rows .row-del');
    const lns = changed ? [...changed.querySelectorAll('.ln')].map((e) => e.textContent.trim()) : [];
    return {
      rows: rows.length,
      cut: rows.filter((r) => textRight(r) > right + 1).length,
      firstChanged: changed ? (changed.classList.contains('row-del') ? `base:${lns[0]}` : `head:${lns[1]}`) : null,
      more: !!document.querySelector('.panel .more'),
      panelWidth: document.querySelector('.panel')?.getBoundingClientRect().width,
    };
  });
  facts.excerpt = code;
  w.read('the changed lines in the panel');
  const where = await page.locator('.panel-at, .panel-where').first().textContent();
  facts.where = where;
  // To the same lines on Files: g, then the file in the list, then scroll to the line.
  const file = await page.evaluate(() => {
    const e = document.querySelector('.panel .panel-file');
    return e?.getAttribute('data-tip') ?? e?.textContent?.trim() ?? null;
  });
  const symbolLine = Number((where?.match(/line (\d+)/) ?? [])[1] ?? 0);
  w.count('switch');
  await w.wait('Files page drawn', async () => {
    await page.keyboard.press('g');
    await page.locator('.files-main').waitFor();
    await frame();
  });
  w.count('key');
  facts.filesPageOpenedOn = await page.locator('.file-path').first().textContent().catch(() => null);
  w.read("find the symbol's file in the list");
  // The file's row: scrolled to if the list hides it, then clicked.
  const rowFor = page.locator(`.files-list .changes-file[aria-label="Show the changes to ${file}"]`);
  if (file && (await rowFor.count())) {
    facts.fileIndex = await page.evaluate(
      (f) => [...document.querySelectorAll('.files-list .changes-file')].findIndex((e) => e.getAttribute('aria-label') === `Show the changes to ${f}`),
      file,
    );
    const listBox = await page.locator('.files-scroll').boundingBox();
    let rowBox = await rowFor.boundingBox();
    let scrolls = 0;
    while (listBox && rowBox && rowBox.y + rowBox.height > listBox.y + listBox.height && scrolls < 60) {
      await w.wheel(listBox.x + 50, listBox.y + 50, 100);
      scrolls++;
      rowBox = await rowFor.boundingBox();
    }
    facts.fileListScrolls = scrolls;
    await w.wait("the file's diff drawn", async () => {
      await rowFor.click();
      await page.locator('.file-code .row').first().waitFor({ timeout: 30_000 });
      await frame();
    });
    w.count('click');
    // The symbol's line: in view, or scrolled to (a notch is 100 px), or folded away.
    const key = code.firstChanged ?? `head:${symbolLine}`;
    const target = page.locator(`.file-code .row[data-key="${key}"]`);
    const codeBox = await page.locator('.files-main .file-code').boundingBox();
    if (await target.count()) {
      let t = await target.boundingBox();
      let n = 0;
      while (codeBox && t && t.y + t.height > codeBox.y + codeBox.height && n < 200) {
        await w.wheel(codeBox.x + 300, codeBox.y + 200, 100);
        n++;
        t = await target.boundingBox();
      }
      facts.lineScrolls = n;
    } else {
      facts.lineScrolls = null;
      w.note(`the symbol's changed line ${key} is not drawn (folded or the base side): had to search the diff`);
    }
    await shot(page, `walk-${name}-4-files-line`);
  } else w.note(`the panel's file (${file}) is not found in the Files list`);
  w.end({ panelFile: file, symbolLine });

  // ---- 5. Leave a comment: on Graph, the panel's box (c); on Files, a changed line.
  w.start('leave a comment (Files: a line)');
  const line = page.locator('.file-code .row-add.pickable, .file-code .row-del.pickable').first();
  if (await line.count()) {
    await line.click();
    w.count('click');
    await w.type('Why is this safe for its callers?');
    await w.wait('comment drafted', async () => {
      await page.keyboard.press('Control+Enter');
      await page.waitForTimeout(200);
    });
    w.count('key');
    await shot(page, `walk-${name}-5-comment-files`);
  } else w.note('no changed line to comment on in the first file');
  w.end();
  w.start('leave a comment (Graph: the panel)');
  await page.keyboard.press('g');
  w.count('key');
  w.count('switch');
  await page.locator('.react-flow__node').first().waitFor();
  await page.waitForTimeout(500);
  if (!(await page.locator('.panel').count())) {
    await page.locator('.sidebar .finding-row, .list-link').first().click();
    w.count('click');
    w.note('the panel closed when the page switched: picked the symbol again');
  }
  await page.locator('#comment-input').waitFor({ timeout: 10_000 }).catch(() => {});
  if (await page.locator('#comment-input').count()) {
    await page.keyboard.press('c');
    w.count('key');
    await w.type('Why is this safe for its callers?');
    await w.wait('comment drafted', async () => {
      await page.keyboard.press('Control+Enter');
      await page.waitForTimeout(200);
    });
    w.count('key');
    await page.keyboard.press('Escape'); // leave the field
    w.count('key');
    await shot(page, `walk-${name}-5-comment-graph`);
  } else w.note('no comment box in the panel');
  w.end();

  // ---- 6. Mark reviewed: r on the symbol (Graph); v on the file (Files).
  w.start('mark reviewed');
  const progress = () => page.locator('.review-progress-words').first().textContent();
  const was = await progress();
  await w.wait('progress updated', async () => {
    await page.keyboard.press('r');
    await page.waitForFunction((p) => document.querySelector('.review-progress-words')?.textContent !== p, was, { timeout: 10_000 }).catch(() => {});
  });
  w.count('key');
  facts.progressAfterOne = await progress();
  w.end();

  // ---- 7. Know when you're done: what the pages say is left.
  w.start('know when you are done');
  facts.progressWords = await progress();
  facts.changesTotal = await page.getByRole('tab', { name: /Changes/ }).textContent();
  w.read('the progress line');
  if (await page.getByRole('tab', { name: /Review/ }).count()) {
    await page.getByRole('tab', { name: /Review/ }).click();
    w.count('click');
    w.read('the review tab');
    await shot(page, `walk-${name}-7-review-tab`);
  } else w.note('two commits compared: no review, so no comments, no verdict, no Finish');
  if (values.finish) {
    // Every symbol: j then r; every file on Files: j then v. Times the whole run.
    const total = Number((facts.changesTotal.match(/\d+/) ?? ['0'])[0]);
    const t0 = performance.now();
    await page.getByRole('tab', { name: /Changes/ }).click();
    for (let i = 0; i < total; i++) {
      await page.keyboard.press('j');
      const id = await page.locator('.panel-head').first().textContent().catch(() => null);
      const done = await page.locator('.panel .reviewed, .list-item.current.done').count();
      if (!done && id) await page.keyboard.press('r');
    }
    facts.markAllSymbolsMs = Math.round(performance.now() - t0);
    facts.progressAfterAll = await progress();
    await shot(page, `walk-${name}-7-all-symbols`);
    await page.keyboard.press('g');
    await page.locator('.files-main').waitFor();
    facts.filesViewedAfterSymbols = await page.locator('.files-state.viewed').count();
    await shot(page, `walk-${name}-7-files-after-symbols`);
  }
  w.end();
} catch (error) {
  console.error('walk stopped:', error);
  await shot(page, `walk-${name}-error`).catch(() => {});
  facts.error = String(error).slice(0, 400);
} finally {
  facts.pageErrors = page.errors;
  const out = { change: name, facts, tasks: w.tasks.map((t) => ({ ...t, klmSeconds: klm(t) })) };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(here, `../data/walk-${name}.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.tasks.map((t) => [t.name, t.ops, t.waits, t.klmSeconds]), null, 0));
  await browser.close();
}
