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
/** The picked feature's panel, beside the list (V18c). */
const panel = (page: Page, branch: string) =>
  page.getByRole('region', { name: `Feature ${branch}` });
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
  await panel(page, branch).getByRole('button', { name: 'Review', exact: true }).click();
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
  const row = panel(page, branch);

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

// Talking to the agent (V18c): the features view as a list and a panel, the thread CPR's hooks
// record, one box whose message continues the agent's session.
const box = (page: Page, branch: string) =>
  panel(page, branch).getByRole('textbox', { name: 'Reply to the agent' });
const resumes = () => cpr.calls().filter((call) => call.args[1] === '--resume');

test("the panel: the agent's plan, a reply that continues its session, its next report", async ({
  page,
}) => {
  cpr = await serveFeatures();
  await page.goto(`${cpr.url}features`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const here = panel(page, branch);
  // Started with CPR's hooks: the prompt it got is the thread's first entry.
  expect(cpr.calls()[0]?.args).toEqual(
    expect.arrayContaining(['--settings', join(cpr.repo, 'cpr/claude-settings.json')]),
  );
  await expect(here.getByText("CPR's prompt")).toBeVisible(POLL);

  // It plans and stops: Claude Code says blocked; the thread has its report.
  // A plan longer than the thread's box (as real plans are).
  const steps = Array.from({ length: 40 }, (_, i) => `${i + 2}. Another step`).join('\n');
  cpr.report(branch, `Plan\n1. Add half(a) to src/half.ts\n${steps}\nCheck: a unit test`);
  await expect(here.locator('.thread-agent')).toContainText('1. Add half(a) to src/half.ts', POLL);
  await expect(featureRow(page, branch)).toContainText('Plan ready: read it and answer', POLL);

  // The reply: the live session stopped, then continued with the text and no other flag.
  await box(page, branch).fill('OK, name it half.');
  await box(page, branch).press('Control+Enter');
  await expect(here.locator('.thread-you')).toContainText('OK, name it half.', POLL);
  expect(cpr.stops()).toEqual(['fake0']);
  expect(resumes()).toEqual([
    { args: ['--bg', '--resume', 'session-0', 'OK, name it half.'], cwd: cpr.folder(branch) },
  ]);
  await expect(here.locator('.thread-line')).toHaveText('Continued');
  // The newest is in view: the thread opens at its end, and follows it.
  await expect(here.locator('.thread-you')).toBeInViewport();
  await expect(box(page, branch)).toHaveValue('');
  await expect(featureRow(page, branch)).toContainText('Working', POLL);

  // What it waits on shows in the thread; Talk answers it.
  cpr.hook(branch, {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  });
  cpr.session(branch, { state: 'blocked', waitingFor: 'permission prompt' });
  await expect(here.locator('.thread-waits')).toHaveText(
    'Waiting: permission to run npm test',
    POLL,
  );
});

test('a working agent: Stop and send asks first, then ends its turn to send', async ({ page }) => {
  cpr = await serveFeatures();
  await page.goto(`${cpr.url}features`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const here = panel(page, branch);
  await box(page, branch).fill('Use a / 2, not a * 0.5.');
  await here.getByRole('button', { name: 'Stop and send' }).click();
  await expect(here).toContainText("Sending stops the agent's turn");
  expect(cpr.stops()).toEqual([]);
  await here.getByRole('button', { name: 'Stop it and send' }).click();
  await expect(here.locator('.thread-you')).toContainText('Use a / 2, not a * 0.5.', POLL);
  expect(cpr.stops()).toEqual(['fake0']);
  expect(resumes()).toHaveLength(1);
});

test('Send the verdict: a review fills the box, from the panel and from the Review tab', async ({
  page,
}) => {
  cpr = await serveFeatures();
  await page.goto(`${cpr.url}features`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  cpr.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  cpr.report(branch, 'Done: half() in src/half.ts.');
  await expect(featureRow(page, branch)).toContainText('Ready for review', POLL);

  // Changes requested in its review; the Review tab sends them to the agent's box.
  await panel(page, branch).getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByLabel('Review summary').fill('Name it halve.');
  await page.getByLabel('Request changes').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await page.locator('.finished').getByRole('link', { name: 'Send to the agent' }).click();
  await expect(page).toHaveURL(/\/features\?branch=feature%2Fadd-a-half-function&send=verdict$/);
  await expect(box(page, branch)).toHaveValue(/Address this review of the branch/, POLL);
  await expect(box(page, branch)).toHaveValue(/Name it halve\./);
  await panel(page, branch).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel(page, branch).locator('.thread-you')).toContainText('Name it halve.', POLL);
  expect(resumes()[0]?.args[3]).toContain('Address this review of the branch');
  // Sent: the panel no longer offers it.
  await expect(panel(page, branch).getByRole('button', { name: 'Send the verdict' })).toHaveCount(
    0,
  );

  // A newer verdict, read again: the panel offers it.
  const review = join(
    cpr.repo,
    'cpr/reviews/feature/add-a-half-function/reviewer@example.com.json',
  );
  const file = JSON.parse(readFileSync(review, 'utf8')) as { verdicts: { at: string }[] };
  file.verdicts.push({ ...file.verdicts[0], at: new Date(Date.now() + 60_000).toISOString() });
  writeFileSync(review, JSON.stringify(file));
  await page.reload();
  await panel(page, branch).getByRole('button', { name: 'Send the verdict' }).click();
  await expect(box(page, branch)).toHaveValue(/Name it halve\./);
});

test('a feature started before its messages were kept: a note, and the box still sends', async ({
  page,
}) => {
  cpr = await serveFeatures();
  await page.goto(`${cpr.url}features`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const record = join(cpr.repo, 'cpr/features/feature/add-a-half-function.json');
  const saved = JSON.parse(readFileSync(record, 'utf8')) as { agent: { hooks?: boolean } };
  delete saved.agent.hooks;
  writeFileSync(record, JSON.stringify(saved));
  cpr.session(branch, { state: 'done' });
  await page.reload();
  await expect(panel(page, branch)).toContainText(
    "CPR keeps an agent's messages from V18c on: Talk shows this one's.",
  );
  // Claude Code's sessions are read at most every 2 s: wait for the page's next look.
  await expect(featureRow(page, branch)).toContainText('Plan ready', POLL);
  await box(page, branch).fill('Go on.');
  await box(page, branch).press('Control+Enter');
  await expect(panel(page, branch).getByRole('status')).toContainText('Sent', POLL);
  expect(resumes()).toHaveLength(1);
});

test('narrow: the panel takes the page, and Features goes back to the list', async ({ page }) => {
  cpr = await serveFeatures();
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(`${cpr.url}features`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  await expect(panel(page, branch)).toBeVisible();
  await expect(featureRow(page, branch)).toBeHidden();
  await panel(page, branch).getByRole('button', { name: '← Features' }).click();
  await expect(featureRow(page, branch)).toBeVisible();
  await expect(panel(page, branch)).toBeHidden();
  await expect(page).toHaveURL(`${cpr.url}features`);
  // The brief picks it (the branch name is a link to its commits).
  await featureRow(page, branch).getByRole('button', { name: 'Add a half function' }).click();
  await expect(panel(page, branch)).toBeVisible();
  await page.reload();
  await expect(panel(page, branch)).toBeVisible();
});

test('Clean up: once merged, its sessions, worktree and branch go, and so does the feature', async ({
  page,
}) => {
  cpr = await serveFeatures();
  await page.goto(`${cpr.url}features`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  cpr.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  cpr.session(branch, { state: 'done' });
  git('merge', '--quiet', '--ff-only', branch);
  await page.reload();
  await expect(featureRow(page, branch)).toContainText('Merged', POLL);
  await panel(page, branch).getByRole('button', { name: 'Clean up' }).click();
  await expect(featureRow(page, branch)).toHaveCount(0, POLL);
  expect(cpr.removed()).toEqual(['fake0']);
  expect(existsSync(cpr.folder(branch))).toBe(false);
  expect(git('branch', '--list', branch)).toBe('');
  await expect(page.getByText('No features yet')).toBeVisible();
});
