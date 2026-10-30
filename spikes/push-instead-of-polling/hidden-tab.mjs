// A tab really hidden (no Playwright, which keeps its pages visible): Chromium headed on an Xvfb
// display, two tabs over raw CDP, the first behind the second. The first shows `url`; the
// script counts what reaches it while hidden. `trigger` is a shell command that makes the change.
//   node hidden-tab.mjs <chrome> <display> <url> <seconds-hidden> '<trigger command>'
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [chrome, display, url, seconds = '30', trigger = 'true'] = process.argv.slice(2);
const profile = mkdtempSync(join(process.env.SPIKE_TMP ?? tmpdir(), 'hidden-tab-'));
const port = 9300 + Math.floor(Math.random() * 500);
const browser = spawn(
  chrome,
  [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', url],
  { env: { ...process.env, DISPLAY: display, WAYLAND_DISPLAY: '' }, stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets = [];
for (let i = 0; i < 100 && !targets.some((t) => t.type === 'page' && t.url.startsWith(url)); i++) {
  await sleep(200);
  targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => []);
}
const page = targets.find((t) => t.type === 'page' && t.url.startsWith(url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const waiting = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  waiting.get(m.id)?.(m.result);
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    waiting.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
// Record what arrives from now on: reads of the workspaces, stream events (a new page load records from its start).
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__arrivals=[];const f=window.fetch;window.fetch=async function(i,o){const r=await f.call(this,i,o);const u=typeof i==='string'?i:i.url;if(/\\/api\\/workspaces(\\?|$)/.test(u))r.clone().text().then(t=>__arrivals.push({t:Date.now(),text:t}));return r};const S=window.EventSource;window.EventSource=class extends S{constructor(u,o){super(u,o);for(const n of['state','change'])this.addEventListener(n,e=>__arrivals.push({t:Date.now(),text:e.data}))}};`,
});
await send('Page.reload');
await sleep(4_000);
// A second tab in front.
await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
await sleep(2_000);
const visibility = await evaluate('document.visibilityState');
const t0 = Date.now();
execSync(trigger, { stdio: 'inherit' });
await sleep(Number(seconds) * 1000);
const arrivals = await evaluate(`__arrivals.filter(a => a.t >= ${t0}).map(a => ({ t: a.t, waits: /permission/.test(a.text) }))`);
const first = arrivals.find((a) => a.waits);
console.log(`RESULT ${JSON.stringify({ visibility, hiddenSeconds: Number(seconds), arrivalsWhileHidden: arrivals.length, firstWithTheChangeAt: first ? first.t : null })}`);
ws.close();
browser.kill();
await sleep(500);
rmSync(profile, { recursive: true, force: true });
process.exit(0);
