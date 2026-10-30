// SPIKE (push instead of polling): the reliability cases, against the push prototype. Copied into
// a patched copy's `packages/viewer/e2e/` beside `push.spec.ts` and run there with `SPIKE_PUSH`
// (`off` is polling, as main). Results: JSON lines in `SPIKE_RESULTS`. Fake agents only.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import type { Readable } from 'node:stream';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, chromium, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

const MODE = process.env.SPIKE_PUSH ?? 'both';
const RESULTS = process.env.SPIKE_RESULTS ?? '/tmp/push-results.jsonl';
const save = (o: Record<string, unknown>) =>
  appendFileSync(RESULTS, `${JSON.stringify({ mode: MODE, ping: process.env.SPIKE_PING, ...o })}\n`);

test.describe.configure({ mode: 'serial' });
test.setTimeout(10 * 60_000);

let symbiote: RunningWorkspaces;
const B = 'feature/watched';
const row = `.workspace-row[data-branch="${B}"]`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The data arrivals of a page: what the shell's reads and the stream brought, and when. */
const RECORDER = () => {
  const arrivals: { t: number; src: string; text: string }[] = [];
  (window as unknown as Record<string, unknown>).__arrivals = arrivals;
  const original = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const res = await original.call(this, input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/\/api\/(workspaces|mcp\/asks)(\?|$)/.test(url)) {
      void res.clone().text().then((text) => arrivals.push({ t: Date.now(), src: 'fetch', text }));
    }
    return res;
  };
  const Source = window.EventSource;
  window.EventSource = class extends Source {
    constructor(url: string | URL, options?: EventSourceInit) {
      super(url, options);
      for (const name of ['state', 'change']) {
        this.addEventListener(name, (e) =>
          arrivals.push({ t: Date.now(), src: `sse:${name}`, text: (e as MessageEvent<string>).data }),
        );
      }
    }
  };
};

function serverPid(): number {
  const running = join(symbiote.cache, 'running');
  const [file = ''] = readdirSync(running).filter((f) => f.endsWith('.json'));
  return (JSON.parse(readFileSync(join(running, file), 'utf8')) as { pid: number }).pid;
}

async function start(page: Page): Promise<void> {
  symbiote = await serveWorkspaces();
  await page.addInitScript(RECORDER);
  await page.goto(symbiote.url);
  const status = await page.evaluate(
    async (branch) =>
      (
        await fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
          body: JSON.stringify({ brief: 'Watched.', branch, planFirst: false }),
        })
      ).status,
    B,
  );
  if (status !== 200) throw new Error(`start: ${status}`);
  symbiote.session(B, { state: 'done' });
  await page.goto(symbiote.url);
  await page.waitForSelector(row);
  await sleep(3_000);
}

/** The agent waits on a question, then works again: Claude Code's list and its hooks. */
let asked = 0;
function waits(): string {
  asked++;
  const tool = `Tool${asked}`;
  symbiote.session(B, { state: 'blocked', waitingFor: 'permission prompt' });
  symbiote.hook(B, { hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: {} });
  return 'Respond|Waiting:';
}
function resumes(): void {
  symbiote.session(B, { state: 'done' });
  symbiote.hook(B, { hook_event_name: 'Stop', last_assistant_message: `Done ${asked}.` });
}

/** When `text` shows in the row (page clock), or null after `timeout`; `absent` for gone. */
function shownAt(page: Page, text: string, timeout: number, absent = false) {
  return page.evaluate(
    ({ selector, text, timeout, absent }) =>
      new Promise<number | null>((resolve) => {
        const ok = () => absent !== new RegExp(text).test(document.querySelector(selector)?.textContent ?? '');
        if (ok()) return resolve(Date.now());
        const observer = new MutationObserver(() => {
          if (!ok()) return;
          observer.disconnect();
          clearTimeout(timer);
          resolve(Date.now());
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        const timer = setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, timeout);
      }),
    { selector: row, text, timeout, absent },
  );
}
const arrivals = (page: Page) =>
  page.evaluate(() => (window as unknown as { __arrivals: { t: number; src: string; text: string }[] }).__arrivals);
const stats = async () =>
  MODE === 'off' ? null : ((await (await fetch(`${symbiote.url}api/events/stats`)).json()) as Record<string, number>);

test.afterEach(() => symbiote?.stop());

test('a burst of 120 hook events in about a second: the last state shows, and how many pushes', async ({ page }) => {
  await start(page);
  const settings = JSON.parse(readFileSync(join(symbiote.repo, 'symbiote', 'claude-settings.json'), 'utf8')) as {
    hooks: Record<string, { hooks: { command: string }[] }[]>;
  };
  const command = settings.hooks.Stop?.[0]?.hooks[0]?.command ?? '';
  const before = await stats();
  const t0 = Date.now();
  const runs: Promise<void>[] = [];
  for (let i = 0; i < 120; i++) {
    const event =
      i % 2 === 0
        ? { hook_event_name: 'PermissionRequest', tool_name: `T${i}`, tool_input: {} }
        : { hook_event_name: 'Stop', last_assistant_message: `Burst ${i}.` };
    runs.push(
      new Promise<void>((resolve) => {
        const child = spawn('sh', ['-c', command], { cwd: symbiote.folder(B), env: { ...process.env, SYMBIOTE_CACHE_DIR: symbiote.cache }, stdio: ['pipe', 'ignore', 'ignore'] });
        child.on('exit', () => resolve());
        child.stdin.end(JSON.stringify({ ...event, session_id: 'burst', cwd: symbiote.folder(B) }));
      }),
    );
    if (i % 20 === 19) await sleep(150);
  }
  // The last word: it waits on a question.
  const watching = shownAt(page, 'Respond|Waiting:', 30_000);
  symbiote.session(B, { state: 'blocked', waitingFor: 'question' });
  await Promise.all(runs);
  const tHooks = Date.now();
  symbiote.hook(B, { hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Waiting' });
  const shown = await watching;
  await sleep(4_000);
  const after = await stats();
  const pageTail = (await arrivals(page)).filter((a) => a.t >= t0);
  const fresh = await (await fetch(`${symbiote.url}api/workspaces`)).json();
  const last = [...pageTail].reverse().find((a) => a.text.includes(B));
  const lastWorkspaces = last
    ? last.src === 'fetch'
      ? (JSON.parse(last.text) as unknown)
      : ((JSON.parse(last.text) as { parts: { workspaces?: unknown } }).parts.workspaces ?? null)
    : null;
  const pick = (list: unknown) =>
    JSON.stringify((list as { workspaces: { branch: string; agent: unknown }[] } | null)?.workspaces.find((w) => w.branch === B)?.agent ?? null);
  save({
    test: 'burst',
    hooksMs: tHooks - t0,
    shownAfterLastMs: shown === null ? null : shown - tHooks,
    arrivals: pageTail.length,
    pageAgentEqualsFresh: pick(lastWorkspaces) === pick(fresh),
    ...(after && before
      ? { triggers: after.triggers - before.triggers, runs: after.runs - before.runs, pushes: after.sent - before.sent }
      : {}),
  });
});

test('the stream cut by the server: it reconnects, a change made meanwhile shows', async ({ page }) => {
  test.skip(MODE === 'off', 'push only');
  await start(page);
  for (let trial = 0; trial < 5; trial++) {
    const t0 = Date.now();
    await fetch(`${symbiote.url}api/events/drop`, { method: 'POST' });
    const watching = shownAt(page, 'Respond|Waiting:', 15_000);
    waits();
    const shown = await watching;
    const states = (await arrivals(page)).filter((a) => a.t >= t0 && a.src === 'sse:state').length;
    save({ test: 'dropped stream', trial, shownMs: shown === null ? null : shown - t0, wholeStateAgain: states });
    resumes();
    await shownAt(page, 'Respond|Waiting', 15_000, true);
  }
});

test('the server stopped (SIGSTOP) 20 s: a change made meanwhile shows after', async ({ page }) => {
  await start(page);
  const pid = serverPid();
  process.kill(pid, 'SIGSTOP');
  await sleep(2_000);
  const watching = shownAt(page, 'Respond|Waiting:', 60_000);
  waits();
  await sleep(18_000);
  const resumed = Date.now();
  process.kill(pid, 'SIGCONT');
  const shown = await watching;
  save({ test: 'server stopped 20 s', shownAfterResumeMs: shown === null ? null : shown - resumed });
});

test('the server restarted on the same port: the page follows, with the whole state', async ({ page }) => {
  await start(page);
  const pid = serverPid();
  const port = new URL(symbiote.url).port;
  const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  const env = Object.fromEntries(
    readFileSync(`/proc/${pid}/environ`, 'utf8')
      .split('\0')
      .filter(Boolean)
      .map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]),
  );
  const cwd = readlinkSync(`/proc/${pid}/cwd`);
  const t0 = Date.now();
  process.kill(pid, 'SIGINT');
  while (existsSync(`/proc/${pid}`)) await sleep(50);
  await sleep(3_000);
  const child: ChildProcess = spawn(argv[0] as string, [...argv.slice(1), '--port', port], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve) => child.stdout?.on('data', (d: Buffer) => d.toString().includes('Symbiote viewer:') && resolve()));
  const up = Date.now();
  const watching = shownAt(page, 'Respond|Waiting:', 20_000);
  waits();
  const shown = await watching;
  const after = (await arrivals(page)).filter((a) => a.t >= t0);
  save({
    test: 'restart, same port',
    downMs: up - t0,
    changeShownMs: shown === null ? null : shown - up,
    wholeStateAgain: after.filter((a) => a.src === 'sse:state').length,
    failingShown: await page.locator('text=/did not answer|not answering|since/i').count(),
  });
  child.kill('SIGINT');
});

test('the page frozen 20 s (as Chrome freezes a background tab): a change shows when it thaws', async ({ page }) => {
  await start(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await sleep(1_000);
  waits();
  await sleep(19_000);
  const thawed = Date.now();
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  const shown = await shownAt(page, 'Respond|Waiting:', 20_000);
  save({ test: 'page frozen 20 s', shownAfterThawMs: shown === null ? null : shown - thawed });
});

/** A display of the spike's own: Xvfb from :160 (other workspaces' specs use :99 and up). */
async function startXvfb(): Promise<{ name: string; stop(): void }> {
  for (let n = 160; n < 200; n++) {
    if (existsSync(`/tmp/.X${n}-lock`)) continue;
    const server = spawn('Xvfb', [`:${n}`, '-displayfd', '3', '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    });
    const ready = await new Promise<boolean>((resolve) => {
      (server.stdio[3] as Readable).once('data', () => resolve(true));
      server.once('exit', () => resolve(false));
    });
    if (ready) return { name: `:${n}`, stop: () => server.kill() };
  }
  throw new Error('no display');
}

test('a minimized browser window (the page hidden): when a change arrives, and when it shows', async ({ page }) => {
  await start(page);
  const display = await startXvfb();
  const browser = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY: display.name, WAYLAND_DISPLAY: '' } });
  try {
    const other = await browser.newPage();
    await other.addInitScript(RECORDER);
    await other.goto(symbiote.url);
    await other.waitForSelector(row);
    const cdp = await other.context().newCDPSession(other);
    const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as { windowId: number };
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    await sleep(1_500);
    const visibility = await other.evaluate(() => document.visibilityState);
    const t0 = Date.now();
    waits();
    await sleep(15_000);
    const got = (await arrivals(other)).find((a) => a.t >= t0 && a.text.includes('permission prompt'));
    const restored = Date.now();
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    const shown = await shownAt(other, 'Respond|Waiting:', 15_000);
    save({
      test: 'minimized browser',
      visibility,
      arrivedWhileHiddenMs: got ? got.t - t0 : null,
      shownAfterRestoreMs: shown === null ? null : shown - restored,
    });
  } finally {
    await browser.close();
    display.stop();
  }
});

test("the app's window minimized: when a change arrives", async ({ page }) => {
  await start(page);
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize());
    await sleep(1_500);
    const visibility = await win.evaluate(() => document.visibilityState);
    const t0 = Date.now();
    waits();
    await sleep(15_000);
    const got = (await arrivals(win)).find((a) => a.t >= t0 && a.text.includes('permission prompt'));
    save({ test: 'app window minimized', visibility, arrivedWhileMinimizedMs: got ? got.t - t0 : null });
  } finally {
    await app.close();
    display.stop();
  }
});

test('three frames of one view, two hidden (as the nexus hides its tabs): requests per minute each', async ({ page }) => {
  await start(page);
  // An agent works: the shell reads while one does.
  symbiote.session(B, { state: 'working' });
  const host: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<!doctype html><body>${[0, 1, 2]
        .map((i) => `<iframe name="f${i}" src="${symbiote.url}" ${i > 0 ? 'hidden' : ''} style="width:1200px;height:800px"></iframe>`)
        .join('')}</body>`,
    );
  });
  await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', () => resolve()));
  const nexus = await page.context().newPage();
  const counts: Record<string, number> = {};
  let counting = false;
  nexus.on('requestfinished', (request) => {
    if (!counting) return;
    const frame = request.frame().name() || 'top';
    counts[frame] = (counts[frame] ?? 0) + 1;
  });
  await nexus.goto(`http://127.0.0.1:${(host.address() as AddressInfo).port}/`);
  await sleep(8_000);
  const visibility = await Promise.all(nexus.frames().map(async (f) => `${f.name() || 'top'}:${await f.evaluate(() => document.visibilityState).catch(() => '?')}`));
  counting = true;
  await sleep(60_000);
  counting = false;
  save({ test: 'hidden frames', visibility, requestsPerMinByFrame: counts, streams: (await stats())?.clients ?? 0 });
  host.close();
});
