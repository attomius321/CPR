import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  serveAgentBranch,
  serveWorkspaces,
  type RunningAgent,
  type RunningWorkspaces,
} from './symbiote.js';

// V94 (decisions 897–907): the page learns of every change through one server-sent stream,
// `/api/events`, one per browser: the tab holding a Web Lock opens it and relays it to the others
// over a BroadcastChannel; terminals' output rides it too.
// The stream itself: nothing to test where `symbiote view` runs without it (the suite's run under
// polling, `SYMBIOTE_EVENTS=off`).
test.skip(process.env.SYMBIOTE_EVENTS === 'off', 'symbiote view runs without its stream');

let running: RunningWorkspaces | undefined;
let agentBranch: RunningAgent | undefined;
let clients: ChildProcess[] = [];
const errors: string[] = [];

test.afterEach(() => {
  for (const client of clients) client.kill();
  clients = [];
  running?.stop();
  agentBranch?.stop();
  running = undefined;
  agentBranch = undefined;
  expect(errors).toEqual([]);
});

const CLI = join(import.meta.dirname, '../../cli/dist/bin.js');
const BRANCH = 'feature/cart';
const POLL = { timeout: 15_000 };

/** Every page of the context: its errors kept, its requests for `/api/events` counted. */
function watched(context: BrowserContext) {
  const streams: string[] = [];
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  context.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/events') streams.push(request.url());
  });
  return streams;
}

const start = (page: Page, branch: string, title: string) =>
  page.evaluate(
    async ({ branch, title }) => {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
        body: JSON.stringify({
          kind: 'feature',
          title,
          parts: { goal: `${title}.` },
          branch,
          planFirst: false,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
    },
    { branch, title },
  );

const terminal = (page: Page) =>
  page
    .getByRole('region', { name: `Workspace ${BRANCH}` })
    .locator('.agent-terminal')
    .first();
const asks = (page: Page) => page.getByRole('region', { name: /asks$/ });

/** An agent of the person's, through `symbiote mcp`: it asks to start a workspace. */
function agent(cwd: string, cache: string) {
  const child = spawn(process.execPath, [CLI, 'mcp'], {
    cwd,
    env: { ...process.env, SYMBIOTE_CACHE_DIR: cache },
  });
  clients.push(child);
  let id = 0;
  const send = (method: string, params: unknown) =>
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })}\n`);
  send('initialize', { clientInfo: { name: 'e2e-agent', version: '1' } });
  return {
    startWorkspace: (branch: string) =>
      send('tools/call', {
        name: 'start_workspace',
        arguments: {
          kind: 'fix',
          title: 'The discount',
          branch,
          parts: { happens: 'It subtracts' },
          planFirst: false,
        },
      }),
  };
}

test('8 tabs share one stream; the holder closing hands it on; their terminals still work (V94b)', async ({
  context,
}) => {
  test.setTimeout(120_000);
  const streams = watched(context);
  const symbiote = await serveWorkspaces();
  running = symbiote;
  const pages: Page[] = [];
  for (let i = 0; i < 8; i++) pages.push(await context.newPage());
  await pages[0]!.goto(`${symbiote.url}git`);
  await start(pages[0]!, BRANCH, 'Save a cart');
  // The workspace's terminal in 4 tabs, Symbiote's most at once (V21: 140 MB each); the Overview
  // and Git in the other 4.
  for (const [i, page] of pages.entries()) {
    if (i < 4) {
      await page.goto(`${symbiote.url}?branch=${encodeURIComponent(BRANCH)}`);
      await expect(terminal(page).locator('.xterm-rows')).toContainText('Fake Claude Code', POLL);
    } else await page.goto(`${symbiote.url}${i % 2 ? 'overview' : 'git'}`);
  }
  // One stream for the 8 tabs and the 4 terminals (the first tab's Git page had its own, gone
  // with the page): every read still answers at once. One stream per tab stalled the 6th tab.
  await expect.poll(() => streams.length).toBe(2);
  for (const page of pages) {
    const asked = Date.now();
    expect(await page.evaluate(async () => (await fetch('/api/workspaces')).status)).toBe(200);
    expect(Date.now() - asked).toBeLessThan(2_000);
  }

  // An ask, held in memory, shows in all 8.
  const folder = symbiote.repo.split('/').at(-1) ?? '';
  agent(symbiote.repo, symbiote.cache).startWorkspace('fix/discount');
  for (const page of pages) {
    await expect(asks(page)).toHaveAccessibleName(`e2e-agent in ${folder} asks`, POLL);
  }

  // The tab that holds the stream closes: another takes the lock and opens a stream.
  await pages[0]!.close();
  const rest = pages.slice(1);
  await expect.poll(() => streams.length, POLL).toBe(3);
  // A Confirm in the last tab: the ask goes in the 7 others, through the new stream.
  await asks(rest[6]!).getByRole('button', { name: 'Confirm' }).click();
  for (const page of rest) await expect(asks(page)).toHaveCount(0, POLL);
  // Each terminal listens again on the new stream: typed into, it answers.
  for (const [i, page] of rest.slice(0, 3).entries()) {
    await terminal(page).click();
    await page.keyboard.type(`tab${i}`);
    await page.keyboard.press('Enter');
    await expect(terminal(page).locator('.xterm-rows')).toContainText(`got: tab${i}`, POLL);
  }
  expect(streams).toHaveLength(3);
});

/**
 * When the page first shows `text` in `selector` (its text, or `attribute`), by its own clock;
 * -1 after 10 s. Started before the change, so a change shown at once is not missed.
 */
function shownAt(page: Page, selector: string, text: string, attribute?: string) {
  return page.evaluate(
    ({ selector, text, attribute }) =>
      new Promise<number>((resolve) => {
        const now = () => {
          const element = document.querySelector(selector);
          const value = attribute ? element?.getAttribute(attribute) : element?.textContent;
          return value?.includes(text) === true;
        };
        if (now()) return resolve(Date.now());
        const observer = new MutationObserver(() => {
          if (!now()) return;
          observer.disconnect();
          resolve(Date.now());
        });
        observer.observe(document, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(-1);
        }, 10_000);
      }),
    { selector, text, ...(attribute ? { attribute } : {}) },
  );
}

/** Each delay measured, for the journal: JSON lines in `V94_RESULTS` when set. */
function record(result: Record<string, unknown>): void {
  const file = process.env.V94_RESULTS;
  if (file) appendFileSync(file, `${JSON.stringify(result)}\n`);
}

const row = (branch: string) => `.sidenav .workspace-row[data-branch="${branch}"]`;

test('every change kind shows in under 500 ms, with an agent working and with none (V94c)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  page.on('pageerror', (error) => errors.push(error.message));
  const symbiote = await serveWorkspaces();
  running = symbiote;
  const changed = 'feature/add-a-half-function';
  const other = 'feature/pick-a-store';
  await page.goto(`${symbiote.url}git`);
  await start(page, changed, 'Add a half function');
  await start(page, other, 'Pick a store');
  await page.goto(`${symbiote.url}overview`);
  await expect(page.locator(row(changed))).toBeVisible(POLL);
  const folder = symbiote.repo.split('/').at(-1) ?? '';
  let commits = 0;
  const timed = async (
    kind: string,
    working: boolean,
    show: Promise<number>,
    change: () => void,
  ) => {
    await page.waitForTimeout(1_200);
    const at = Date.now();
    change();
    const seen = await show;
    const ms = seen < 0 ? -1 : seen - at;
    record({ kind, working, ms });
    expect(seen, `${kind}, an agent ${working ? 'working' : 'not working'}`).toBeGreaterThan(0);
    expect(ms, `${kind}, an agent ${working ? 'working' : 'not working'}`).toBeLessThan(500);
  };

  for (const working of [true, false]) {
    // The other agent works, or none does.
    symbiote.session(other, { state: working ? 'working' : 'done' });
    symbiote.session(changed, { state: 'done' });
    await expect(page.locator(row(other))).toContainText(working ? 'Thinking' : 'Finished', POLL);

    // An agent's state: it asks for a permission.
    await timed('an agent asks', working, shownAt(page, row(changed), 'Permission to run'), () => {
      symbiote.hook(changed, {
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: `pnpm test ${working ? 1 : 2}` },
      });
      symbiote.session(changed, { state: 'blocked', waitingFor: 'permission prompt' });
    });
    symbiote.session(changed, { state: 'done' });

    // Its commit, with its tool's hook.
    commits += 1;
    await timed(
      'its commit',
      working,
      shownAt(page, row(changed), `${commits} commit`, 'data-tip'),
      () => {
        symbiote.commit(changed, `src/a${commits}.ts`, `export const a = ${commits};\n`, 'Agent');
        symbiote.hook(changed, {
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'git commit -m Agent' },
          tool_use_id: `commit-${commits}`,
        });
      },
    );

    // The person's commit, in a terminal: no hook, git's ref alone.
    commits += 1;
    await timed(
      "the person's commit",
      working,
      shownAt(page, row(changed), `${commits} commits`, 'data-tip'),
      () => {
        writeFileSync(join(symbiote.folder(changed), `p${commits}.md`), 'x\n');
        execFileSync('git', ['add', '.'], { cwd: symbiote.folder(changed) });
        execFileSync('git', ['commit', '-q', '-m', 'Mine'], {
          cwd: symbiote.folder(changed),
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'P',
            GIT_AUTHOR_EMAIL: 'p@example.com',
            GIT_COMMITTER_NAME: 'P',
            GIT_COMMITTER_EMAIL: 'p@example.com',
          },
        });
      },
    );

    // A review written by another process: changes requested at its tip.
    const tip = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: symbiote.folder(changed),
      encoding: 'utf8',
    }).trim();
    await timed(
      'a review from another process',
      working,
      shownAt(page, row(changed), 'Changes requested'),
      () => {
        const dir = join(symbiote.repo, 'symbiote', 'reviews', 'feature', 'add-a-half-function');
        mkdirSync(dir, { recursive: true });
        const review = {
          base: symbiote.shas[0],
          branch: changed,
          drafts: [],
          head: tip,
          marks: {},
          reviewer: 'reviewer@example.com',
          summary: '',
          updated: new Date().toISOString(),
          verdicts: [
            {
              at: new Date().toISOString(),
              comments: [],
              event: 'request-changes',
              head: tip,
              summary: `Not yet ${working ? 1 : 2}`,
            },
          ],
        };
        // Written whole by its rename, as another `symbiote view` writes it.
        writeFileSync(join(dir, '.next.tmp'), JSON.stringify(review));
        renameSync(join(dir, '.next.tmp'), join(dir, 'reviewer@example.com.json'));
      },
    );

    // An ask, from an agent through `symbiote mcp`.
    const asker = agent(symbiote.repo, symbiote.cache);
    await page.waitForTimeout(500);
    await timed('an ask', working, shownAt(page, '[aria-label$=" asks"]', 'asks'), () =>
      asker.startWorkspace(`fix/ask-${working ? 1 : 2}`),
    );
    await asks(page).getByRole('button', { name: 'Decline' }).click();
    await expect(asks(page)).toHaveCount(0, POLL);
    void folder;
  }
});

/** The server's log lines (LG1) in its cache: each with its time. */
function logLines(cache: string): { time: string; msg: string; state?: string }[] {
  const dir = join(cache, 'logs');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => readFileSync(join(dir, name), 'utf8').split('\n'))
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as { time: string; msg: string; state?: string });
}

test("a merge's steps show in under 500 ms of the server's own line for each (V94c)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  page.on('pageerror', (error) => errors.push(error.message));
  const branch = await serveAgentBranch();
  agentBranch = branch;
  // Each text the merge's card shows, with when, by the page's clock.
  await page.addInitScript(() => {
    const seen: { at: number; text: string }[] = [];
    (window as unknown as { __merge: typeof seen }).__merge = seen;
    new MutationObserver(() => {
      const text = document.querySelector('.sidenav [data-merge="agent"]')?.textContent ?? '';
      if (text && text !== seen.at(-1)?.text) seen.push({ at: Date.now(), text });
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  mkdirSync(join(branch.repo, 'symbiote'), { recursive: true });
  writeFileSync(
    join(branch.repo, 'symbiote', 'config.json'),
    JSON.stringify({ merge: { checks: ['sleep 1'] } }),
  );
  await page.goto(`${branch.url}git`);
  await page
    .getByRole('complementary', { name: 'Branches' })
    .locator('.branches-branch', { has: page.locator('.branches-name', { hasText: /^agent$/ }) })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Review', exact: true }).click();
  await expect(page.locator('.files-side .review-tab')).toBeVisible(POLL);
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText('Approved', POLL);
  await page.getByRole('button', { name: 'Merge into', exact: true }).click();
  const card = page.locator('.sidenav [data-merge="agent"]');
  await expect(card).toContainText('Landed', POLL);
  const shown = await page.evaluate(
    () => (window as unknown as { __merge: { at: number; text: string }[] }).__merge,
  );
  // The card can say Landed before the server's line for it is on disk (fix-ci-green).
  await expect
    .poll(
      () => logLines(branch.cache).filter((l) => /^merge (checking|landed)$/.test(l.msg)).length,
    )
    .toBe(2);
  const lines = logLines(branch.cache);
  for (const [state, words] of [
    ['checking', 'Checking'],
    ['landed', 'Landed'],
  ] as const) {
    const line = lines.find((l) => l.msg === `merge ${state}`);
    const seen = shown.find((s) => s.text.includes(words));
    expect(line, `the server's line for ${state}`).toBeDefined();
    expect(seen, `the card saying ${words}: ${JSON.stringify(shown)}`).toBeDefined();
    const ms = (seen?.at ?? 0) - Date.parse(line?.time ?? '');
    record({ kind: `a merge's step: ${state}`, ms });
    expect(ms, state).toBeLessThan(500);
  }
});

test('the server stopped, then restarted on its port: what changed meanwhile shows, the whole state again (V94c)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  page.on('pageerror', (error) => errors.push(error.message));
  const symbiote = await serveWorkspaces();
  running = symbiote;
  const branch = 'feature/add-a-half-function';
  await page.goto(`${symbiote.url}git`);
  await start(page, branch, 'Add a half function');
  await page.goto(`${symbiote.url}overview`);
  await expect(page.locator(row(branch))).toContainText('Thinking', POLL);

  // Stopped 3 s (SIGSTOP): its agent asks meanwhile; shown once it goes on.
  symbiote.pause();
  symbiote.hook(branch, {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'pnpm test' },
  });
  symbiote.session(branch, { state: 'blocked', waitingFor: 'permission prompt' });
  await page.waitForTimeout(3_000);
  const asked = shownAt(page, row(branch), 'Permission to run');
  const resumed = Date.now();
  symbiote.resume();
  const seen = await asked;
  record({ kind: 'the server stopped 3 s: a change meanwhile', ms: seen - resumed });
  expect(seen).toBeGreaterThan(0);
  expect(seen - resumed).toBeLessThan(1_500);

  // Down 2 s, back on its port: the page says it is not updated, then reads the whole state again.
  const stale = page.locator('.sidenav .workspaces-stale');
  const restarting = symbiote.restart({ samePort: true, downMs: 2_000 });
  await expect(stale).toContainText(/^Not updated since .+: Symbiote does not answer/, POLL);
  // What changed while it was down: the agent committed and finished.
  symbiote.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  symbiote.session(branch, { state: 'done' });
  const back = shownAt(page, row(branch), '1 commit', 'data-tip');
  await restarting;
  const up = Date.now();
  const shownBack = await back;
  record({ kind: 'a restart on its port: a change while down', ms: shownBack - up });
  expect(shownBack).toBeGreaterThan(0);
  expect(shownBack - up).toBeLessThan(3_000);
  await expect(stale).toHaveCount(0, POLL);
  await expect(page.locator(row(branch))).toContainText('Ready for review', POLL);
});
