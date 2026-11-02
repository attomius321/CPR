import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Hive paces itself (HV5, decisions 796–802): a real `symbiote view` reading a fake of Claude's
// usage endpoint. Over the threshold a workspace's writer is held at its start, its card, page and
// Review tab say why and until when, and it starts by itself once the window resets; Settings' Hive
// page sets the threshold and the budget; the Review tab says what a workspace spent.
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

const BRANCH = 'feature/halve';
const card = (page: Page) => page.locator(`.sidenav .workspace-row[data-branch="${BRANCH}"]`);
const post = (page: Page, path: string, body: unknown) =>
  page.evaluate(
    async ([path, body]) => {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
    },
    [path, body] as const,
  );
/** Claude's usage endpoint's answer: the 5-hour window at `percent`, resetting at `resets`. */
const usage = (percent: number, resets: number) => ({
  five_hour: { utilization: percent, resets_at: new Date(resets).toISOString() },
  seven_day: { utilization: 20, resets_at: new Date(resets + 5 * 86_400_000).toISOString() },
});
/** The writer's starts: the fake Claude Code's `--bg` calls. */
const starts = () => symbiote.calls().filter((call) => call.args[0] === '--bg');
const config = () => join(symbiote.repo, 'symbiote', 'config.json');
const setConfig = (value: unknown) => {
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(config(), JSON.stringify(value));
};
const startHalve = (page: Page) =>
  post(page, '/api/workspaces', {
    branch: BRANCH,
    kind: 'feature',
    title: 'Halve it',
    parts: { goal: 'Return a / 2.' },
    planFirst: false,
  });

test("over the threshold, a workspace's writer waits for the window's reset, said on its card, page and Review tab", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // 95 % of the 5-hour window, which resets 25 s from now.
  const resets = Date.now() + 25_000;
  symbiote = await serveWorkspaces({ usage: { claude: usage(95, resets) } });
  setConfig({ merge: { checks: ['test -f fixed.txt'] } });
  await page.goto(`${symbiote.url}git`);
  await post(page, '/api/hive', { on: true });
  await startHalve(page);
  // The list is read again on a page's load: none was open when it was first read.
  await page.reload();

  // Held at its start: no session, and why, until when, in the viewer's time.
  const said = /^Paused: usage 95 % of the 5-hour window, goes on at \d\d:\d\d$/;
  await expect(card(page).locator('.workspace-state strong')).toHaveText(said);
  expect(starts()).toHaveLength(0);
  const record = JSON.parse(
    readFileSync(join(symbiote.repo, 'symbiote', 'hive', 'feature', 'halve.json'), 'utf8'),
  ) as Record<string, unknown>;
  expect(record).toMatchObject({
    step: 'writing',
    unstarted: true,
    paused: { reason: 'usage', minutes: 300, percent: 95, pauseAt: 90 },
  });

  // The workspace's page and its Review tab say it.
  await card(page).click();
  await expect(page.locator('.workspace-top')).toContainText(
    'Paused: usage 95 % of the 5-hour window, goes on at',
  );
  await page
    .getByRole('tablist', { name: 'Talk to the agent' })
    .getByRole('tab', { name: 'Review' })
    .click();
  await expect(page.locator('.hive-now')).toHaveText(
    /^Paused: usage 95 % of the 5-hour window, goes on at \d\d:\d\d \(round 1 of 3\)$/,
  );

  // Elsewhere, the status bar says when Hive goes on; the writer starts by itself.
  await page.goto(`${symbiote.url}git`);
  await expect.poll(() => starts().length, { timeout: 45_000 }).toBe(1);
  expect(starts()[0]?.args.at(-1)).toContain('Hive drives this workspace.');
  await expect(page.locator('.statusbar-notice')).toContainText('Halve it goes on', {
    timeout: 15_000,
  });
  await expect(card(page).locator('.workspace-state strong')).not.toHaveText(said);
});

test("Settings' Hive page: the threshold, Hive's pause now, and the budget, in symbiote/config.json", async ({
  page,
}) => {
  test.setTimeout(60_000);
  symbiote = await serveWorkspaces({
    usage: { claude: usage(93, Date.now() + 3_600_000) },
  });
  setConfig({ merge: { checks: ['true'] } });
  await page.goto(`${symbiote.url}git`);
  await post(page, '/api/hive', { on: true });
  // A start asks the gate: Hive pauses.
  await startHalve(page);
  await page.goto(`${symbiote.url}settings?prompt=hive-mode`);
  const part = page.getByRole('region', { name: 'Pacing' });
  const pauseAt = part.getByRole('combobox', { name: 'Pause by usage' });
  await expect(pauseAt).toHaveValue('90');
  await expect(part).toContainText('is at 90 % or more, Hive starts no agent for any workspace');
  await expect(part.locator('.hive-paused-now')).toHaveText(
    /^Hive is paused now\. Paused: usage 93 % of the 5-hour window, goes on at \d\d:\d\d\.$/,
  );
  await pauseAt.selectOption('80');
  await expect(part.getByRole('status').last()).toHaveText('Hive pauses at 80 %.');
  expect(JSON.parse(readFileSync(config(), 'utf8'))).toMatchObject({
    hive: { usage: { pauseAt: 80 } },
  });
  // Never: no pause said, and the setting written as false.
  await pauseAt.selectOption('off');
  await expect(part.locator('.hive-paused-now')).toHaveCount(0);
  await expect(part).toContainText("Hive starts agents whatever your subscription's usage says.");
  expect(JSON.parse(readFileSync(config(), 'utf8'))).toMatchObject({
    hive: { usage: { pauseAt: false } },
  });

  // The budget: what is not dollars is said and not saved; dollars are.
  const budget = part.getByRole('textbox', { name: 'Budget per workspace' });
  const save = part.getByRole('button', { name: 'Save' });
  await expect(budget).toHaveValue('');
  await expect(part).toContainText('No budget: a workspace spends what its rounds take.');
  await budget.fill('ten');
  await expect(part).toContainText('A budget is an amount in dollars above 0, or empty for none.');
  await expect(save).toBeDisabled();
  await budget.fill('25');
  await save.click();
  await expect(part.getByRole('status').last()).toHaveText('The budget is $25.00.');
  await expect(part).toContainText('A workspace that has spent $25.00');
  expect(JSON.parse(readFileSync(config(), 'utf8'))).toMatchObject({ hive: { budget: 25 } });
  await page.reload();
  await expect(budget).toHaveValue('25');
  await budget.fill('');
  await save.click();
  await expect(part.getByRole('status').last()).toHaveText('No budget.');
  expect(JSON.parse(readFileSync(config(), 'utf8'))).not.toHaveProperty('hive.budget');
});

test('the Review tab says what a workspace spent, against its budget', async ({ page }) => {
  test.setTimeout(60_000);
  symbiote = await serveWorkspaces();
  setConfig({ merge: { checks: ['true'] }, hive: { budget: 1.5 } });
  await page.goto(`${symbiote.url}git`);
  await post(page, '/api/hive', { on: true });
  await startHalve(page);
  await expect.poll(() => starts().length).toBe(1);
  // Hive off: nothing writes Hive's record but the test, which gives it a spend.
  await post(page, '/api/hive', { on: false });
  const file = join(symbiote.repo, 'symbiote', 'hive', 'feature', 'halve.json');
  await expect
    .poll(() => (JSON.parse(readFileSync(file, 'utf8')) as { interrupted?: true }).interrupted)
    .toBe(true);
  const record = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeFileSync(
    file,
    JSON.stringify({
      ...record,
      step: 'stuck',
      // Stopped after the writer's last prompt: no message of the person's since.
      since: new Date().toISOString(),
      note: 'its spend reached its budget: $1.62 of $1.50 (the writer $1.20, 1 review $0.42). Raise the budget in Settings, then send it a message to go on',
      reviews: [
        { round: 1, at: 'b'.repeat(40), verdict: 'approved', ms: 60_000, cost: 0.42, findings: [] },
      ],
      spent: { writer: 1.2, at: new Date().toISOString() },
    }),
  );
  await post(page, '/api/hive', { on: true });
  await page.reload();
  await expect(card(page).locator('.workspace-state strong')).toHaveText(
    'Stopped: its spend reached its budget: $1.62 of $1.50 (the writer $1.20, 1 review $0.42). Raise the budget in Settings, then send it a message to go on',
  );
  await card(page).click();
  await page
    .getByRole('tablist', { name: 'Talk to the agent' })
    .getByRole('tab', { name: 'Review' })
    .click();
  const spend = page.getByLabel('Spend');
  await expect(spend).toHaveText('Spent $1.62 of a $1.50 budget: the writer $1.20, 1 review $0.42');
  await expect(spend).toHaveClass(/error/);
});
