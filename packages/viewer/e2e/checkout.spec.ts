import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './cpr.js';

// Checking out from the commits page (V11). Each test gets its own repository: checkouts change
// its working tree.
let cpr: RunningCommits;
const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  cpr = await serveCommits();
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  cpr.stop();
  expect(errors).toEqual([]);
});

const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);
const row = (page: Page, subject: string) =>
  page.locator('.commit', {
    has: page.locator('.commit-subject').getByText(new RegExp(`^${subject}(,|$)`)),
  });
const head = () =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: cpr.repo, encoding: 'utf8' }).trim();
const menuOf = async (page: Page, subject: string) => {
  await row(page, subject).click({ button: 'right' });
  return page.getByRole('menuitem');
};

test('offers what each row can check out', async ({ page }) => {
  await page.goto(cpr.url);
  const detached = 'Check out this commit (detached HEAD)';
  const cases: [string, string[]][] = [
    ['Add half', ['Check out branch mainchecked out', detached]],
    ['Try a wobble', ['Check out branch wip', detached]],
    ['Sketch a topic', ['Check out origin/topic as topic', detached]],
    ['Add cube', ['Check out tag v1 (detached HEAD)', detached]],
  ];
  for (const [subject, entries] of cases) {
    await expect(await menuOf(page, subject)).toHaveText(entries);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  await expect(page.getByRole('menuitem', { name: /branch main/ })).toHaveCount(0);
});

test('checks out a branch: HEAD, lane 0 and the cursor follow', async ({ page }) => {
  const [, , square] = cpr.shas;
  await page.goto(cpr.url);
  await (await menuOf(page, 'Try a wobble')).getByText('Check out branch wip').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Check out branch wip?');
  await expect(dialog).toContainText(/Checks out the branch wip, at [0-9a-f]{7}\./);
  await dialog.getByRole('button', { name: 'Check out' }).click();

  await expect(page.getByRole('status')).toHaveText('Switched to branch wip');
  await expect(row(page, 'Try a wobble').locator('.ref')).toHaveText(['HEAD', 'wip']);
  await expect(row(page, 'Try a wobble').locator('.commit-dot')).toHaveClass(/lane-0/);
  await expect(row(page, 'Add half').locator('.commit-dot')).not.toHaveClass(/lane-0/);
  await expect(page.locator('.commit.cursor .commit-subject')).toHaveText('Try a wobble');
  await expect(page.getByRole('button', { name: 'This branch (wip)' })).toBeVisible();
  expect(
    execFileSync('git', ['branch', '--show-current'], { cwd: cpr.repo, encoding: 'utf8' }),
  ).toBe('wip\n');
  expect(
    execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: cpr.repo, encoding: 'utf8' }).trim(),
  ).toBe(square);
});

test('checks out a remote branch as a local one from the keyboard, and a tag detached', async ({
  page,
}) => {
  const [, , , cube] = cpr.shas;
  await page.goto(cpr.url);
  // The cursor starts on HEAD, row 2; row 0 is origin/topic's.
  await expect(page.locator('.commit.cursor .commit-subject')).toHaveText(/^Add half/);
  await page.keyboard.press('k');
  await page.keyboard.press('k');
  await page.keyboard.press('c');
  await expect(page.getByRole('menuitem').first()).toHaveText('Check out origin/topic as topic');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText(
    /Creates the branch topic at [0-9a-f]{7}, tracking origin\/topic, and checks it out\./,
  );
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText(
    'Created the branch topic, tracking origin/topic, and switched to it',
  );
  await expect(row(page, 'Sketch a topic').locator('.ref')).toHaveText([
    'HEAD',
    'topic',
    'origin/topic',
  ]);

  await (await menuOf(page, 'Add cube')).getByText('Check out tag v1').click();
  await expect(page.getByRole('dialog')).toContainText(
    `Detaches HEAD at ${short(cube)} (tag v1): commits made there belong to no branch`,
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Check out' }).click();
  await expect(page.getByRole('status')).toHaveText(`HEAD is now at ${short(cube)} (detached)`);
  await expect(page.getByRole('button', { name: 'This branch', exact: true })).toBeVisible();
  expect(head()).toBe(cube);
});

test("shows git's refusal and changes nothing", async ({ page }) => {
  const half = cpr.shas[4];
  appendFileSync(join(cpr.repo, 'src/math.ts'), '// a local change\n');
  await page.goto(cpr.url);
  await (await menuOf(page, 'base')).getByText('Check out this commit').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(
    '1 file has uncommitted changes: it comes along, unless the target changes it too',
  );
  await dialog.getByRole('button', { name: 'Check out' }).click();
  await expect(dialog.locator('pre.error')).toContainText(
    'Your local changes to the following files would be overwritten by checkout',
  );
  await expect(dialog.locator('pre.error')).toContainText('src/math.ts');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(head()).toBe(half);
  await expect(row(page, 'Add half').locator('.ref').first()).toHaveText('HEAD');
});

test('shows a checkout made elsewhere when the page is back', async ({ page }) => {
  await page.goto(cpr.url);
  await expect(row(page, 'Add half').locator('.ref').first()).toHaveText('HEAD');
  execFileSync('git', ['switch', '-q', 'wip'], { cwd: cpr.repo });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(row(page, 'Try a wobble').locator('.ref')).toHaveText(['HEAD', 'wip']);
  await expect(page.locator('.commit.cursor .commit-subject')).toHaveText('Try a wobble');
});
