import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Hive's running reviewer (HV3): once the check passes, the fake Claude Code as the reviewer
// proves a defect with a failing test in its copy; Symbiote reruns that test (under bubblewrap)
// and sends it to the writer; the fix passes the next review; the workspace's Review tab shows
// both rounds; and Hive lands it on its own (HV4): its approval, the merge queue, the pushes.
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

const BRANCH = 'feature/one';
const TEST = 'grep -qx one one.txt || { echo "FAIL one says one"; exit 1; }\n';
// In Hive mode the start page is New goal (V92, decision 871).
const startPage = (page: Page) => page.getByRole('region', { name: 'New goal' });
const card = (page: Page) => page.locator(`.sidenav .workspace-row[data-branch="${BRANCH}"]`);
const hive = (page: Page, on: boolean) =>
  page.evaluate(async (on) => {
    const response = await fetch('/api/hive', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify({ on }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, on);
const sent = () =>
  symbiote
    .calls()
    .filter((call) => call.args[1] === '--resume')
    .map((call) => call.args.at(-1) ?? '');
const record = () =>
  JSON.parse(
    readFileSync(join(symbiote.repo, 'symbiote', 'hive', 'feature', 'one.json'), 'utf8'),
  ) as {
    step: string;
    round: number;
    reviews: { verdict: string }[];
    message?: { sent?: true };
  };

test('a defect proven by a failing test goes to the writer; its fix is approved; Hive lands it', async ({
  page,
}) => {
  // Symbiote reruns the reviewer's tests confined by bubblewrap, on Linux.
  test.skip(
    process.platform !== 'linux' || !['/usr/bin/bwrap', '/bin/bwrap'].some(existsSync),
    'needs bubblewrap',
  );
  test.setTimeout(90_000);
  symbiote = await serveWorkspaces();
  mkdirSync(join(symbiote.repo, 'symbiote'), { recursive: true });
  writeFileSync(
    join(symbiote.repo, 'symbiote', 'config.json'),
    JSON.stringify({ merge: { checks: ['test -f one.txt'] } }),
  );
  symbiote.reviewAnswers([
    {
      write: { 'one.test.sh': TEST },
      answer: {
        summary: 'one.txt says uno.',
        ran: 'sh one.test.sh',
        findings: [
          {
            defect: 'one.txt says uno, not one',
            test: 'one says one',
            command: 'sh one.test.sh',
            files: ['one.test.sh'],
          },
        ],
      },
    },
    {
      answer: { summary: 'Fixed: one.txt says one.', ran: 'sh one.test.sh passes.', findings: [] },
    },
  ]);
  await page.goto(`${symbiote.url}git`);
  await hive(page, true);
  await page.goto(`${symbiote.url}start`);
  await startPage(page).getByRole('textbox', { name: 'Title' }).fill('One');
  await startPage(page).getByRole('textbox', { name: 'Goal' }).fill('one.txt says one.');
  await startPage(page).getByRole('textbox', { name: 'Branch name', exact: true }).fill(BRANCH);
  // Hive mode: no plan first to wait for (HV4).
  await expect(startPage(page).getByLabel('Plan first and wait for my OK')).toHaveCount(0);
  await startPage(page).getByRole('button', { name: 'Start goal' }).click();
  await expect(startPage(page)).toBeHidden();

  // The check passes; the reviewer proves the defect; its test reaches the writer.
  symbiote.commit(BRANCH, 'one.txt', 'uno\n', 'One');
  symbiote.report(BRANCH, 'Done: one.txt.');
  await expect.poll(sent, { timeout: 20_000 }).toHaveLength(1);
  expect(sent()[0]).toContain('proved 1 defect with failing tests');
  expect(sent()[0]).toContain('grep -qx one one.txt');
  expect(sent()[0]).toContain('FAIL one says one');
  const [review] = symbiote.reviewCalls();
  expect(review?.input).toContain('one.txt says one.');
  expect(review?.cwd).not.toBe(symbiote.folder(BRANCH));
  await expect(card(page).locator('.hive-row-state')).toContainText('round 2');

  // The Review tab shows round 1: the check passed, the defect proven, its test.
  await card(page).click();
  const tabs = page.getByRole('tablist', { name: 'Talk to the agent' });
  // The Run tab (V92): round 2 open, round 1 folded to a line; opened, its check passed and
  // its defect a card with its test.
  await tabs.getByRole('tab', { name: 'Run' }).click();
  const folded1 = page.locator('.run-tab').getByRole('button', { name: /^Round 1\b/ });
  await expect(folded1).toContainText('1 defect proven');
  await folded1.click();
  const round1 = page.getByRole('region', { name: 'Round 1' });
  await expect(round1.getByRole('listitem', { name: 'Check' })).toContainText('passed on');
  await expect(round1).toContainText('one.txt says uno, not one');
  await expect(round1.locator('.run-defect .status-label')).toHaveText('Proven');
  await round1.getByText('one.test.sh', { exact: true }).click();
  await expect(round1.locator('.run-defect pre').first()).toContainText('grep -qx one one.txt');
  // No branch review, no Land, no Merge into in Hive mode: Hive lands it (HV4).
  const head = page.locator('.workspace-top');
  await expect(head.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);
  await expect(head.getByRole('button', { name: 'Land' })).toHaveCount(0);
  await expect(head.getByRole('button', { name: /^Merge/ })).toHaveCount(0);

  // The writer adds the test and fixes it, once Hive's message is recorded (the fake logs a resume
  // before its hooks run): the next review approves, and Hive lands it with no press.
  await expect.poll(() => record().message?.sent, { timeout: 10_000 }).toBe(true);
  symbiote.commit(BRANCH, 'one.test.sh', TEST, 'Its test');
  symbiote.commit(BRANCH, 'one.txt', 'one\n', 'Fix');
  symbiote.report(BRANCH, 'Fixed, with its test.');
  await expect.poll(() => record().step, { timeout: 40_000 }).toBe('landed');
  // Landed today (V92, decision 868), its time at the row's end.
  const today = page.locator('.sidenav').getByRole('region', { name: 'Landed today' });
  await expect(today.locator('.hive-row')).toHaveCount(1, { timeout: 20_000 });
  await expect(today.locator('.hive-row-time')).toHaveText(/^\d\d:\d\d$/);
  expect(record().reviews.map((r) => r.verdict)).toEqual(['changes', 'approved']);
  expect(symbiote.reviewCalls()[1]?.input).toContain('In round 1, a reviewer proved');
  const round2 = page.getByRole('region', { name: 'Round 2' });
  await expect(round2).toContainText('Approved');
  const landed = page.locator('.run-tab').getByRole('status', { name: 'Landed in main' });
  await expect(landed).toContainText('Merged through the merge queue as');
  await expect(landed).toContainText(`pushed main and ${BRANCH} to origin`);
  // Nothing more reached the writer.
  expect(sent()).toHaveLength(1);
});

test("Settings: the running reviewer's model and effort on the Hive mode page, Opus at high by default; its prompt on its page", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}settings`);
  await hive(page, true);
  await page.reload();
  const group = page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('region', { name: 'Hive', exact: true });
  await group.getByRole('button', { name: 'Reviewer' }).click();
  const reviewer = page.getByRole('region', { name: 'Reviewer' });
  await expect(reviewer.getByRole('textbox', { name: 'Reviewer prompt' })).toHaveValue(
    /Report only a defect that a test of yours shows failing/,
  );
  // Its model and effort are set with Hive's limits (V92, decision 870).
  await expect(reviewer.getByRole('combobox', { name: 'Model' })).toHaveCount(0);
  await reviewer.getByRole('link', { name: 'Hive mode' }).click();
  const rows = page
    .getByRole('region', { name: 'Hive mode' })
    .getByRole('group', { name: 'Running reviewer' });
  await expect(rows.getByRole('combobox', { name: 'Model' })).toContainText('Opus 5.5 (default)');
  await expect(rows.getByRole('combobox', { name: 'Effort' })).toContainText('High (default)');
});
