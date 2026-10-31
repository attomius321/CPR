import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Nucleus's Activity tab (NU2): what its session's hooks (the built gate and recorder, run as
// Claude Code runs them, by a fake Claude Code) and Symbiote's MCP record, drawn as a workspace's
// Activity tab draws its own; live, and again after `symbiote view` restarts.
let symbiote: RunningWorkspaces;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote.stop();
  expect(errors).toEqual([]);
});

const POLL = { timeout: 15_000 };
const nucleusPage = (page: Page) => page.getByRole('region', { name: 'Nucleus' });
const tab = (page: Page, name: string) => nucleusPage(page).getByRole('tab', { name });
const timeline = (page: Page) => nucleusPage(page).getByRole('list', { name: 'Activity' });
const group = (page: Page, kind: string) => timeline(page).locator(`.activity-group.kind-${kind}`);
const ask = (page: Page) => page.getByRole('region', { name: /asks$/ });
const activityFile = () => join(symbiote.repo, 'symbiote', 'nucleus-activity.jsonl');

let n = 0;
/** One tool call through Nucleus's hooks: the gate's PreToolUse, then its end unless refused. */
function toolCall(tool: string, input: Record<string, unknown>, response?: unknown) {
  const id = `toolu_${++n}`;
  const head = { tool_name: tool, tool_input: input, tool_use_id: id };
  symbiote.nucleusHook({ hook_event_name: 'PreToolUse', ...head });
  if (response !== undefined) {
    symbiote.nucleusHook({
      hook_event_name: 'PostToolUse',
      ...head,
      tool_response: response,
      duration_ms: 320,
    });
  }
}

/** A call of Symbiote's MCP, as Nucleus's bridge sends it. */
const mcp = (name: string, args: Record<string, unknown>) =>
  fetch(new URL('/api/mcp', symbiote.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-symbiote': '1',
      'x-symbiote-caller': 'nucleus',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++n,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

test('records a conversation and shows it on the Activity tab, live and after a restart', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}nucleus`);
  await expect(tab(page, 'Terminal')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => existsSync(activityFile()), POLL).toBe(true);

  symbiote.nucleusHook({ hook_event_name: 'UserPromptSubmit', prompt: 'What changed lately?' });
  toolCall(
    'Bash',
    { command: 'git log --oneline -3', description: 'Recent commits' },
    { stdout: 'abc1234 Add the discount', stderr: '', interrupted: false },
  );
  toolCall('Bash', { command: 'curl -sS https://example.com' });
  toolCall(
    'WebSearch',
    { query: 'vite latest release' },
    {
      query: 'vite latest release',
      results: [{ tool_use_id: 'x', content: [{ title: 'Vite 8', url: 'https://vite.dev/blog' }] }],
    },
  );
  toolCall(
    'WebFetch',
    { url: 'https://vite.dev/blog', prompt: 'the version' },
    { url: 'https://vite.dev/blog', code: 200, bytes: 3926, result: 'Vite 8.3.5' },
  );
  toolCall('mcp__symbiote__overview', {}, [{ type: 'text', text: '{"workspaces":0}' }]);
  const overview = await mcp('overview', {});
  expect(overview.status).toBe(200);

  // The tab, opened while a Confirm waits: live.
  await tab(page, 'Activity').click();
  await expect(page).toHaveURL(/\/nucleus\?activity$/);
  const starting = mcp('start_workspace', {
    kind: 'fix',
    title: 'The discount',
    branch: 'fix/discount',
    parts: { happens: 'It subtracts the percent as cents' },
    planFirst: true,
  });
  await expect(group(page, 'confirm')).toContainText(
    'Confirm: Start fix/discount, "The discount", with Claude Code, plan first',
    POLL,
  );
  await ask(page).getByRole('button', { name: 'Decline' }).click();
  expect(
    ((await (await starting).json()) as { result: { isError?: boolean } }).result.isError,
  ).toBe(true);
  symbiote.nucleusHook({
    hook_event_name: 'Stop',
    last_assistant_message: 'One commit: the discount.',
  });

  const shown = async () => {
    await expect(group(page, 'report')).toContainText('Answered', POLL);
    await expect(group(page, 'message')).toContainText('You: What changed lately?');
    // The refused command stays in its phase, with the gate's reason one click away.
    const explore = group(page, 'explore');
    await expect(explore.locator('.activity-summary')).toContainText('1 refused');
    await explore.locator('summary').first().click();
    const refused = explore.locator('.activity-event.failed');
    await expect(refused).toContainText('refused');
    await refused.locator('summary').click();
    await expect(refused.locator('.activity-facts')).toContainText('curl: only git runs');
    // The web: a search and the page read, its address and status.
    const web = group(page, 'web');
    await expect(web.locator('.activity-summary')).toHaveText('1 search · 1 page');
    await web.locator('summary').first().click();
    const fetched = web.locator('.activity-event').nth(1);
    await fetched.locator('summary').click();
    await expect(fetched.locator('.activity-pages')).toContainText('https://vite.dev/blog 200');
    // Symbiote's tools, and the Confirm declined.
    await expect(group(page, 'symbiote').first().locator('.activity-summary')).toContainText(
      'overview',
    );
    await expect(group(page, 'confirm').locator('.activity-status')).toHaveText('Declined');
  };
  await shown();

  // The raw stream: every line, the gate's decisions among them.
  await nucleusPage(page).getByRole('button', { name: 'Raw events' }).click();
  await expect(nucleusPage(page).locator('.activity-raw-line').first()).toBeVisible();
  const recorded = readFileSync(activityFile(), 'utf8').trimEnd().split('\n').length;
  await expect(nucleusPage(page).locator('.activity-counts')).toHaveText(
    `${recorded} lines recorded`,
  );

  // Kept across a restart of `symbiote view`.
  const url = await symbiote.restart();
  await page.goto(`${url}nucleus?activity`);
  await expect(tab(page, 'Activity')).toHaveAttribute('aria-selected', 'true');
  await shown();

  // Exported as a workspace's is (V84): its message, the gate's refusal, the Confirm declined.
  await nucleusPage(page).getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download Markdown' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^activity-.+-nucleus-\d{4}-\d{2}-\d{2}\.md$/);
  const text = readFileSync(await download.path(), 'utf8');
  expect(text).toMatch(/^---\nsymbiote-activity: 1\nof: nucleus\n/);
  expect(text).toContain('> What changed lately?');
  expect(text).toMatch(
    /Bash · `curl -sS https:\/\/example\.com` · \*\*refused by its gate\*\*: .*curl: only git runs/,
  );
  expect(text).toContain('Symbiote · `start_workspace` · declined by the person');
  expect(text).toContain('Confirm declined after');
});

test('says nothing is recorded yet, and the terminal is one tab away', async ({ page }) => {
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}nucleus?activity`);
  await expect(nucleusPage(page).locator('.activity-empty')).toContainText(
    'Nothing recorded yet',
    POLL,
  );
  await tab(page, 'Terminal').click();
  await expect(page).toHaveURL(/\/nucleus$/);
  await expect(nucleusPage(page)).toContainText('runs in a terminal, and none runs here');
});
