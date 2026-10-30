// SPIKE (push instead of polling): a page really hidden — a tab behind another in a headed
// browser, the app's window hidden — and a page really frozen (a timer checked), the change made
// meanwhile. `SPIKE_PUSH=off` is polling, as main. Results: JSON lines in `SPIKE_RESULTS`.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Readable } from 'node:stream';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, chromium, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

const MODE = process.env.SPIKE_PUSH ?? 'both';
const RESULTS = process.env.SPIKE_RESULTS ?? '/tmp/push-results.jsonl';
const save = (o: Record<string, unknown>) => appendFileSync(RESULTS, `${JSON.stringify({ mode: MODE, ...o })}\n`);
test.describe.configure({ mode: 'serial' });
test.setTimeout(5 * 60_000);
const B = 'feature/watched';
const row = `.workspace-row[data-branch="${B}"]`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let symbiote: RunningWorkspaces;
test.afterEach(() => symbiote?.stop());

const RECORDER = () => {
  const arrivals: { t: number; text: string }[] = [];
  (window as unknown as Record<string, unknown>).__arrivals = arrivals;
  const original = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const res = await original.call(this, input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/\/api\/workspaces(\?|$)/.test(url)) void res.clone().text().then((text) => arrivals.push({ t: Date.now(), text }));
    return res;
  };
  const Source = window.EventSource;
  window.EventSource = class extends Source {
    constructor(url: string | URL, options?: EventSourceInit) {
      super(url, options);
      for (const name of ['state', 'change']) this.addEventListener(name, (e) => arrivals.push({ t: Date.now(), text: (e as MessageEvent<string>).data }));
    }
  };
  // A timer's ticks: a frozen page's stop.
  (window as unknown as Record<string, number>).__ticks = 0;
  setInterval(() => (window as unknown as Record<string, number>).__ticks++, 100);
};

async function startXvfb(): Promise<{ name: string; stop(): void }> {
  for (let n = 161; n < 200; n++) {
    if (existsSync(`/tmp/.X${n}-lock`)) continue;
    const server = spawn('Xvfb', [`:${n}`, '-displayfd', '3', '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
    const ready = await new Promise<boolean>((resolve) => {
      (server.stdio[3] as Readable).once('data', () => resolve(true));
      server.once('exit', () => resolve(false));
    });
    if (ready) return { name: `:${n}`, stop: () => server.kill() };
  }
  throw new Error('no display');
}

async function workspace(): Promise<void> {
  symbiote = await serveWorkspaces();
  const status = await (
    await fetch(`${symbiote.url}api/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify({ brief: 'Watched.', branch: B, planFirst: false }),
    })
  ).status;
  if (status !== 200) throw new Error(`start: ${status}`);
  // Working: polling reads every 5 s, as while a real agent works.
  symbiote.session(B, { state: 'working' });
}

function waits(): number {
  const t0 = Date.now();
  symbiote.session(B, { state: 'blocked', waitingFor: 'permission prompt' });
  symbiote.hook(B, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } });
  return t0;
}
const firstAfter = async (page: Page, t0: number) =>
  ((await page.evaluate(() => (window as unknown as { __arrivals: { t: number; text: string }[] }).__arrivals)).find(
    (a) => a.t >= t0 && a.text.includes('blocked'),
  )?.t ?? null);
const shown = (page: Page) =>
  page.evaluate((sel) => /Respond|Waiting:/.test(document.querySelector(sel)?.textContent ?? ''), row);

test('a tab behind another in a headed browser', async () => {
  await workspace();
  const display = await startXvfb();
  // A real profile: its pages are tabs of one window, so a new one hides the first.
  const context = await chromium.launchPersistentContext(join(symbiote.cache, 'profile'), {
    headless: false,
    env: { ...process.env, DISPLAY: display.name, WAYLAND_DISPLAY: '' },
  });
  const browser = { close: () => context.close() };
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.addInitScript(RECORDER);
    await page.goto(symbiote.url);
    await page.waitForSelector(row);
    // Another tab in the same window, in front.
    const other = await context.newPage();
    await other.goto('about:blank');
    await sleep(2_000);
    const visibility = await page.evaluate(() => document.visibilityState);
    const t0 = waits();
    await sleep(30_000);
    const arrived = await firstAfter(page, t0);
    const shownWhileHidden = await shown(page);
    const ticks0 = await page.evaluate(() => (window as unknown as Record<string, number>).__ticks);
    await page.bringToFront();
    const back = Date.now();
    let shownAfter: number | null = null;
    for (let i = 0; i < 150 && shownAfter === null; i++) {
      if (await shown(page)) shownAfter = Date.now() - back;
      else await sleep(50);
    }
    save({ test: 'background tab 30 s', visibility, arrivedWhileHiddenMs: arrived === null ? null : arrived - t0, shownWhileHidden, shownAfterFrontMs: shownAfter, ticks: ticks0 });
  } finally {
    await browser.close();
    display.stop();
  }
});

test("the app's window hidden", async () => {
  await workspace();
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const desktop = join(root, 'packages/desktop');
  const electron = createRequire(join(desktop, 'package.json'))('electron') as string;
  const display = await startXvfb();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'WAYLAND_DISPLAY') env[k] = v;
  const app = await _electron.launch({
    executablePath: electron,
    args: [desktop, '--url', symbiote.url, '--title', 'repo'],
    env: { ...env, DISPLAY: display.name, XDG_CONFIG_HOME: join(symbiote.cache, 'app-config'), SYMBIOTE_INTRO: 'off', SYMBIOTE_LOG: 'off' },
  });
  try {
    const win = await app.firstWindow();
    await win.addInitScript(RECORDER);
    await win.reload();
    await win.waitForSelector(row);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide());
    await sleep(2_000);
    const visibility = await win.evaluate(() => document.visibilityState);
    const t0 = waits();
    await sleep(20_000);
    const arrived = await firstAfter(win, t0);
    save({ test: 'app window hidden 20 s', visibility, arrivedWhileHiddenMs: arrived === null ? null : arrived - t0, shownWhileHidden: await shown(win) });
  } finally {
    await app.close();
    display.stop();
  }
});

test('a page frozen 20 s, its timer checked', async ({ page }) => {
  await workspace();
  await page.addInitScript(RECORDER);
  await page.goto(symbiote.url);
  await page.waitForSelector(row);
  await sleep(1_000);
  const cdp = await page.context().newCDPSession(page);
  const ticks0 = await page.evaluate(() => (window as unknown as Record<string, number>).__ticks);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  const t0 = waits();
  await sleep(20_000);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  const thawed = Date.now();
  const ticks1 = await page.evaluate(() => (window as unknown as Record<string, number>).__ticks);
  let shownAfter: number | null = null;
  for (let i = 0; i < 200 && shownAfter === null; i++) {
    if (await shown(page)) shownAfter = Date.now() - thawed;
    else await sleep(25);
  }
  const arrived = await firstAfter(page, t0);
  save({ test: 'page frozen 20 s (checked)', ticksWhileFrozen: ticks1 - ticks0, arrivedAfterThawMs: arrived === null ? null : arrived - thawed, shownAfterThawMs: shownAfter });
});
