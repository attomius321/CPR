import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// V94 (decisions 897–907): the page learns of every change through one server-sent stream,
// `/api/events`, one per browser: the tab holding a Web Lock opens it and relays it to the others
// over a BroadcastChannel; terminals' output rides it too.
let symbiote: RunningWorkspaces;
let clients: ChildProcess[] = [];
const errors: string[] = [];

test.afterEach(() => {
  for (const client of clients) client.kill();
  clients = [];
  symbiote?.stop();
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
  symbiote = await serveWorkspaces();
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
