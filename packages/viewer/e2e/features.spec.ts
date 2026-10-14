import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

// The features view (V18b): what each feature needs, and each feature and its branch leading to
// the other.
const POLL = { timeout: 12_000 };
const featureRow = (page: Page, branch: string) =>
  page.locator(`.feature-row[data-branch="${branch}"]`);
const group = (page: Page, name: string) => page.getByRole('region', { name });
const startFrom = async (page: Page, what: string) => {
  await page.getByRole('button', { name: 'Start a feature' }).click();
  await brief(page).fill(what);
  await brief(page).press('Control+Enter');
  await expect(dialog(page)).toBeHidden();
};

test('the features view: what each feature needs, as its agent goes on', async ({ page }) => {
  cpr = await serveFeatures();
  await page.goto(`${cpr.url}features`);
  await expect(page.getByText('No features yet')).toBeVisible();
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const row = featureRow(page, branch);
  await expect(group(page, 'Working').locator(row)).toContainText('Working');
  await expect(page.getByRole('link', { name: 'Features', exact: true })).toBeVisible();

  // The agent asks for a permission: it needs you, and the tab counts it.
  cpr.session(branch, { state: 'blocked', waitingFor: 'permission prompt' });
  await expect(group(page, 'Needs you').locator(row)).toContainText(
    'Waiting: permission prompt',
    POLL,
  );
  await expect(page.locator('.page-tabs .page-count')).toHaveText('1');

  // It commits, leaves a file uncommitted and finishes: ready for review.
  cpr.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  writeFileSync(join(cpr.folder(branch), 'notes.md'), 'todo\n');
  // Claude Code's sessions are read at most every 2 s: the page's next look sees it.
  cpr.session(branch, { state: 'done' });
  await expect(row).toContainText('Ready for review', POLL);
  await expect(row).toContainText('1 commit');
  await expect(row).toContainText('1 file not committed yet');
  await expect(row).toContainText('Merges cleanly into main');
});

test('a feature and its branch lead to each other', async ({ page }) => {
  cpr = await serveFeatures();
  await page.goto(cpr.url);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  cpr.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  cpr.session(branch, { state: 'done' });
  await page.reload();

  // The branch's mark on the commits page goes to its feature, shown and flashed.
  const mark = page.locator('.commit .ref', { hasText: branch }).locator('.feature-mark');
  // Claude Code's sessions are read at most every 2 s: the page's next look sees it.
  await expect(mark).toHaveText('●', POLL);
  await expect(mark).toHaveAttribute('title', /Feature: Add a half function — Ready for review/);
  await mark.click();
  await expect(page).toHaveURL(`${cpr.url}features?branch=feature%2Fadd-a-half-function`);
  await expect(featureRow(page, branch)).toBeInViewport();

  // The branch on the feature goes to its tip on the commits page.
  await featureRow(page, branch).getByRole('link', { name: branch }).click();
  await expect(page).toHaveURL(`${cpr.url}?branch=feature%2Fadd-a-half-function`);
  await expect(page.locator('.commit.cursor')).toContainText('Add half');

  // The tip's menu: "Open its feature"; the branches panel shows the mark too.
  await expect(page.locator('.branches li.has-feature .feature-mark')).toHaveText('●');
  await page.locator('.commit.cursor').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open its feature' }).click();
  await expect(page).toHaveURL(/\/features\?branch=/);

  // Its review names the feature, which leads back.
  await featureRow(page, branch).getByRole('button', { name: 'Review' }).click();
  const link = page.getByRole('link', { name: 'Feature: Add a half function' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(featureRow(page, branch)).toBeVisible();
});

test("an agent's commit shows on the commits page as it comes, the cursor where it was", async ({
  page,
}) => {
  cpr = await serveFeatures();
  await page.goto(cpr.url);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  // The cursor on the older commit, while the agent works.
  await row(page, 'base').click();
  await expect(row(page, 'base')).toHaveClass(/cursor/);
  cpr.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  await expect(row(page, 'Add half')).toBeVisible(POLL);
  await expect(row(page, 'base')).toHaveClass(/cursor/);
});

test('stop the agent, start it again, copy its prompt, open its worktree', async ({ page }) => {
  cpr = await serveFeatures();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${cpr.url}features`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const row = featureRow(page, branch);

  await row.getByRole('button', { name: 'Stop the agent' }).click();
  await expect(row).toContainText('Stopped');
  expect(cpr.stops()).toEqual(['fake0']);
  await row.getByRole('button', { name: 'Start the agent' }).click();
  await expect(row).toContainText('Working');
  expect(cpr.calls()).toHaveLength(2);

  await row.getByRole('button', { name: 'Copy the prompt' }).click();
  await expect(row.getByRole('status')).toHaveText('Copied the prompt');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'Add a half function',
  );

  await row.getByRole('button', { name: 'Talk' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('claude attach fake1');

  await row.getByRole('button', { name: 'Open in VS Code' }).click();
  await expect(row.getByRole('status')).toHaveText('Opened in VS Code');
  expect(cpr.opened()).toEqual([[cpr.folder(branch)]]);
});

test("a feature's branch: checked out in its worktree, so not here; gone, it says so", async ({
  page,
}) => {
  cpr = await serveFeatures();
  await page.goto(cpr.url);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  await page.locator('.commit.cursor').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Check out', exact: true }).hover();
  await expect(page.getByRole('menuitem', { name: `Check out branch ${branch}` })).toBeDisabled();
  await expect(page.getByRole('menu', { name: 'Check out' })).toContainText(
    `checked out in ${cpr.folder(branch)}`,
  );
  await page.keyboard.press('Escape');

  // Deleted in a terminal: the feature says so; no mark anywhere.
  git('worktree', 'remove', '--force', cpr.folder(branch));
  git('branch', '-D', branch);
  await page.goto(`${cpr.url}features`);
  await expect(featureRow(page, branch)).toContainText('Its branch is gone');
  await expect(featureRow(page, branch).getByRole('link', { name: branch })).toHaveCount(0);
  await page.goto(cpr.url);
  await expect(page.locator('.commit').first()).toBeVisible();
  await expect(page.locator('.feature-mark')).toHaveCount(0);
});
