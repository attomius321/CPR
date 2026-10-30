// SPIKE (push instead of polling): how soon a merge's steps show. An approved branch merged with
// a 4 s check; each step's time is the server's own log line (`merge <state>`), and the page's is
// the first read or stream event holding that state. `SPIKE_PUSH=off` is polling, as main.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveAgentBranch, type RunningAgent } from './symbiote.js';

const MODE = process.env.SPIKE_PUSH ?? 'both';
const RESULTS = process.env.SPIKE_RESULTS ?? '/tmp/push-results.jsonl';
let symbiote: RunningAgent;
test.afterEach(() => symbiote?.stop());
test.setTimeout(5 * 60_000);

const RECORDER = () => {
  const arrivals: { t: number; text: string }[] = [];
  (window as unknown as Record<string, unknown>).__arrivals = arrivals;
  const original = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const res = await original.call(this, input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/\/api\/merges(\?|$)/.test(url)) void res.clone().text().then((text) => arrivals.push({ t: Date.now(), text }));
    return res;
  };
  const Source = window.EventSource;
  window.EventSource = class extends Source {
    constructor(url: string | URL, options?: EventSourceInit) {
      super(url, options);
      for (const name of ['state', 'change']) {
        this.addEventListener(name, (e) => arrivals.push({ t: Date.now(), text: (e as MessageEvent<string>).data }));
      }
    }
  };
};

async function approve(page: Page) {
  await page.goto(`${symbiote.url}git`);
  const tip = page.locator('.commit', { has: page.locator('.commit-subject', { hasText: 'Agent: add cube' }) });
  await tip.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Review', exact: true }).hover();
  await page.getByRole('menu', { name: 'Review' }).getByRole('menuitem').first().click();
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText('Approved');
}

test('a merge: each step, from the server saying it to the page having it', async ({ page, browser }) => {
  symbiote = await serveAgentBranch({}, { merger: ['{}'] });
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(join(symbiote.repo, 'symbiote', 'config.json'), JSON.stringify({ merge: { checks: ['sleep 4'] } }));
  await page.addInitScript(RECORDER);
  await approve(page);
  // Another window watches, as the person's other page would: it did not click (a context of its
  // own: no stream shared with the clicking tab).
  const watcher = await (await browser.newContext()).newPage();
  await watcher.addInitScript(RECORDER);
  await watcher.goto(`${symbiote.url}git`);
  await watcher.waitForTimeout(2_000);
  await page.getByRole('button', { name: 'Merge into', exact: true }).click();
  await watcher.waitForTimeout(20_000);
  const logs = join(symbiote.cache, 'logs');
  const steps = readdirSync(logs)
    .flatMap((f) => readFileSync(join(logs, f), 'utf8').split('\n'))
    .filter((l) => l.includes('"msg":"merge '))
    .map((l) => JSON.parse(l) as { time: string; state: string; msg: string });
  for (const [who, p] of [['the tab that clicked', page], ['another window', watcher]] as const) {
    const arrivals = await p.evaluate(() => (window as unknown as { __arrivals: { t: number; text: string }[] }).__arrivals);
    for (const step of steps) {
      const at = Date.parse(step.time);
      const got = arrivals.find((a) => a.t >= at - 50 && a.text.includes(`"state":"${step.state}"`));
      appendFileSync(
        RESULTS,
        `${JSON.stringify({ mode: MODE, test: 'merge', who, state: step.state, shownMs: got ? got.t - at : null })}\n`,
      );
    }
  }
});
