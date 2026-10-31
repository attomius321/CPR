import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Hive's running reviewer (HV3): once the check passes, the fake Claude Code as the reviewer
// proves a defect with a failing test in its copy; Symbiote reruns that test (under bubblewrap)
// and sends it to the writer; the fix passes the next review; the workspace's Review tab shows
// both rounds, and Land, in place of the person's review, approves the commit and merges it.
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
const startPage = (page: Page) => page.getByRole('region', { name: 'Start a workspace' });
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

test('a defect proven by a failing test goes to the writer; its fix is approved; Land merges it', async ({
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
  await startPage(page).getByLabel('Plan first and wait for my OK').uncheck();
  await startPage(page).getByRole('button', { name: 'Start workspace' }).click();
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
  await expect(card(page).locator('.fact-hive')).toHaveAccessibleName(
    'Hive drives it: round 2 of 3',
  );

  // The Review tab shows round 1: the check passed, the defect proven, its test.
  await card(page).click();
  const tabs = page.getByRole('tablist', { name: 'Talk to the agent' });
  await tabs.getByRole('tab', { name: 'Review' }).click();
  const round1 = page.getByRole('region', { name: 'Round 1' });
  await expect(round1).toContainText('Check passed');
  await expect(round1).toContainText('1 defect proven');
  await expect(round1).toContainText('one.txt says uno, not one');
  await expect(round1.locator('.hive-finding .badge')).toHaveText('Proven');
  await round1.getByText('one.test.sh', { exact: true }).click();
  await expect(round1.locator('.hive-finding pre').first()).toContainText('grep -qx one one.txt');
  // No branch review asked in Hive mode: Land replaces it, once asked.
  const head = page.locator('.workspace-top');
  await expect(head.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);
  await expect(head.getByRole('button', { name: 'Land' })).toHaveCount(0);

  // The writer adds the test and fixes it, once Hive's message is recorded (the fake logs a resume
  // before its hooks run): the next review approves; landing is asked.
  await expect.poll(() => record().message?.sent, { timeout: 10_000 }).toBe(true);
  symbiote.commit(BRANCH, 'one.test.sh', TEST, 'Its test');
  symbiote.commit(BRANCH, 'one.txt', 'one\n', 'Fix');
  symbiote.report(BRANCH, 'Fixed, with its test.');
  await expect(card(page)).toContainText('Checked and reviewed: land it', { timeout: 20_000 });
  expect(record().reviews.map((r) => r.verdict)).toEqual(['changes', 'approved']);
  expect(symbiote.reviewCalls()[1]?.input).toContain('In round 1, a reviewer proved');
  const round2 = page.getByRole('region', { name: 'Round 2' });
  await expect(round2).toContainText('Approved');
  await expect(page.locator('.hive-now')).toHaveText('Checked and reviewed: land it');

  // Land: the commit approved and merged into main by the merge queue.
  await head.getByRole('button', { name: 'Land' }).click();
  await expect(card(page)).toContainText('Merged', { timeout: 30_000 });
  await expect.poll(() => record().step, { timeout: 10_000 }).toBe('landed');
  expect(sent()).toHaveLength(1);
});

test("Settings: the running reviewer's page in Hive's group, Opus at high by default", async ({
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
  await expect(reviewer.getByRole('combobox', { name: 'Model' })).toContainText(
    "Symbiote's default (Opus 5.5)",
  );
  await expect(reviewer.getByRole('slider', { name: 'Effort' })).toHaveAttribute(
    'aria-valuetext',
    "Symbiote's default (high)",
  );
  await expect(reviewer.getByRole('textbox', { name: 'Reviewer prompt' })).toHaveValue(
    /Report only a defect that a test of yours shows failing/,
  );
});
