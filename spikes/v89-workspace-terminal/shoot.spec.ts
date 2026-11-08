// V89's screenshots: a workspace's page and terminal view in every state the brief names, both
// themes, both modes, at 1x, with the e2e fake agent (repos an agent made are not trusted by the
// real Claude Code). `SHOTS=before|after` names the folder under `shots/`.
//
//   cd packages/viewer && SHOTS=before env -u WAYLAND_DISPLAY \
//     npx playwright test --config ../../spikes/v89-workspace-terminal/playwright.config.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import {
  serveWorkspaces,
  type RunningWorkspaces,
} from '../../packages/viewer/e2e/symbiote.js';

const here = dirname(fileURLToPath(import.meta.url));
const phase = process.env.SHOTS ?? 'after';
const out = join(here, 'shots', phase);
mkdirSync(out, { recursive: true });

let symbiote: RunningWorkspaces;
test.afterEach(() => symbiote?.stop());
test.setTimeout(600_000);

const PLAN = `# Halve a number

## Today
\`half\` does not exist; \`double\` lives in \`src/math.ts\`.

## What I'd change
1. \`src/math.ts\`: \`half(n)\`, returning \`n / 2\`.
2. A test: \`half(4)\` is 2, \`half(3)\` is 1.5.

## Unless you say otherwise
- No rounding: a half of an odd number keeps its fraction.`;

const post = (page: Page, url: string, body: unknown) =>
  page.evaluate(
    async ({ url, body }) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${url}: ${text}`);
      return text ? (JSON.parse(text) as unknown) : null;
    },
    { url, body },
  );

const start = (
  page: Page,
  branch: string,
  title: string,
  more: Record<string, unknown> = {},
) =>
  post(page, '/api/workspaces', {
    kind: 'feature',
    title,
    parts: { goal: `${title}.` },
    branch,
    planFirst: false,
    ...more,
  });

/** The agent's session ID, as the list says. */
const agentId = async (page: Page, branch: string) =>
  page.evaluate(async (branch) => {
    const list = (await (await fetch('/api/workspaces')).json()) as {
      workspaces: { branch: string; agent: { id?: string } }[];
    };
    return list.workspaces.find((w) => w.branch === branch)?.agent.id ?? '';
  }, branch);

/** Waits until the list says the workspace's agent is in `state` (the list is read on a timer). */
const until = (page: Page, branch: string, state: string) =>
  expect
    .poll(
      () =>
        page.evaluate(async (branch) => {
          const list = (await (await fetch('/api/workspaces')).json()) as {
            workspaces: { branch: string; agent: { state: string } }[];
          };
          return list.workspaces.find((w) => w.branch === branch)?.agent.state;
        }, branch),
      { timeout: 30_000 },
    )
    .toBe(state);

/** Lossless-ish WebP of the page, through Chromium's canvas (the spikes' shoot.mjs). */
async function shoot(page: Page, name: string) {
  await page.waitForTimeout(700);
  const png = await page.screenshot();
  const webp = await page.evaluate(async (b64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', 1).split(',')[1] ?? '';
  }, png.toString('base64'));
  writeFileSync(join(out, `${name}.webp`), Buffer.from(webp, 'base64'));
}

/** Both themes of a workspace's page; `query` picks a tab (`&thread`). */
async function both(page: Page, name: string, branch: string, query = '') {
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((theme) => {
      localStorage.setItem('symbiote.viewer.theme', theme);
    }, theme);
    await page.goto(`${symbiote.url}?branch=${encodeURIComponent(branch)}${query}`);
    await expect(page.locator('.workspace')).toBeVisible();
    await shoot(page, theme === 'dark' ? name : `${name}-light`);
  }
}

test('normal mode, Claude Code with terminals', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);

  await start(page, 'feature/working', 'Add a half function');
  symbiote.hook('feature/working', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  });
  await both(page, '01-working', 'feature/working');

  await start(page, 'feature/waiting', 'Store a saved cart');
  symbiote.hook('feature/waiting', {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'npm install pg', description: 'Install the Postgres driver' },
  });
  symbiote.hook('feature/waiting', {
    hook_event_name: 'Notification',
    notification_type: 'permission_prompt',
    message: 'Claude needs your permission to use Bash',
  });
  symbiote.session('feature/waiting', { state: 'blocked', waitingFor: 'permission prompt' });
  symbiote.setSession(await agentId(page, 'feature/waiting'), {
    state: 'blocked',
    status: 'waiting',
    waitingFor: 'permission prompt',
    answer:
      'Bash command: npm install pg\r\n  Do you want to proceed?\r\n  > 1. Yes\r\n    2. Yes, and do not ask again\r\n    3. No, and tell Claude what to do differently (esc)',
  });
  await until(page, 'feature/waiting', 'needs-you');
  await both(page, '02-waiting', 'feature/waiting');

  await start(page, 'feature/plan', 'Halve a number', { planFirst: true });
  symbiote.report('feature/plan', PLAN);
  await until(page, 'feature/plan', 'plan-ready');
  await both(page, '03-plan-ready', 'feature/plan');
  await both(page, '03-plan-ready-thread', 'feature/plan', '&thread');

  await start(page, 'feature/interrupted', 'Count the words');
  symbiote.interrupt('feature/interrupted');
  await until(page, 'feature/interrupted', 'needs-you');
  await both(page, '04-interrupted', 'feature/interrupted');

  await start(page, 'feature/stopped', 'Trim the names');
  symbiote.session('feature/stopped', { state: 'stopped' });
  await until(page, 'feature/stopped', 'stopped');
  await both(page, '05-stopped', 'feature/stopped');

  await start(page, 'feature/failed', 'Parse the dates');
  symbiote.session('feature/failed', { state: 'failed' });
  await until(page, 'feature/failed', 'failed');
  await both(page, '06-failed', 'feature/failed');

  await start(page, 'feature/review', 'Sort the rows');
  symbiote.commit('feature/review', 'rows.txt', 'sorted\n', 'Sort the rows');
  symbiote.report('feature/review', 'Done: the rows are sorted, with a test.');
  await until(page, 'feature/review', 'ready');
  await both(page, '08-to-review', 'feature/review');

  await start(page, 'feature/merged', 'Rename a field');
  symbiote.commit('feature/merged', 'field.txt', 'name\n', 'Rename the field');
  symbiote.report('feature/merged', 'Done: renamed.');
  execFileSync('git', ['merge', '-q', '--no-ff', '-m', 'Merge', 'feature/merged'], {
    cwd: symbiote.repo,
  });
  await both(page, '09-merged', 'feature/merged');

  await start(page, 'feature/gone', 'Drop the cache');
  rmSync(symbiote.folder('feature/gone'), { recursive: true, force: true });
  await both(page, '10-worktree-gone', 'feature/gone');

  await start(page, 'feature/shells', 'Serve the site');
  const first = (await post(page, '/api/workspaces/shell', {
    branch: 'feature/shells',
    cols: 80,
    rows: 24,
  })) as { id: string };
  await post(page, `/api/terminals/${first.id}/in`, { data: 'sleep 300\r' });
  for (let i = 1; i < 8; i++) {
    await post(page, '/api/workspaces/shell', { branch: 'feature/shells', cols: 80, rows: 24 });
  }
  await both(page, '11-many-shells', 'feature/shells', '&shell=3');
  if (phase !== 'before') {
    // New in V89: Split and Focus.
    await post(page, '/api/workspaces/shell', { branch: 'feature/waiting', cols: 80, rows: 24 });
    await both(page, '17-split', 'feature/waiting', '&split=1');
    await page.evaluate(() => localStorage.setItem('symbiote.viewer.focus', 'on'));
    await both(page, '18-focus', 'feature/working');
    await page.evaluate(() => localStorage.setItem('symbiote.viewer.focus', 'off'));
  }

  await page.setViewportSize({ width: 960, height: 900 });
  await both(page, '12-narrow', 'feature/waiting');
  await page.setViewportSize({ width: 1440, height: 900 });

  symbiote.distrust();
  await start(page, 'feature/notstarted', 'Import the feed').catch(() => null);
  await until(page, 'feature/notstarted', 'not-started');
  await both(page, '07-not-started', 'feature/notstarted');
});

test('normal mode, no terminal: Codex without its app server', async ({ page }) => {
  symbiote = await serveWorkspaces({ codex: true });
  await page.goto(`${symbiote.url}git`);
  await start(page, 'feature/codex', 'Add a half function', { agent: 'codex' });
  await both(page, '13-codex-no-terminal', 'feature/codex');
});

test('Hive mode: writing, checking', async ({ page }) => {
  symbiote = await serveWorkspaces();
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(
    join(symbiote.repo, 'symbiote', 'config.json'),
    JSON.stringify({ merge: { checks: ['test -f one.txt', 'sleep 120'] } }),
  );
  await page.goto(`${symbiote.url}git`);
  await post(page, '/api/hive', { on: true });
  await start(page, 'feature/one', 'One');
  await both(page, '15-hive-writing', 'feature/one');
  symbiote.commit('feature/one', 'one.txt', 'one\n', 'One');
  symbiote.report('feature/one', 'Done: one.txt.');
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const list = (await (await fetch('/api/workspaces')).json()) as {
            workspaces: { hive?: { step: string; live?: unknown } }[];
          };
          return list.workspaces[0]?.hive?.live !== undefined;
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.waitForTimeout(2500);
  await both(page, '16-hive-checking', 'feature/one');
  if (phase !== 'before') {
    await page.evaluate(() => localStorage.setItem('symbiote.viewer.focus', 'on'));
    await both(page, '19-hive-focus', 'feature/one');
  }
});
