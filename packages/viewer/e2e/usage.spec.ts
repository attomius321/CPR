import { expect, test, type Locator, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Each subscription's windows in the status bar (V29c): Claude Code's from a fake of the endpoint
// its /usage reads, with fake credentials; Codex's from its fake app server. Never yours.
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

const POLL = { timeout: 12_000 };
const in3h = () => new Date(Date.now() + 3 * 3_600_000 + 60_000).toISOString();
const usage = (page: Page) =>
  page.getByRole('contentinfo', { name: 'Status bar' }).getByRole('list', { name: 'Usage' });

/** Whether a window's bar is filled in a token's colour, resolved as the page resolves it. */
const filledWith = (window: Locator, token: string) =>
  window.locator('.usage-bar > span').evaluate((fill, token) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    document.body.append(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(fill).backgroundColor === want;
  }, token);

test("the status bar shows each subscription's windows, what a hover says, and never the token", async ({
  page,
}) => {
  symbiote = await serveWorkspaces({
    codex: true,
    appServer: true,
    usage: {
      claude: {
        limits: [
          { kind: 'session', group: 'session', percent: 59, resets_at: in3h(), scope: null },
          { kind: 'weekly_all', group: 'weekly', percent: 84, resets_at: in3h(), scope: null },
        ],
      },
    },
  });
  const said: string[] = [];
  page.on('response', (response) => {
    if (!response.url().includes('/api/')) return;
    // A page left before its answer was read: nothing to read.
    response.text().then(
      (text) => said.push(text),
      () => undefined,
    );
  });
  await page.goto(`${symbiote.url}git`);
  const items = usage(page).getByRole('listitem');
  await expect(items).toHaveCount(2, POLL);
  const [claude, codex] = [items.nth(0), items.nth(1)];
  await expect(claude).toHaveText('ClaudePro5h59%wk84%');
  await expect(codex).toHaveText('CodexGo30d0%');
  // 84 % is amber, 59 % green: the tone of each window.
  await expect(claude.locator('.usage-window.tone-high')).toHaveText('wk84%');
  await expect(claude.locator('.usage-window.tone-ok')).toHaveText('5h59%');
  // The bars too: green, then amber (V29c's colours, back after V31a greyed the green).
  expect(await filledWith(claude.locator('.usage-window.tone-ok'), '--added')).toBe(true);
  expect(await filledWith(claude.locator('.usage-window.tone-high'), '--warning')).toBe(true);
  await expect(claude).toHaveAttribute(
    'data-tip',
    /^Claude Pro\n5h: 59 % used, resets in 3 h \d+ min\n/,
  );
  await expect(claude).toHaveAttribute('data-tip', /\nRead just now$/);

  // The token went to the usage endpoint only, and never to the page.
  expect(symbiote.usageRequests()).toEqual(['Bearer e2e-access-token']);
  await page.reload();
  await expect(items).toHaveCount(2, POLL);
  // From Symbiote's copy: read once in the minute.
  expect(symbiote.usageRequests()).toHaveLength(1);
  expect(said.join('\n')).not.toContain('e2e-access-token');
  expect(said.join('\n')).not.toContain('e2e-refresh-token');

  // On every page of the shell, a diff's too.
  await page.goto(`${symbiote.url}settings`);
  await expect(usage(page).getByRole('listitem')).toHaveCount(2, POLL);
});

test('a window at its limit is red, the bar and its number', async ({ page }) => {
  symbiote = await serveWorkspaces({
    codex: true,
    appServer: true,
    usage: {
      claude: {
        limits: [
          { kind: 'session', group: 'session', percent: 100, resets_at: in3h(), scope: null },
          { kind: 'weekly_all', group: 'weekly', percent: 30, resets_at: in3h(), scope: null },
        ],
      },
    },
  });
  await page.goto(`${symbiote.url}git`);
  const claude = usage(page).getByRole('listitem').first();
  await expect(claude).toHaveText('ClaudePro5h100%wk30%', POLL);
  const full = claude.locator('.usage-window.tone-full');
  await expect(full).toHaveText('5h100%');
  expect(await filledWith(full, '--removed')).toBe(true);
  expect(await filledWith(claude.locator('.usage-window.tone-ok'), '--added')).toBe(true);
});

test('the start page names the plan the status bar names, not the one the token kept from login', async ({
  page,
}) => {
  // Upgraded to Max: Claude Code's profile says so; `auth status` still says Pro, its token's.
  symbiote = await serveWorkspaces({
    plan: 'claude_max',
    usage: {
      claude: {
        limits: [
          { kind: 'session', group: 'session', percent: 12, resets_at: in3h(), scope: null },
        ],
      },
    },
  });
  await page.goto(`${symbiote.url}git`);
  await expect(usage(page).getByRole('listitem')).toHaveText(['ClaudeMax5h12%'], POLL);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const start = page.getByRole('region', { name: 'Start a workspace' });
  await expect(start.locator('.start-account')).toHaveText('your Max subscription');
});

test("Claude's endpoint failing before Symbiote read it: Claude left out, the rest as it is", async ({
  page,
}) => {
  symbiote = await serveWorkspaces({
    codex: true,
    appServer: true,
    usage: { claude: { error: 'overloaded' }, status: 529 },
  });
  await page.goto(`${symbiote.url}git`);
  // No read of Symbiote's yet: Claude is left out, Codex is shown.
  await expect(usage(page).getByRole('listitem')).toHaveText(['CodexGo30d0%'], POLL);
});

test("started while Claude's endpoint refuses: the last read Symbiote kept, its age, and why", async ({
  page,
}) => {
  const at = new Date(Date.now() - 12 * 60_000).toISOString();
  symbiote = await serveWorkspaces({
    codex: true,
    appServer: true,
    usage: {
      claude: { error: { type: 'rate_limit_error' } },
      status: 429,
      // An earlier run's, for the fake's account (it has no id).
      last: {
        account: null,
        subscription: {
          agent: 'claude',
          plan: 'Pro',
          windows: [
            { minutes: 300, usedPercent: 40, resetsAt: in3h() },
            { minutes: 10_080, usedPercent: 19, resetsAt: in3h() },
          ],
          at,
          source: 'live',
        },
      },
    },
  });
  await page.goto(`${symbiote.url}git`);
  const claude = usage(page).getByRole('listitem').first();
  await expect(claude).toHaveText('ClaudePro5h40%wk19%12 minutes ago', POLL);
  await expect(claude).toHaveClass(/\bcached\b/);
  await expect(claude).toHaveAttribute(
    'data-tip',
    /\nRead 12 minutes ago, not since: Claude's usage asked to wait \(429\)$/,
  );
  expect(symbiote.usageRequests()).toHaveLength(1);
});
