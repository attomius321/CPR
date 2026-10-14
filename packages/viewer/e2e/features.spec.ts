import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveFeatures, type RunningFeatures } from './cpr.js';

// Starting a feature from the commits page (V18a): a branch, its worktree beside the repository,
// the record, and the agent started there — a fake Claude Code, never a real one.
let cpr: RunningFeatures;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  cpr.stop();
  expect(errors).toEqual([]);
});

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: cpr.repo, encoding: 'utf8' }).trim();
const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Start a feature' });
const brief = (page: Page) => dialog(page).getByLabel('What should the agent build?');
const branch = (page: Page) => dialog(page).getByRole('textbox', { name: 'Branch', exact: true });
const row = (page: Page, subject: string) =>
  page.locator('.commit', {
    has: page.locator('.commit-subject').getByText(subject, { exact: true }),
  });

test('starts a feature from the header: its branch, its worktree, the agent there', async ({
  page,
}) => {
  cpr = await serveFeatures();
  const main = cpr.shas.at(-1);
  await page.goto(cpr.url);
  await page.getByRole('button', { name: 'Start a feature' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(brief(page)).toBeFocused();
  await brief(page).fill('Add a half function\n\nReturn a / 2, and test it.');
  // Named after the brief's first line; where it starts and where its worktree goes.
  await expect(branch(page)).toHaveValue('feature/add-a-half-function');
  const folder = `${cpr.repo}.worktrees/feature-add-a-half-function`;
  await expect(dialog(page)).toContainText(`From main at ${short(main)}, in ${folder}`);
  await expect(dialog(page)).toContainText('Claude Code · your Pro subscription');
  await expect(dialog(page).getByLabel('Plan first and wait for my OK')).toBeChecked();
  await dialog(page).getByRole('button', { name: 'Start', exact: true }).click();

  // The page lists the new branch, the cursor on it, and says where the agent works.
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole('status')).toHaveText(
    `Started feature/add-a-half-function: Claude Code is working in ${folder}.`,
  );
  await expect(page.locator('.commit.cursor')).toContainText('feature/add-a-half-function');

  // git: the branch at main's tip, checked out in its worktree; the checkout untouched.
  expect(git('rev-parse', 'feature/add-a-half-function')).toBe(main);
  expect(git('branch', '--show-current')).toBe('main');
  expect(git('status', '--porcelain')).toBe('');
  expect(
    execFileSync('git', ['branch', '--show-current'], { cwd: folder, encoding: 'utf8' }).trim(),
  ).toBe('feature/add-a-half-function');
  // The agent: started in the background, in the worktree, with the brief and plan first.
  const [call, ...more] = cpr.calls();
  expect(more).toEqual([]);
  expect(call?.cwd).toBe(folder);
  expect(call?.args.slice(0, 5)).toEqual([
    '--bg',
    '--name',
    'feature/add-a-half-function',
    '--add-dir',
    join(cpr.repo, 'cpr'),
  ]);
  expect(call?.args.at(-1)).toContain('Return a / 2, and test it.');
  expect(call?.args.at(-1)).toContain("then stop and wait for the person's OK");
  // The record, beside the reviews.
  const record = JSON.parse(
    readFileSync(join(cpr.repo, 'cpr/features/feature/add-a-half-function.json'), 'utf8'),
  ) as { base: string; planFirst: boolean; worktree: string; by: string };
  expect(record).toMatchObject({
    base: main,
    planFirst: true,
    worktree: folder,
    by: 'reviewer@example.com',
  });
});

test('n starts one too; a name in use is refused before Start; Escape cancels', async ({
  page,
}) => {
  cpr = await serveFeatures();
  await page.goto(cpr.url);
  await expect(page.locator('.commit').first()).toBeVisible();
  await page.keyboard.press('n');
  await expect(dialog(page)).toBeVisible();
  await brief(page).fill('Something');
  await branch(page).fill('main');
  await expect(dialog(page)).toContainText('a branch main exists');
  await expect(dialog(page).getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await branch(page).fill('feature/a..b');
  await expect(dialog(page)).toContainText('not a valid branch name: feature/a..b');
  // A permission mode other than Claude Code's default goes to the agent.
  await branch(page).fill('feature/something');
  await dialog(page).getByLabel('permission').selectOption({ label: 'Auto' });
  await brief(page).press('Escape');
  await expect(dialog(page)).toBeHidden();
  expect(cpr.calls()).toEqual([]);

  await page.keyboard.press('n');
  await brief(page).fill('Something else');
  await dialog(page).getByLabel('permission').selectOption({ label: 'Auto' });
  await brief(page).press('Control+Enter');
  await expect(page.getByRole('status')).toContainText('Started feature/something-else');
  expect(cpr.calls()[0]?.args).toEqual(expect.arrayContaining(['--permission-mode', 'auto']));
});

test("Start a feature here: the row's commit is where it starts", async ({ page }) => {
  cpr = await serveFeatures();
  const [base] = cpr.shas;
  await page.goto(cpr.url);
  await row(page, 'base').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start a feature here' }).click();
  await expect(dialog(page)).toContainText(`From the commit ${short(base)}`);
  await brief(page).fill('Fix from the base');
  await dialog(page).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Started feature/fix-from-the-base');
  expect(git('rev-parse', 'feature/fix-from-the-base')).toBe(base);
  await expect(page.locator('.commit.cursor')).toContainText('feature/fix-from-the-base');
});

test("an agent that does not start: the feature stays, with Claude Code's words and the prompt", async ({
  page,
}) => {
  cpr = await serveFeatures();
  cpr.distrust();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(cpr.url);
  await page.getByRole('button', { name: 'Start a feature' }).click();
  await brief(page).fill('Add a half function');
  await dialog(page).getByRole('button', { name: 'Start', exact: true }).click();
  const folder = `${cpr.repo}.worktrees/feature-add-a-half-function`;
  const status = page.getByRole('status');
  await expect(status).toContainText(
    `Made feature/add-a-half-function in ${folder}, but Claude Code did not start.`,
  );
  await expect(status).toContainText(
    `Workspace not trusted. Run \`claude\` in ${folder} once and accept the trust prompt`,
  );
  expect(existsSync(folder)).toBe(true);
  await status.getByRole('button', { name: 'Copy the prompt' }).click();
  await expect(status.getByRole('button', { name: 'Copied' })).toBeVisible();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('Add a half function');
  expect(prompt).toContain('feature/add-a-half-function');
});

test('without an agent: the branch and worktree are made, and the prompt is given', async ({
  page,
}) => {
  cpr = await serveFeatures({ agent: false });
  await page.goto(cpr.url);
  await page.getByRole('button', { name: 'Start a feature' }).click();
  await expect(dialog(page)).toContainText('No agent found');
  await brief(page).fill('Add a half function');
  await dialog(page).getByRole('button', { name: 'Make the branch' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Made feature/add-a-half-function in ' +
      `${cpr.repo}.worktrees/feature-add-a-half-function. No agent was found to start`,
  );
  await expect(
    page.getByRole('status').getByRole('button', { name: 'Copy the prompt' }),
  ).toBeVisible();
  expect(git('rev-parse', 'feature/add-a-half-function')).toBe(cpr.shas.at(-1));
});
