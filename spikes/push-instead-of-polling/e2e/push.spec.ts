// SPIKE (push instead of polling): what polling costs and how soon a change shows, against the
// push prototype (`../push.patch`). Copied into a patched copy's `packages/viewer/e2e/` and run
// there; `SPIKE_PUSH=off` is polling as main, `both`/`ping`/`watch` push. Results: JSON lines in
// `SPIKE_RESULTS`. Fake agents only (the e2e harness's).
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, type BrowserContext, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

const MODE = process.env.SPIKE_PUSH ?? 'both';
const RESULTS = process.env.SPIKE_RESULTS ?? '/tmp/push-results.jsonl';
const PHASE_MS = Number(process.env.SPIKE_PHASE_MS ?? 60_000);
const TRIALS = Number(process.env.SPIKE_TRIALS ?? 8);
const save = (o: Record<string, unknown>) =>
  appendFileSync(RESULTS, `${JSON.stringify({ mode: MODE, ping: process.env.SPIKE_PING, ...o })}\n`);

test.describe.configure({ mode: 'serial' });
test.setTimeout(30 * 60_000);

let symbiote: RunningWorkspaces;
test.afterEach(() => symbiote?.stop());

/** In every page: data arrivals (fetches of the shell's reads, the stream's events) and React's commits. */
const RECORDER = () => {
  const w = window as unknown as Record<string, unknown>;
  const arrivals: { t: number; src: string; url: string; text: string }[] = [];
  w.__arrivals = arrivals;
  const original = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const res = await original.call(this, input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/\/api\/(workspaces|reviews|merges|nucleus|scribe|mcp\/asks)(\?|$)/.test(url)) {
      void res
        .clone()
        .text()
        .then((text) => arrivals.push({ t: Date.now(), src: 'fetch', url, text }));
    }
    return res;
  };
  const Source = window.EventSource;
  window.EventSource = class extends Source {
    constructor(url: string | URL, options?: EventSourceInit) {
      super(url, options);
      for (const name of ['state', 'change']) {
        this.addEventListener(name, (e) =>
          arrivals.push({ t: Date.now(), src: `sse:${name}`, url: String(url), text: (e as MessageEvent<string>).data }),
        );
      }
    }
  };
  // React's commits and the components that rendered in each (React DevTools' hook, which the
  // production build calls too): a component counts when its fiber is new to this commit and ran.
  let commits = 0;
  let rendered = 0;
  const before = new WeakMap<object, Set<object>>();
  w.__react = () => ({ commits, rendered });
  type Fiber = { tag: number; flags: number; child: Fiber | null; sibling: Fiber | null };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false,
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    onCommitFiberRoot(_id: number, root: { current: Fiber }) {
      commits++;
      const last = before.get(root) ?? new Set();
      const now = new Set<object>();
      const stack: Fiber[] = [root.current];
      while (stack.length > 0) {
        const f = stack.pop() as Fiber;
        now.add(f);
        if ([0, 1, 11, 15].includes(f.tag) && !last.has(f) && (f.flags & 1) === 1) rendered++;
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
      before.set(root, now);
    },
  };
};

/** Requests the page made, by path, with their bytes (both ways, headers included). */
function countRequests(page: Page) {
  const done: { t: number; path: string; bytes: number }[] = [];
  page.on('requestfinished', (request) => {
    void request
      .sizes()
      .then((s) => {
        done.push({
          t: Date.now(),
          path: new URL(request.url()).pathname,
          bytes: s.requestHeadersSize + s.requestBodySize + s.responseHeadersSize + s.responseBodySize,
        });
      })
      .catch(() => {});
  });
  return done;
}

/** The server's process: its CPU (own, and its reaped children's: git, the fake Claude Code), ms. */
function serverCpu(): { own: number; children: number } {
  const running = join(symbiote.cache, 'running');
  const [file = ''] = readdirSync(running).filter((f) => f.endsWith('.json'));
  const pid = (JSON.parse(readFileSync(join(running, file), 'utf8')) as { pid: number }).pid;
  const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '').split(' ');
  const n = (i: number) => Number(fields[i]) * 10;
  return { own: n(11) + n(12), children: n(13) + n(14) };
}

/** The stream's counts, asked from here (not a page: its requests are what is counted). */
async function streamStats(): Promise<{ bytes: number; sent: number; clients: number; reads: Record<string, number> }> {
  if (MODE === 'off') return { bytes: 0, sent: 0, clients: 0, reads: {} };
  return (await fetch(`${symbiote.url}api/events/stats`)).json() as never;
}

async function post(page: Page, path: string, body: unknown): Promise<number> {
  return page.evaluate(
    async ({ path, body }) =>
      (
        await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
          body: JSON.stringify(body),
        })
      ).status,
    { path, body },
  );
}

async function startWorkspaces(page: Page, branches: string[]): Promise<void> {
  for (const branch of branches) {
    const status = await post(page, '/api/workspaces', {
      brief: `Work on ${branch}.`,
      branch,
      planFirst: false,
    });
    if (status !== 200) throw new Error(`start ${branch}: ${status}`);
  }
}

/**
 * When `selector`'s text first includes `text` (or the element appears, with no text), by the
 * page's clock; null after `timeout`. Watched from before the change: call, change, then await.
 */
function shownAt(page: Page, selector: string, text: string | null, timeout: number, absent = false) {
  return page.evaluate(
    ({ selector, text, timeout, absent }) =>
      new Promise<number | null>((resolve) => {
        const ok = () => {
          const el = document.querySelector(selector);
          return absent !== (!!el && (text === null || new RegExp(text).test(el.textContent ?? '')));
        };
        if (ok()) return resolve(Date.now());
        const observer = new MutationObserver(() => {
          if (!ok()) return;
          observer.disconnect();
          clearTimeout(timer);
          resolve(Date.now());
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
        const timer = setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, timeout);
      }),
    { selector, text, timeout, absent },
  );
}

/** When data holding `marker` first arrived after `from` (a fetch's body or a stream event). */
async function arrivedAt(page: Page, marker: string, from: number, timeout: number): Promise<number | null> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const t = await page.evaluate(
      ({ marker, from }) =>
        (
          (window as unknown as { __arrivals: { t: number; text: string }[] }).__arrivals.find(
            (a) => a.t >= from && a.text.includes(marker),
          ) ?? null
        )?.t ?? null,
      { marker, from },
    );
    if (t !== null) return t;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

const row = (branch: string) => `.workspace-row[data-branch="${branch}"]`;

async function openPage(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(RECORDER);
  await page.goto(url);
  return page;
}

test('cost: requests, bytes, renders and server CPU per minute, live and idle', async ({ context }) => {
  symbiote = await serveWorkspaces();
  const page = await openPage(context, symbiote.url);
  const branches = ['feature/one', 'feature/two', 'feature/three'];
  await startWorkspaces(page, branches);
  symbiote.session('feature/two', { state: 'done' });
  symbiote.session('feature/three', { state: 'done' });
  await page.goto(symbiote.url);
  const requests = countRequests(page);
  await page.waitForSelector(row('feature/three'));
  await page.waitForTimeout(10_000);
  for (const phase of ['live (one agent working)', 'idle (no agent working)']) {
    if (phase.startsWith('idle')) {
      symbiote.session('feature/one', { state: 'done' });
      await page.waitForTimeout(10_000);
    }
    const t0 = Date.now();
    const cpu0 = serverCpu();
    const react0 = await page.evaluate(() => (window as unknown as { __react: () => { commits: number; rendered: number } }).__react());
    const stream0 = await streamStats();
    await page.waitForTimeout(PHASE_MS);
    const cpu1 = serverCpu();
    const react1 = await page.evaluate(() => (window as unknown as { __react: () => { commits: number; rendered: number } }).__react());
    const stream1 = await streamStats();
    const minutes = (Date.now() - t0) / 60_000;
    const inPhase = requests.filter((r) => r.t >= t0 && !r.path.startsWith('/api/events/stats'));
    const byPath: Record<string, number> = {};
    for (const r of inPhase) byPath[r.path] = (byPath[r.path] ?? 0) + 1;
    const reads: Record<string, number> = {};
    for (const [part, n] of Object.entries(stream1.reads)) reads[part] = n - (stream0.reads[part] ?? 0);
    save({
      test: 'cost',
      phase,
      requestsPerMin: +(inPhase.length / minutes).toFixed(1),
      kbPerMin: +((inPhase.reduce((s, r) => s + r.bytes, 0) + stream1.bytes - stream0.bytes) / 1024 / minutes).toFixed(1),
      streamKbPerMin: +((stream1.bytes - stream0.bytes) / 1024 / minutes).toFixed(2),
      byPath,
      serverReads: reads,
      cpuOwnMsPerMin: Math.round((cpu1.own - cpu0.own) / minutes),
      cpuChildrenMsPerMin: Math.round((cpu1.children - cpu0.children) / minutes),
      commitsPerMin: +((react1.commits - react0.commits) / minutes).toFixed(1),
      renderedPerMin: Math.round((react1.rendered - react0.rendered) / minutes),
    });
  }
});

test('delay: how soon a change shows, an agent working and none', async ({ context }) => {
  symbiote = await serveWorkspaces();
  const page = await openPage(context, symbiote.url);
  const [busy, b] = ['feature/busy', 'feature/watched'];
  await startWorkspaces(page, [busy, b]);
  symbiote.session(b, { state: 'done' });
  await page.goto(symbiote.url);
  await page.waitForSelector(row(b));
  const reviewer = await page.evaluate(async () => ((await (await fetch('/api/reviews')).json()) as { reviewer: string }).reviewer);
  await page.waitForTimeout(5_000);
  const result = (kind: string, live: boolean, trial: number, t0: number, shown: number | null, arrived?: number | null) =>
    save({
      test: 'delay',
      kind,
      live,
      trial,
      shownMs: shown === null ? null : shown - t0,
      ...(arrived !== undefined ? { arrivedMs: arrived === null ? null : arrived - t0 } : {}),
    });
  let commits = 0;
  let reviews = 0;

  for (const live of [true, false]) {
    if (!live) {
      symbiote.session(busy, { state: 'done' });
      await page.waitForTimeout(12_000);
    }
    // Idle: half the trials (polling never shows most of them; each waits its 20 s).
    for (let trial = 0; trial < (live ? TRIALS : Math.ceil(TRIALS / 2)); trial++) {
      // Spread the trials over the polling period.
      await page.waitForTimeout(700 + ((trial * 1_300) % 5_000));

      // Each change at a random point of the polling period (not just after a read).
      const anyTime = () => page.waitForTimeout(500 + Math.random() * 5_000);
      await anyTime();
      // An agent's state: it waits on a permission (Claude Code's list, then its hook).
      let watching = shownAt(page, row(b), 'Respond|Waiting:', 20_000);
      let t0 = Date.now();
      symbiote.session(b, { state: 'blocked', waitingFor: 'permission prompt' });
      symbiote.hook(b, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } });
      result('agent state', live, trial, t0, await watching);
      symbiote.session(b, { state: 'done' });
      symbiote.hook(b, { hook_event_name: 'Stop', last_assistant_message: `Done ${trial}.` });
      await shownAt(page, row(b), 'Respond|Waiting', 20_000, true);
      await page.waitForTimeout(500);

      // A commit in its worktree: the agent's (Claude Code's PostToolUse hook follows), then
      // the person's own in a terminal (no hook).
      for (const kind of ['commit (agent)', 'commit (person)']) {
        await anyTime();
        commits++;
        const label = `${commits} commit${commits === 1 ? '' : 's'}`;
        watching = shownAt(page, `${row(b)} [aria-label="${label}"]`, null, 20_000);
        t0 = Date.now();
        symbiote.commit(b, `src/f${commits}.ts`, `export const f${commits} = ${commits};\n`, `Add f${commits}`);
        if (kind === 'commit (agent)') {
          symbiote.hook(b, {
            hook_event_name: 'PostToolUse',
            tool_name: 'Bash',
            tool_use_id: `c${commits}`,
            tool_input: { command: 'git commit -am "Add"' },
            tool_response: { stdout: '1 file changed', stderr: '' },
          });
        }
        result(kind, live, trial, t0, await watching);
        await page.waitForTimeout(500);
      }

      // A review written by another tab or process: its file in symbiote/reviews/.
      await anyTime();
      reviews++;
      const marker = `"updated":"2030-01-01T00:00:${String(reviews).padStart(2, '0')}.000Z"`;
      const file = join(symbiote.repo, 'symbiote', 'reviews', ...b.split('/'), `${reviewer.replace(/[^\w.@+-]/g, '_')}.json`);
      mkdirSync(dirname(file), { recursive: true });
      t0 = Date.now();
      writeFileSync(
        file,
        JSON.stringify({ base: symbiote.shas.at(-1), branch: b, drafts: [], head: symbiote.shas.at(-1), marks: {}, reviewer, summary: '', updated: marker.slice(11, -1), verdicts: [] }),
      );
      result('review', live, trial, t0, null, await arrivedAt(page, marker, t0, 20_000));
      await page.waitForTimeout(500);

      // An ask: an agent calls a tool of Symbiote's MCP that asks the person first.
      await anyTime();
      watching = shownAt(page, '.ask-bar', null, 20_000);
      t0 = Date.now();
      // As `symbiote mcp` calls it for an agent of the person's (its client named): a start asks.
      const call = fetch(`${symbiote.url}api/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-symbiote': '1', 'x-symbiote-client': 'spike-agent' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: trial + 1,
          method: 'tools/call',
          params: {
            name: 'start_workspace',
            arguments: { kind: 'fix', title: `Ask ${live} ${trial}`, branch: `fix/ask-${live}-${trial}`, parts: { happens: 'x' }, planFirst: true },
          },
        }),
      }).catch(() => null);
      const shown = await watching;
      result('ask', live, trial, t0, shown);
      const { asks } = await page.evaluate(async () => (await (await fetch('/api/mcp/asks')).json()) as { asks: { id: string }[] });
      for (const ask of asks) await post(page, '/api/mcp/answer', { id: ask.id, yes: false });
      await call;
      await page.waitForTimeout(500);
    }
  }
});

test('tabs: one view in many tabs of one browser, and a request from the last', async ({ context }) => {
  symbiote = await serveWorkspaces();
  const first = await openPage(context, symbiote.url);
  await startWorkspaces(first, ['feature/one']);
  const pages: Page[] = [first];
  for (let n = 2; n <= 8; n++) {
    const page = await openPage(context, symbiote.url);
    pages.push(page);
    await page.waitForSelector(row('feature/one'), { timeout: 10_000 }).catch(() => null);
    const t0 = Date.now();
    const status = await page
      .evaluate(async () => {
        const answer = await Promise.race([
          fetch('/api/status').then((r) => r.status),
          new Promise<string>((resolve) => setTimeout(() => resolve('stalled 8 s'), 8_000)),
        ]);
        return answer;
      })
      .catch((error: Error) => `failed: ${error.message.slice(0, 80)}`);
    const clients = (await streamStats()).clients;
    save({ test: 'tabs', tabs: n, status, ms: Date.now() - t0, streams: clients });
  }
});

test('tabs share: a change reaches every tab, and still does once the tab holding the stream closes', async ({ context }) => {
  symbiote = await serveWorkspaces();
  const first = await openPage(context, symbiote.url);
  const b = 'feature/one';
  await startWorkspaces(first, [b]);
  symbiote.session(b, { state: 'done' });
  const pages: Page[] = [first];
  for (let n = 2; n <= 8; n++) pages.push(await openPage(context, symbiote.url));
  for (const page of pages) await page.waitForSelector(row(b), { timeout: 15_000 });
  for (const round of ['all tabs', 'after the first tab closed']) {
    if (round !== 'all tabs') {
      await (pages.shift() as Page).close();
      await new Promise((r) => setTimeout(r, 1_500));
    }
    const watching = pages.map((page) => shownAt(page, row(b), 'Respond|Waiting:', 15_000));
    const t0 = Date.now();
    symbiote.session(b, { state: 'blocked', waitingFor: 'permission prompt' });
    symbiote.hook(b, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } });
    const shown = (await Promise.all(watching)).map((t) => (t === null ? null : t - t0));
    save({ test: 'tabs share', round, tabs: pages.length, shownMs: shown, streams: (await streamStats()).clients });
    symbiote.session(b, { state: 'done' });
    symbiote.hook(b, { hook_event_name: 'Stop', last_assistant_message: 'Done.' });
    await Promise.all(pages.map((page) => shownAt(page, row(b), 'Respond|Waiting', 15_000, true)));
  }
});
