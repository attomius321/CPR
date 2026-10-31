import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { serveAgentBranch, serveWorkspaces, type Running } from './symbiote.js';

// Symbiote's MCP (MC1): an agent's calls through the bridge, the asks on the pages, the person's
// answer. The client is this spec, speaking MCP on the bridge's stdin and stdout: no real agent.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const BRIDGE = join(root, 'packages/cli/dist/mcp-stdio.js');
const CLI = join(root, 'packages/cli/dist/bin.js');

let symbiote: (Running & { cache: string; repo: string }) | undefined;
let clients: ChildProcess[] = [];
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  for (const client of clients) client.kill();
  clients = [];
  symbiote?.stop();
  expect(errors).toEqual([]);
});

/** `symbiote view`'s record for the bridge, in its cache. */
const record = (cache: string) => {
  const [file = ''] = readdirSync(join(cache, 'views'));
  return join(cache, 'views', file);
};

interface Answer {
  isError: boolean;
  text: string;
  value: Record<string, unknown>;
}

/** An MCP client of a bridge: requests by ID, a tool's call as its text and JSON. */
function client(args: string[], cwd: string, env: Record<string, string> = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env } });
  clients.push(child);
  const waiting = new Map<number, (message: Record<string, unknown>) => void>();
  let buffer = '';
  let id = 0;
  child.stdout?.on('data', (data: Buffer) => {
    buffer += data.toString();
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const message = JSON.parse(buffer.slice(0, at)) as Record<string, unknown>;
      buffer = buffer.slice(at + 1);
      waiting.get(message.id as number)?.(message);
      waiting.delete(message.id as number);
    }
  });
  const request = (method: string, params: unknown = {}) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const n = ++id;
      waiting.set(n, resolve);
      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
    });
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Answer> => {
    const answer = await request('tools/call', { name, arguments: args });
    const result = answer.result as { content: { text: string }[]; isError?: boolean };
    const text = result.content[0]?.text ?? '';
    let value: Record<string, unknown> = {};
    try {
      value = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // A problem in words.
    }
    return { isError: result.isError === true, text, value };
  };
  return { request, call };
}

const ask = (page: Page) => page.getByRole('region', { name: /asks$/ });
const nucleusLink = (page: Page) =>
  page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: /Nucleus/ });
const POLL = { timeout: 15_000 };

test("Nucleus reviews a branch, approves it and queues its merge, each on the person's Confirm; a restarted view is found", async ({
  page,
}) => {
  const running = await serveAgentBranch();
  symbiote = running;
  const nucleus = client(
    [BRIDGE, '--as', 'nucleus', '--view', record(running.cache)],
    running.repo,
  );
  const init = await nucleus.request('initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'claude-code', version: '2' },
  });
  expect(init).toMatchObject({ result: { serverInfo: { name: 'symbiote' } } });
  const listed = await nucleus.request('tools/list');
  // 24 tools, and `activity` since V84.
  expect((listed.result as { tools: unknown[] }).tools).toHaveLength(25);

  // The branch's graph: its findings in the detector's words.
  const review = await nucleus.call('review', { branch: 'agent' });
  expect(review.isError).toBe(false);
  expect(review.text).toContain('square is new and nothing references it');
  const head = running.shas.at(-1) ?? '';

  // An approval waits for the person, on whatever page they are.
  await page.goto(`${running.url}history`);
  const approving = nucleus.call('finish_review', {
    branch: 'agent',
    event: 'approve',
    summary: 'Square and cube, as asked.',
  });
  await expect(ask(page)).toBeVisible(POLL);
  await expect(ask(page)).toHaveAccessibleName('Nucleus asks');
  await expect(ask(page).locator('.ask-words')).toHaveText(
    `Nucleus asks: Approve agent at ${head.slice(0, 7)}: it is to be merged into main`,
  );
  await expect(ask(page).locator('.ask-left')).toHaveText('10 min left');
  await expect(nucleusLink(page)).toHaveAttribute('data-tip', 'Nucleus\nWaits for you');
  await ask(page).getByRole('button', { name: 'Confirm' }).click();
  await expect(ask(page)).toHaveCount(0);
  const approved = await approving;
  expect(approved.isError).toBe(false);
  expect(approved.value).toMatchObject({ verdict: { event: 'approve', head, via: 'nucleus' } });
  const file = join(running.repo, 'symbiote', 'reviews', 'agent', 'reviewer@example.com.json');
  expect(
    (JSON.parse(readFileSync(file, 'utf8')) as { verdicts: unknown[] }).verdicts.at(-1),
  ).toMatchObject({ event: 'approve', via: 'nucleus' });
  await page.reload();
  const tip = page.locator('.commit', {
    has: page.locator('.commit-subject', { hasText: 'Agent: add cube' }),
  });
  await expect(tip.locator('.ref-review').first()).toHaveAttribute(
    'data-tip',
    'Approved through Nucleus',
  );

  // Its merge: declined, nothing is queued; confirmed, it is.
  const declined = nucleus.call('queue_merge', { branch: 'agent' });
  await expect(ask(page).locator('.ask-words')).toHaveText(
    `Nucleus asks: Merge agent at ${head.slice(0, 7)} into main`,
    POLL,
  );
  await ask(page).getByRole('button', { name: 'Decline' }).click();
  expect(await declined).toMatchObject({ isError: true });
  expect((await declined).text).toContain('The person declined');
  await expect(page.locator('.sidenav [data-merge="agent"]')).toHaveCount(0);
  const queued = nucleus.call('queue_merge', { branch: 'agent' });
  await ask(page).getByRole('button', { name: 'Confirm' }).click();
  expect((await queued).value).toMatchObject({ branch: 'agent', into: 'main' });
  await expect(page.locator('.sidenav [data-merge="agent"]')).toBeVisible(POLL);

  // symbiote view on another port: the bridge reads its record again.
  await running.restart();
  const after = await nucleus.call('overview');
  expect(after.isError).toBe(false);
  expect(after.value).toMatchObject({ checkout: { branch: 'main' } });
});

test("an agent of the person's starts a workspace through symbiote mcp, on their Confirm", async ({
  page,
}) => {
  const running = await serveWorkspaces();
  symbiote = running;
  const mine = client([CLI, 'mcp'], running.repo, { SYMBIOTE_CACHE_DIR: running.cache });
  await mine.request('initialize', { clientInfo: { name: 'e2e-agent', version: '1' } });
  await page.goto(`${running.url}nucleus`);
  const starting = mine.call('start_workspace', {
    kind: 'fix',
    title: 'The discount',
    branch: 'fix/discount',
    parts: { happens: 'It subtracts the percent as cents' },
    planFirst: true,
  });
  const folder = running.repo.split('/').at(-1) ?? '';
  await expect(ask(page)).toHaveAccessibleName(`e2e-agent in ${folder} asks`, POLL);
  await expect(ask(page).locator('.ask-words')).toHaveText(
    `e2e-agent in ${folder} asks: Start fix/discount, "The discount", with Claude Code, plan first`,
  );
  // Not Nucleus's: its mark stays.
  await expect(nucleusLink(page)).not.toHaveAttribute('data-tip', 'Nucleus\nWaits for you');
  await ask(page).getByRole('button', { name: 'Confirm' }).click();
  expect((await starting).value).toMatchObject({ workspace: { branch: 'fix/discount' } });
  await page.goto(`${running.url}?branch=fix%2Fdiscount&brief`);
  await expect(page.locator('.workspace-started')).toHaveText(
    'Started through symbiote mcp with Claude Code at its default effort.',
    POLL,
  );
});
