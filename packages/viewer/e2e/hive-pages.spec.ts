import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { hiveMocks, mockOverview } from './overview-data.js';
import { LANDED, LIVE, STOPPED, mockHivePages } from './hive-pages-data.js';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Hive's pages (V92, decisions 860–874), as spikes/hive-redesign's proofs draw them: the Run tab
// (02-run-live, 03-run-landed, 07-run-stopped) and the sidenav (01-overview) over the proofs'
// records answered by `page.route`; Settings' Hive mode page (04-settings, normal mode's
// 11-settings-hive), Start in Hive mode (05-new-goal) and the question (09-turn-on, refused) on a
// real `symbiote view`; the arrival's length, and at once with reduced motion.
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
/** A check set for the repository: Hive turns on only with one (decision 872). */
const setCheck = (commands: string[] = ['npm test']) => {
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(
    join(symbiote.repo, 'symbiote', 'config.json'),
    JSON.stringify({ merge: { checks: commands } }),
  );
};
/** Hive on, over the proofs' records. */
const hiveOver = async (page: Page) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
  await post(page, '/api/hive', { on: true });
  await mockOverview(page, hiveMocks());
  await mockHivePages(page);
};
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Talk to the agent' });
const run = (page: Page) => page.locator('.run-tab');
const round = (page: Page, n: number) => run(page).getByRole('region', { name: `Round ${n}` });
const folded = (page: Page, n: number) =>
  run(page).getByRole('button', { name: new RegExp(`^Round ${n}\\b`) });

test("the Run tab while Hive checks: the round on a timeline, each command's time, the log's tail", async ({
  page,
}) => {
  await hiveOver(page);
  await page.goto(`${symbiote.url}?branch=${encodeURIComponent(LIVE)}&run`);
  await expect(tabs(page).getByRole('tab', { name: 'Run' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(tabs(page).getByRole('tab', { name: 'Review' })).toHaveCount(0);

  const two = round(page, 2);
  await expect(two.locator('.run-round-head')).toContainText('In progress');
  const writer = two.getByRole('listitem', { name: 'Writer' });
  await expect(writer).toContainText('fixed the proven defect');
  await expect(writer).toContainText('+34');
  await expect(writer).toContainText('−6');
  await expect(writer).toContainText('Cover a 410 in the retry test');
  const check = two.getByRole('listitem', { name: 'Check' });
  const commands = check.locator('.run-command');
  await expect(commands).toHaveCount(4);
  await expect(commands.nth(0)).toContainText('pnpm install --frozen-lockfile');
  await expect(commands.nth(0)).toContainText('0:21');
  // The command running: its time against the last passing run's, and a bar.
  await expect(commands.nth(3)).toContainText(/4:1\d of ~7 min/);
  await expect(commands.nth(3).getByRole('progressbar')).toBeVisible();
  // The log's tail.
  await expect(check.locator('.run-log-tail')).toContainText('does not retry a 410 Gone');
  await expect(check.locator('.run-log-tail')).toContainText('pays with a saved card');
  await expect(two.getByRole('listitem', { name: 'Running review' })).toContainText(
    'starts when the check passes',
  );
  await expect(two.getByRole('listitem', { name: 'Land' })).toContainText('merge queue');

  // Round 1 folded to a line; opened, its defect a card.
  await expect(folded(page, 1)).toContainText('1 defect proven');
  await expect(folded(page, 1)).toContainText(
    'A webhook the provider calls gone (410) is still retried',
  );
  await expect(folded(page, 1)).toContainText('check 7:02 · review $0.44');
  await folded(page, 1).click();
  await expect(round(page, 1).locator('.run-defect')).toContainText('Proven');
  await expect(round(page, 1).locator('.run-defect')).toContainText(
    'node --test test/webhook-410.test.ts',
  );

  // The side card: the run's facts and its spend.
  const side = page.locator('.run-side');
  await expect(side).toContainText('Checking 4/4');
  await expect(side).toContainText('$1.92');
  await expect(side).toContainText('budget $5.00');

  // An old address names the tab Review: it opens Run.
  await page.goto(`${symbiote.url}?branch=${encodeURIComponent(LIVE)}&review`);
  await expect(tabs(page).getByRole('tab', { name: 'Run' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('the Run tab of a landed workspace: where it landed, its rounds, a defect proven by a test', async ({
  page,
}) => {
  await hiveOver(page);
  await page.goto(`${symbiote.url}?branch=${encodeURIComponent(LANDED)}&run`);
  const landed = run(page).getByRole('status', { name: 'Landed in main' });
  await expect(landed).toContainText(
    'Merged through the merge queue as 20c37bc; pushed main and feature/discount-code to origin',
  );
  await expect(round(page, 2).locator('.run-round-head')).toContainText('Approved');
  await expect(round(page, 2).getByRole('listitem', { name: 'Running review' })).toContainText(
    'Codes are trimmed and matched in any case',
  );
  await expect(folded(page, 1)).toContainText('1 defect proven');
});

test('the Run tab of a workspace Hive stopped: why, the failing output, Message the writer', async ({
  page,
}) => {
  await hiveOver(page);
  await page.goto(`${symbiote.url}?branch=${encodeURIComponent(STOPPED)}&run`);
  const stop = run(page).getByRole('alert');
  await expect(stop).toContainText('Hive stopped after 3 rounds');
  await expect(stop).toContainText('The check failed 3 times: pnpm test:e2e');
  await expect(stop).toContainText('Test timeout of 30000ms exceeded.');
  const message = stop.getByRole('button', { name: 'Message the writer' });
  await expect(message).toHaveClass(/\bprimary\b/);
  const three = round(page, 3);
  await expect(three.locator('.run-round-head')).toContainText('Check failed');
  await expect(three.locator('.run-command').nth(3)).toContainText('failed');
  await expect(folded(page, 2)).toContainText('A quoted comma splits a row into two columns');
  await expect(folded(page, 1)).toContainText('Check failed');
  await expect(folded(page, 1)).toContainText('pnpm check');

  // The one way to message the agent: the Thread's box.
  await message.click();
  await expect(tabs(page).getByRole('tab', { name: 'Thread' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test("the sidenav in Hive mode: In flight, Stopped, Landed today; each row two lines; Hive's pill", async ({
  page,
}) => {
  await hiveOver(page);
  await page.goto(`${symbiote.url}overview`);
  const sidenav = page.locator('.sidenav');
  await expect(sidenav.locator('.sidenav-top .hive-pill')).toHaveText('Hive');
  const group = (name: string) => sidenav.getByRole('region', { name, exact: true });
  await expect(group('In flight').locator('.hive-row')).toHaveCount(4);
  await expect(group('Stopped').locator('.hive-row')).toHaveCount(1);
  await expect(group('Landed today').locator('.hive-row')).toHaveCount(5);
  await expect(sidenav.getByRole('region', { name: 'Hive', exact: true })).toHaveCount(0);

  const checking = group('In flight').locator(`.hive-row[data-branch="${LIVE}"]`);
  await expect(checking.locator('.hive-row-title')).toHaveText('Retry failed payment webhooks');
  await expect(checking.locator('.hive-row-state')).toContainText('Checking 4/4');
  await expect(checking.locator('.hive-row-state')).toContainText('round 2');
  await expect(group('Stopped').locator('.hive-row-state')).toContainText('Stopped');
  await expect(group('Stopped').locator('.hive-row-state')).toContainText('3 of 3 rounds');
  const discount = group('Landed today').locator(`.hive-row[data-branch="${LANDED}"]`);
  await expect(discount.locator('.hive-row-time')).toHaveText(/^\d\d:\d\d$/);
  // Two lines a row.
  const box = await checking.boundingBox();
  expect(box?.height).toBeLessThan(56);

  // A row opens its workspace.
  await checking.click();
  await expect(page).toHaveURL(new RegExp(`branch=${encodeURIComponent(LIVE)}`));
});

test("Settings' Hive mode page: grouped rows, on since when, the reviewer's model and effort", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  setCheck(['pnpm check', 'pnpm test']);
  await page.goto(`${symbiote.url}settings?prompt=hive-mode`);
  const editor = page.getByRole('region', { name: 'Hive mode' });
  // Off: what Hive does, and the crimson Turn on Hive mode.
  await expect(editor.getByRole('heading', { level: 2 })).toContainText('Off');
  await expect(editor.getByRole('button', { name: 'Turn on Hive mode' })).toHaveClass(/\bhive\b/);
  const rows = (group: string) => editor.getByRole('group', { name: group });
  await expect(rows('Landing')).toContainText('Lands through');
  await expect(rows('Landing')).toContainText('The check');
  await expect(rows('Landing')).toContainText('pnpm check');
  await expect(rows('Limits')).toContainText('Pause by usage');
  await expect(rows('Limits')).toContainText('Budget per workspace');
  await expect(rows('Running reviewer').getByRole('combobox')).toHaveCount(2);

  // On: since when, the access it gives, Turn off Hive secondary with red words.
  await post(page, '/api/hive', { on: true });
  await page.reload();
  await expect(editor.getByRole('heading', { level: 2 })).toContainText('On');
  await expect(editor).toContainText(/since \d+ \w+, \d\d:\d\d/);
  await expect(editor).toContainText('Hive runs agents with full access to this machine.');
  await expect(editor.getByRole('button', { name: 'Turn off Hive' })).toHaveClass(/\bdanger\b/);
  await expect(rows('Landing')).toContainText('Rounds');
  await expect(rows('Landing')).toContainText('3 per workspace');

  // The reviewer's model and effort are set here, its prompt on its own page.
  const model = rows('Running reviewer').getByRole('combobox', { name: 'Model' });
  await model.selectOption({ index: 1 });
  await expect(editor.getByRole('status')).toContainText('Saved');
  await page.goto(`${symbiote.url}settings?prompt=hive.reviewer`);
  const reviewer = page.getByRole('region', { name: 'Reviewer' });
  await expect(reviewer.getByRole('combobox', { name: 'Model' })).toHaveCount(0);
  await expect(reviewer.getByRole('link', { name: 'Hive mode' })).toBeVisible();
});

test('Start in Hive mode: a new goal, the check Hive will run, how Hive runs it', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  setCheck(['pnpm install --frozen-lockfile', 'pnpm test']);
  await page.goto(`${symbiote.url}git`);
  await post(page, '/api/hive', { on: true });
  await page.goto(`${symbiote.url}start`);
  const start = page.getByRole('region', { name: 'New goal' });
  await expect(start.getByRole('heading', { level: 1 })).toHaveText('New goal');
  await expect(start.getByRole('button', { name: 'Start goal' })).toHaveClass(/\bhive\b/);
  await expect(start.getByLabel('Plan first and wait for my OK')).toHaveCount(0);
  const check = start.locator('.start-hive-check');
  await expect(check).toContainText("Hive's check");
  await expect(check.locator('code')).toHaveText(['pnpm install --frozen-lockfile', 'pnpm test']);
  await expect(check).toContainText('from merge.checks');
  const how = start.getByRole('region', { name: 'How Hive runs it' });
  for (const step of ['Write', 'Check', 'Review', 'Land']) await expect(how).toContainText(step);
  await expect(how).toContainText('2 commands on each commit');
  await expect(how).toContainText('3 rounds');
});

test('turning Hive on: the four steps, what it checks first; refused names the open workspaces', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  setCheck();
  await page.goto(`${symbiote.url}settings?prompt=hive-mode`);
  const editor = page.getByRole('region', { name: 'Hive mode' });
  await editor.getByRole('button', { name: 'Turn on Hive mode' }).click();
  const question = page.getByRole('alertdialog', { name: 'Turn on Hive mode' });
  await expect(question.locator('canvas.hive-joining')).toBeVisible();
  for (const step of ['Write', 'Check', 'Review', 'Land']) {
    await expect(question.locator('.hq-steps')).toContainText(step);
  }
  const ready = question.getByRole('list', { name: 'Before it starts' });
  await expect(ready.getByRole('listitem')).toHaveCount(4);
  await expect(ready.getByRole('listitem').nth(0)).toContainText('A check is set');
  await expect(ready.getByRole('listitem').nth(0)).toContainText('npm test, from merge.checks');
  await expect(ready.getByRole('listitem').nth(3)).toContainText('Full access');
  await expect(question.getByRole('button', { name: 'Turn on Hive' })).toBeEnabled();
  await question.getByRole('button', { name: 'Cancel' }).click();

  // A workspace in normal mode is open: named, and Turn on Hive is off.
  await post(page, '/api/workspaces', {
    branch: 'feature/cart',
    kind: 'feature',
    title: 'Save a cart for later',
    parts: { goal: 'Save a cart.' },
    planFirst: true,
  });
  await editor.getByRole('button', { name: 'Turn on Hive mode' }).click();
  const open = ready.getByRole('listitem').nth(1);
  await expect(open).toContainText('1 workspace in normal mode is open');
  await expect(open.locator('.chip')).toHaveText(['Save a cart for later']);
  await expect(question.getByRole('button', { name: 'Turn on Hive' })).toBeDisabled();
  await question.getByRole('button', { name: 'Cancel' }).click();

  // No check set: Turn on Hive is off too.
  await page.route('**/api/hive/state', (route) =>
    route.fulfill({ json: { on: false, normal: [], flight: [] } }),
  );
  await editor.getByRole('button', { name: 'Turn on Hive mode' }).click();
  await expect(ready.getByRole('listitem').nth(0)).toContainText('No check is set');
  await expect(question.getByRole('button', { name: 'Turn on Hive' })).toBeDisabled();
});

test('the arrival: 1.4 s of opacity, transform and one clip-path, ended by 1.54 s; at once with reduced motion', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  setCheck();
  await page.goto(`${symbiote.url}settings?prompt=hive-mode`);
  const editor = page.getByRole('region', { name: 'Hive mode' });
  await editor.getByRole('button', { name: 'Turn on Hive mode' }).click();
  const question = page.getByRole('alertdialog', { name: 'Turn on Hive mode' });
  await expect(question.getByRole('button', { name: 'Turn on Hive' })).toBeEnabled();
  await question.getByRole('button', { name: 'Turn on Hive' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-hive-arriving', '');
  // Every animation of the arrival, the view transition's included, ends by 1.54 s.
  const timing = await page.evaluate(() => {
    const animations = document.getAnimations();
    const ends = animations.map((a) => Number(a.effect?.getComputedTiming().endTime ?? 0));
    const properties = new Set(
      animations.flatMap((a) =>
        a.effect instanceof KeyframeEffect
          ? a.effect.getKeyframes().flatMap((k) => Object.keys(k))
          : [],
      ),
    );
    return { end: Math.max(...ends), properties: [...properties] };
  });
  expect(timing.end).toBeGreaterThan(1400);
  expect(timing.end).toBeLessThanOrEqual(1540);
  // Nothing that blurs or lays out while the art moves (decision 631).
  expect(timing.properties).not.toContain('filter');
  expect(timing.properties).not.toContain('width');
  await expect(page.locator('html')).toHaveAttribute('data-hive', 'on');
  await expect(page.locator('html')).not.toHaveAttribute('data-hive-arriving', '', {
    timeout: 3_000,
  });
  await expect(question).toBeHidden();
  await expect(page.locator('.sidenav-top .hive-pill')).toBeVisible();

  // Reduced motion: off, then on again at once.
  await post(page, '/api/hive', { on: false });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.evaluate(() => {
    new MutationObserver(() => {
      if (document.documentElement.hasAttribute('data-hive-arriving')) {
        document.documentElement.dataset.arrived = 'with-motion';
      }
    }).observe(document.documentElement, { attributes: true });
  });
  await editor.getByRole('button', { name: 'Turn on Hive mode' }).click();
  await question.getByRole('button', { name: 'Turn on Hive' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-hive', 'on');
  await expect(question).toBeHidden();
  await expect(page.locator('html')).not.toHaveAttribute('data-arrived');
});
