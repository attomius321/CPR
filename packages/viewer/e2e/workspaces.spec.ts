import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';
import { textAt } from './terminal.js';

// Starting a workspace from the commits page (V18a): a branch, its worktree beside the repository,
// the record, and the agent started there — a fake Claude Code, never a real one.
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

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: symbiote.repo, encoding: 'utf8' }).trim();
const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);
const startPage = (page: Page) => page.getByRole('region', { name: 'Start a workspace' });
const title = (page: Page) => startPage(page).getByRole('textbox', { name: 'Title' });
const goal = (page: Page) => startPage(page).getByRole('textbox', { name: 'Goal' });
/** A Feature's title, and its goal (V24c). */
const fillWork = async (page: Page, what: string, why = what) => {
  await title(page).fill(what);
  await goal(page).fill(why);
};
const branch = (page: Page) =>
  startPage(page).getByRole('textbox', { name: 'Branch', exact: true });
const row = (page: Page, subject: string) =>
  page.locator('.commit', {
    has: page.locator('.commit-subject').getByText(subject, { exact: true }),
  });

test('starts a workspace from the header: its branch, its worktree, the agent there', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const main = symbiote.shas.at(-1);
  await page.goto(`${symbiote.url}history`);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await expect(startPage(page)).toBeVisible();
  await expect(title(page)).toBeFocused();
  await fillWork(page, 'Add a half function', 'Return a / 2, and test it.');
  // Named after the title; where it starts and where its worktree goes.
  await expect(branch(page)).toHaveValue('feature/add-a-half-function');
  const folder = `${symbiote.repo}.worktrees/feature-add-a-half-function`;
  await expect(startPage(page)).toContainText(`From main at ${short(main)}`);
  // The worktree's path is in Branch's help (V37, decision 248).
  await startPage(page).getByRole('button', { name: 'Where its worktree goes' }).click();
  await expect(page.getByRole('tooltip')).toContainText(folder);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  // The agent, the only one installed, and whose account it runs on.
  await expect(startPage(page).locator('.start-value')).toHaveText('Claude Code');
  await expect(startPage(page)).toContainText('your Pro subscription');
  await expect(startPage(page).getByLabel('Plan first and wait for my OK')).toBeChecked();
  await startPage(page).getByRole('button', { name: 'Start', exact: true }).click();

  // The new workspace opens (V29a), and the status bar says where the agent works.
  await expect(startPage(page)).toBeHidden();
  await expect(page.getByRole('status')).toHaveText(
    `Started feature/add-a-half-function: Claude Code is working in ${folder}.`,
  );
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-a-half-function`);
  await expect(panel(page, 'feature/add-a-half-function')).toBeVisible();

  // git: the branch at main's tip, checked out in its worktree; the checkout untouched.
  expect(git('rev-parse', 'feature/add-a-half-function')).toBe(main);
  expect(git('branch', '--show-current')).toBe('main');
  expect(git('status', '--porcelain')).toBe('');
  expect(
    execFileSync('git', ['branch', '--show-current'], { cwd: folder, encoding: 'utf8' }).trim(),
  ).toBe('feature/add-a-half-function');
  // The agent: started in the background, in the worktree, with the brief and plan first.
  const [call, ...more] = symbiote.calls();
  expect(more).toEqual([]);
  expect(call?.cwd).toBe(folder);
  expect(call?.args.slice(0, 5)).toEqual([
    '--bg',
    '--name',
    'feature/add-a-half-function',
    '--add-dir',
    join(symbiote.repo, 'symbiote'),
  ]);
  expect(call?.args.at(-1)).toContain(
    '# Feature: Add a half function\n\n## Goal\nReturn a / 2, and test it.\n',
  );
  expect(call?.args.at(-1)).toContain("then stop and wait for the person's OK");
  // The record, beside the reviews.
  const record = JSON.parse(
    readFileSync(
      join(symbiote.repo, 'symbiote/workspaces/feature/add-a-half-function.json'),
      'utf8',
    ),
  ) as { base: string; planFirst: boolean; worktree: string; by: string };
  expect(record).toMatchObject({
    kind: 'feature',
    title: 'Add a half function',
    parts: { goal: 'Return a / 2, and test it.' },
    base: main,
    planFirst: true,
    worktree: folder,
    by: 'reviewer@example.com',
  });
});

test('n starts one too; a name in use is refused before Start; Escape cancels', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await page.keyboard.press('n');
  await expect(startPage(page)).toBeVisible();
  await fillWork(page, 'Something');
  await branch(page).fill('main');
  await expect(startPage(page)).toContainText('a branch main exists');
  await expect(startPage(page).getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await branch(page).fill('feature/a..b');
  await expect(startPage(page)).toContainText('not a valid branch name: feature/a..b');
  // A permission mode other than Claude Code's default goes to the agent.
  await branch(page).fill('feature/something');
  await startPage(page).getByLabel('permission').selectOption({ label: 'Auto' });
  await title(page).press('Escape');
  await expect(startPage(page)).toBeHidden();
  expect(symbiote.calls()).toEqual([]);

  // Escape keeps the draft (V24c), the branch typed included; Clear empties it.
  await page.keyboard.press('n');
  await expect(title(page)).toHaveValue('Something');
  await expect(branch(page)).toHaveValue('feature/something');
  await startPage(page).getByRole('button', { name: 'Clear' }).click();
  await expect(title(page)).toHaveValue('');
  await fillWork(page, 'Something else');
  await startPage(page).getByLabel('permission').selectOption({ label: 'Auto' });
  await title(page).press('Control+Enter');
  await expect(page.getByRole('status')).toContainText('Started feature/something-else');
  expect(symbiote.calls()[0]?.args).toEqual(expect.arrayContaining(['--permission-mode', 'auto']));
});

test("Start a workspace here: the row's commit is where it starts", async ({ page }) => {
  symbiote = await serveWorkspaces();
  const [base] = symbiote.shas;
  await page.goto(`${symbiote.url}history`);
  await row(page, 'base').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start a workspace here' }).click();
  await expect(startPage(page)).toContainText(`From the commit ${short(base)}`);
  await fillWork(page, 'Fix from the base');
  await startPage(page).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Started feature/fix-from-the-base');
  expect(git('rev-parse', 'feature/fix-from-the-base')).toBe(base);
  await expect(panel(page, 'feature/fix-from-the-base')).toBeVisible();
});

test("an agent that does not start: the workspace stays, with Claude Code's words and the prompt", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  symbiote.distrust();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${symbiote.url}history`);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await fillWork(page, 'Add a half function');
  await startPage(page).getByRole('button', { name: 'Start', exact: true }).click();
  const folder = `${symbiote.repo}.worktrees/feature-add-a-half-function`;
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
  symbiote = await serveWorkspaces({ agent: false });
  await page.goto(`${symbiote.url}history`);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await expect(startPage(page)).toContainText('No agent found');
  await fillWork(page, 'Add a half function');
  await startPage(page).getByRole('button', { name: 'Make the branch' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Made feature/add-a-half-function in ' +
      `${symbiote.repo}.worktrees/feature-add-a-half-function. No agent was found to start`,
  );
  await expect(
    page.getByRole('status').getByRole('button', { name: 'Copy the prompt' }),
  ).toBeVisible();
  expect(git('rev-parse', 'feature/add-a-half-function')).toBe(symbiote.shas.at(-1));
});

// The workspaces view (V18b): what each workspace needs, and each workspace and its branch leading
// to the other.
const POLL = { timeout: 12_000 };
const workspaceRow = (page: Page, branch: string) =>
  page.locator(`.workspace-row[data-branch="${branch}"]`);
const group = (page: Page, name: string) => page.getByRole('region', { name });
/** The picked workspace's panel, beside the list (V18c). */
const panel = (page: Page, branch: string) =>
  page.getByRole('region', { name: `Workspace ${branch}` });
/** One of a workspace's less frequent actions, in its ⋯ menu (V29a). */
const more = async (page: Page, branch: string, name: string) => {
  await panel(page, branch).getByRole('button', { name: 'More actions' }).click();
  await panel(page, branch).getByRole('menuitem', { name, exact: true }).click();
};
const startFrom = async (page: Page, what: string) => {
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await fillWork(page, what);
  await goal(page).press('Control+Enter');
  await expect(startPage(page)).toBeHidden();
};

test('the workspaces view: what each workspace needs, as its agent goes on', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await expect(page.getByText('No workspaces yet')).toBeVisible();
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const row = workspaceRow(page, branch);
  await expect(group(page, 'Working').locator(row)).toContainText('Working');

  // The agent asks for a permission: it needs you, and the sidenav counts it.
  symbiote.session(branch, { state: 'blocked', waitingFor: 'permission prompt' });
  await expect(group(page, 'Needs you').locator(row)).toContainText(
    'Waiting: permission prompt',
    POLL,
  );
  await expect(page.locator('.sidenav .page-count')).toHaveText('1');

  // Esc in its session: no hook fires and Claude Code still says `working`, but it waits.
  symbiote.interrupt(branch);
  await expect(group(page, 'Needs you').locator(row)).toContainText(
    'Interrupted: waiting for you',
    POLL,
  );

  // It commits, leaves a file uncommitted and finishes: ready for review.
  symbiote.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  writeFileSync(join(symbiote.folder(branch), 'notes.md'), 'todo\n');
  // Claude Code's sessions are read at most every 2 s: the page's next look sees it.
  symbiote.session(branch, { state: 'done' });
  await expect(row).toContainText('Ready for review', POLL);
  await expect(row).toContainText('1 commit');
  await expect(row).toContainText('1 file not committed yet');
  await expect(row).toContainText('Merges cleanly into main');
});

test('a workspace and its branch lead to each other', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  symbiote.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  symbiote.session(branch, { state: 'done' });
  await page.goto(`${symbiote.url}history`);

  // The branch's mark on the commits page goes to its workspace, its card in view.
  const mark = page.locator('.commit .ref', { hasText: branch }).locator('.workspace-mark');
  // Claude Code's sessions are read at most every 2 s: the page's next look sees it.
  await expect(mark).toHaveText('●', POLL);
  await expect(mark).toHaveAttribute('title', /Workspace: Add a half function — Ready for review/);
  await mark.click();
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-a-half-function`);
  await expect(workspaceRow(page, branch)).toBeInViewport();

  // The branch on the workspace goes to its tip on the commits page.
  await workspaceRow(page, branch).getByRole('link', { name: branch }).click();
  await expect(page).toHaveURL(`${symbiote.url}history?branch=feature%2Fadd-a-half-function`);
  await expect(page.locator('.commit.cursor')).toContainText('Add half');

  // The tip's menu: "Open its workspace"; the branches panel shows the mark too.
  await expect(page.locator('.branches li.has-workspace .workspace-mark')).toHaveText('●');
  await page.locator('.commit.cursor').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open its workspace' }).click();
  await expect(page).toHaveURL(/\/\?branch=/);

  // Its review names the workspace, which leads back.
  await panel(page, branch).getByRole('button', { name: 'Review', exact: true }).click();
  const link = page.getByRole('link', { name: 'Workspace: Add a half function' });
  await expect(link).toBeVisible();
  // Opened from the workspace, its way back is there (V25).
  await expect(page.getByRole('link', { name: 'Back to Workspace' })).toHaveAttribute(
    'href',
    '/?branch=feature%2Fadd-a-half-function',
  );
  await link.click();
  await expect(workspaceRow(page, branch)).toBeVisible();
});

test("an agent's commit shows on the commits page as it comes, the cursor where it was", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  await page.goto(`${symbiote.url}history`);
  // The cursor on the older commit, while the agent works.
  await row(page, 'base').click();
  await expect(row(page, 'base')).toHaveClass(/cursor/);
  symbiote.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  await expect(row(page, 'Add half')).toBeVisible(POLL);
  await expect(row(page, 'base')).toHaveClass(/cursor/);
});

test("the branches panel: workspaces that need you first, their agent's last action on top (V23)", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await startFrom(page, 'Add a half function');
  await startFrom(page, 'Export the totals');
  await page.goto(`${symbiote.url}history`);
  const half = 'feature/add-a-half-function';
  const totals = 'feature/export-the-totals';
  const branches = page.locator('.branches');
  // Local first, then the remote's `main`.
  const names = branches.locator('.branches-branch .branches-name');
  const entry = (branch: string) =>
    branches.locator('li.has-workspace', { has: page.getByTitle(branch, { exact: true }) });

  // Both agents work: the one started last on top, then the checked-out branch.
  await expect(names).toHaveText([totals, half, 'main', 'main']);
  await expect(entry(half).locator('.branches-age')).toHaveText('now');
  await expect(entry(half).locator('.branches-age')).toHaveAttribute(
    'title',
    /^Last agent action (just now|1 minute ago) · /,
  );

  // The first one's plan is ready: it needs you, so it goes above the one at work.
  symbiote.report(half, 'The plan');
  await expect(names).toHaveText([half, totals, 'main', 'main'], POLL);

  // The other asks for a permission: the newer action on top.
  symbiote.session(totals, { state: 'blocked', waitingFor: 'permission prompt' });
  symbiote.hook(totals, {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  });
  await expect(names).toHaveText([totals, half, 'main', 'main'], POLL);

  // Answered, it works again: below the one that needs you, newer as its action is.
  symbiote.session(totals, { state: 'working' });
  await expect(names).toHaveText([half, totals, 'main', 'main'], POLL);
  await expect(branches.locator('li.has-workspace .workspace-mark')).toHaveText(['?', '⚙']);
  // Only the workspaces have an age: not `main`, not the remote branch.
  await expect(branches.locator('.branches-age')).toHaveCount(2);
});

test('stop the agent, start it again, copy its prompt, open its worktree', async ({ page }) => {
  // Without terminals (V21), Talk copies the command for one.
  symbiote = await serveWorkspaces({ terminal: false });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const row = panel(page, branch);

  await row.getByRole('button', { name: 'Stop the agent' }).click();
  await expect(row).toContainText('Stopped');
  expect(symbiote.stops()).toEqual(['fake0']);
  await row.getByRole('button', { name: 'Start the agent' }).click();
  await expect(row).toContainText('Working');
  expect(symbiote.calls()).toHaveLength(2);

  await more(page, branch, 'Copy the prompt');
  await expect(row.getByRole('status')).toHaveText('Copied the prompt');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'Add a half function',
  );

  await more(page, branch, 'Talk');
  await expect(row.getByRole('status')).toHaveText(/^Copied claude attach fake1/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('claude attach fake1');

  await more(page, branch, 'Open in VS Code');
  await expect(row.getByRole('status')).toHaveText('Opened in VS Code');
  expect(symbiote.opened()).toEqual([[symbiote.folder(branch)]]);
});

test("a workspace's branch: checked out in its worktree, so not here; gone, it says so", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  await page.goto(`${symbiote.url}history?branch=${encodeURIComponent(branch)}`);
  await page.locator('.commit.cursor').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Check out', exact: true }).hover();
  await expect(page.getByRole('menuitem', { name: `Check out branch ${branch}` })).toBeDisabled();
  await expect(page.getByRole('menu', { name: 'Check out' })).toContainText(
    `checked out in ${symbiote.folder(branch)}`,
  );
  await page.keyboard.press('Escape');

  // Deleted in a terminal: the workspace says so; no mark anywhere.
  git('worktree', 'remove', '--force', symbiote.folder(branch));
  git('branch', '-D', branch);
  await page.goto(`${symbiote.url}`);
  await expect(workspaceRow(page, branch)).toContainText('Its branch is gone');
  await expect(workspaceRow(page, branch).getByRole('link', { name: branch })).toHaveCount(0);
  await page.goto(`${symbiote.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible();
  // On History's rows and branches; the sidenav's card keeps its own.
  await expect(page.locator('.commits .workspace-mark')).toHaveCount(0);
});

// Talking to the agent (V18c): the workspaces view as a list and a panel, the thread Symbiote's
// hooks record, one box whose message continues the agent's session.
const box = (page: Page, branch: string) =>
  panel(page, branch).getByRole('textbox', { name: 'Reply to the agent' });
const resumes = () => symbiote.calls().filter((call) => call.args[1] === '--resume');

test("the panel: the agent's plan, a reply that continues its session, its next report", async ({
  page,
}) => {
  // The box is where no terminal runs (V21).
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const here = panel(page, branch);
  // Started with Symbiote's hooks: the prompt it got is the thread's first entry.
  expect(symbiote.calls()[0]?.args).toEqual(
    expect.arrayContaining(['--settings', join(symbiote.repo, 'symbiote/claude-settings.json')]),
  );
  await expect(here.getByText("Symbiote's prompt")).toBeVisible(POLL);

  // It plans and stops: Claude Code says blocked; the thread has its report.
  // A plan longer than the thread's box (as real plans are).
  const steps = Array.from({ length: 40 }, (_, i) => `${i + 2}. Another step`).join('\n');
  symbiote.report(branch, `Plan\n1. Add half(a) to src/half.ts\n${steps}\nCheck: a unit test`);
  // Drawn as Markdown: the plan's steps are a numbered list.
  await expect(here.locator('.thread-agent ol li').first()).toHaveText(
    'Add half(a) to src/half.ts',
    POLL,
  );
  await expect(workspaceRow(page, branch)).toContainText('Plan ready: read it and answer', POLL);

  // The reply: the live session stopped, then continued with the text and no other flag.
  await box(page, branch).fill('OK, name it half.');
  await box(page, branch).press('Control+Enter');
  await expect(here.locator('.thread-you')).toContainText('OK, name it half.', POLL);
  expect(symbiote.stops()).toEqual(['fake0']);
  expect(resumes()).toEqual([
    { args: ['--bg', '--resume', 'session-0', 'OK, name it half.'], cwd: symbiote.folder(branch) },
  ]);
  await expect(here.locator('.thread-line')).toHaveText('Continued');
  // The newest is in view: the thread opens at its end, and follows it.
  await expect(here.locator('.thread-you')).toBeInViewport();
  await expect(box(page, branch)).toHaveValue('');
  await expect(workspaceRow(page, branch)).toContainText('Working', POLL);

  // What it waits on shows in the thread; Talk answers it.
  symbiote.hook(branch, {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  });
  symbiote.session(branch, { state: 'blocked', waitingFor: 'permission prompt' });
  await expect(here.locator('.thread-waits')).toHaveText(
    'Waiting: permission to run npm test',
    POLL,
  );
});

test('a working agent: Stop and send asks first, then ends its turn to send', async ({ page }) => {
  // The box is where no terminal runs (V21).
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const here = panel(page, branch);
  await box(page, branch).fill('Use a / 2, not a * 0.5.');
  await here.getByRole('button', { name: 'Stop and send' }).click();
  await expect(here).toContainText("Sending stops the agent's turn");
  expect(symbiote.stops()).toEqual([]);
  await here.getByRole('button', { name: 'Stop it and send' }).click();
  await expect(here.locator('.thread-you')).toContainText('Use a / 2, not a * 0.5.', POLL);
  expect(symbiote.stops()).toEqual(['fake0']);
  expect(resumes()).toHaveLength(1);
});

test('Send the verdict: a review fills the box, from the panel and from the Review tab', async ({
  page,
}) => {
  // The box is where no terminal runs (V21).
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  symbiote.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  symbiote.report(branch, 'Done: half() in src/half.ts.');
  await expect(workspaceRow(page, branch)).toContainText('Ready for review', POLL);

  // Changes requested in its review; the Review tab sends them to the agent's box.
  await panel(page, branch).getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByLabel('Review summary').fill('Name it halve.');
  await page.getByLabel('Request changes').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await page.locator('.finished').getByRole('link', { name: 'Send to the agent' }).click();
  await expect(page).toHaveURL(/\/\?branch=feature%2Fadd-a-half-function&send=verdict$/);
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
    symbiote.repo,
    'symbiote/reviews/feature/add-a-half-function/reviewer@example.com.json',
  );
  const file = JSON.parse(readFileSync(review, 'utf8')) as { verdicts: { at: string }[] };
  file.verdicts.push({ ...file.verdicts[0], at: new Date(Date.now() + 60_000).toISOString() });
  writeFileSync(review, JSON.stringify(file));
  await page.reload();
  await panel(page, branch).getByRole('button', { name: 'Send the verdict' }).click();
  await expect(box(page, branch)).toHaveValue(/Name it halve\./);
});

test('a workspace started before its messages were kept: a note, and the box still sends', async ({
  page,
}) => {
  // The box is where no terminal runs (V21).
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const record = join(symbiote.repo, 'symbiote/workspaces/feature/add-a-half-function.json');
  const saved = JSON.parse(readFileSync(record, 'utf8')) as { agent: { hooks?: boolean } };
  delete saved.agent.hooks;
  writeFileSync(record, JSON.stringify(saved));
  symbiote.session(branch, { state: 'done' });
  await page.reload();
  await expect(panel(page, branch)).toContainText(
    "Symbiote keeps an agent's messages from V18c on: Talk shows this one's.",
  );
  // Claude Code's sessions are read at most every 2 s: wait for the page's next look.
  await expect(workspaceRow(page, branch)).toContainText('Plan ready', POLL);
  await box(page, branch).fill('Go on.');
  await box(page, branch).press('Control+Enter');
  await expect(panel(page, branch).getByRole('status')).toContainText('Sent', POLL);
  expect(resumes()).toHaveLength(1);
});

test('at 900 px the sidenav and the workspace share the window; its card picks it (V29a)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(`${symbiote.url}history`);
  await startFrom(page, 'Add a half function');
  await startFrom(page, 'Add clamp');
  const half = 'feature/add-a-half-function';
  await expect(panel(page, 'feature/add-clamp')).toBeVisible();
  await expect(workspaceRow(page, half)).toBeVisible();
  // The name picks it (the branch name is a link to its commits).
  await workspaceRow(page, half).getByRole('button', { name: 'Add a half function' }).click();
  await expect(panel(page, half)).toBeVisible();
  await page.reload();
  await expect(panel(page, half)).toBeVisible();
});

test('Clean up: once merged, its sessions, worktree and branch go, and so does the workspace', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  symbiote.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  symbiote.session(branch, { state: 'done' });
  git('merge', '--quiet', '--ff-only', branch);
  await page.reload();
  await expect(workspaceRow(page, branch)).toContainText('Merged', POLL);
  await more(page, branch, 'Clean up');
  await expect(workspaceRow(page, branch)).toHaveCount(0, POLL);
  expect(symbiote.removed()).toEqual(['fake0']);
  expect(existsSync(symbiote.folder(branch))).toBe(false);
  expect(git('branch', '--list', branch)).toBe('');
  await expect(page.getByText('No workspaces yet')).toBeVisible();
});

// The agent's terminal (V21): Claude Code's own interface, `claude attach` on the server, in the
// workspace's panel.
const terminal = (page: Page, branch: string) => panel(page, branch).locator('.agent-terminal');
const screen = (page: Page, branch: string) => terminal(page, branch).locator('.xterm-rows');
/** Requests changes in the branch's review (V16), from its panel. */
const requestChanges = async (page: Page, branch: string) => {
  await panel(page, branch).getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByLabel('Review summary').fill('Name it halve.');
  await page.getByLabel('Request changes').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toBeVisible();
};

test("the agent's session in a terminal in its panel: keys, the thread, hang-up, reopen", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const here = panel(page, branch);
  await expect(here.getByRole('button', { name: 'Talk' })).toHaveCount(0);
  // The panel opens on its terminal: how to talk to it now, with no box.
  await expect(screen(page, branch)).toContainText('Fake Claude Code · fake0', POLL);
  await expect(here.getByRole('tab', { name: 'Terminal' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-a-half-function`);
  await expect(box(page, branch)).toBeHidden();
  await expect(here.getByRole('tab', { name: 'Terminal' })).toHaveAttribute(
    'title',
    /← in an empty prompt lists all your agents/,
  );

  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await expect(screen(page, branch)).toContainText('got: hello');

  // What was typed reached the agent as the person's message: the thread, its history, has it.
  await here.getByRole('tab', { name: 'Thread' }).click();
  await expect(here.locator('.thread-you').last()).toContainText('hello', POLL);
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-a-half-function&thread`);
  // Read only: answering is the terminal's.
  await expect(box(page, branch)).toBeHidden();
  // Leaving the terminal hangs it up; the session goes on.
  await expect.poll(() => symbiote.hangups()).toEqual(['fake0']);
  // The address keeps the thread; the thread leads back to the terminal.
  await page.reload();
  await expect(here.locator('.thread-you').last()).toContainText('hello', POLL);
  await here.getByRole('button', { name: 'open its terminal' }).click();
  await expect(screen(page, branch)).toContainText('Fake Claude Code · fake0', POLL);
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-a-half-function`);
  expect(symbiote.attaches()).toEqual(['fake0', 'fake0']);

  // It follows the panel's size.
  const sizes = async () =>
    ((await screen(page, branch).textContent()) ?? '').match(/\[\d+x\d+\]/g) ?? [];
  const before = await sizes();
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect.poll(async () => (await sizes()).length).toBeGreaterThan(before.length);
  expect((await sizes()).at(-1)).not.toBe(before.at(-1));

  // Stopped from the head: the terminal ends, and opens again.
  await here.getByRole('button', { name: 'Stop the agent' }).click();
  await expect(screen(page, branch)).toContainText('Session fake0 has exited', POLL);
  await expect(here.getByRole('button', { name: 'Open again' })).toBeVisible();
  // Opening it continues the stopped session: said first.
  await here.getByRole('button', { name: 'Open again' }).click();
  await expect(here).toContainText('Opening the terminal continues the stopped session');
  await here.getByRole('button', { name: 'Open the terminal' }).click();
  await expect(screen(page, branch)).toContainText('Fake Claude Code · fake0', POLL);
});

test('Send the verdict types one line into the terminal, without Enter', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  symbiote.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  symbiote.session(branch, { state: 'done' });
  // A review with a verdict: request changes.
  await page.goto(`${symbiote.url}?branch=feature%2Fadd-a-half-function`);
  await expect(workspaceRow(page, branch)).toContainText('Ready for review', POLL);
  await requestChanges(page, branch);
  // From the Review tab: the panel's terminal, the line typed into it.
  await page.locator('.finished').getByRole('link', { name: 'Send to the agent' }).click();
  await expect(screen(page, branch)).toContainText(
    'Address this review of the branch feature/add-a-half-function',
    POLL,
  );
  await expect(screen(page, branch)).not.toContainText('got:');
  // From the panel, in a terminal opened anew.
  await page.goto(`${symbiote.url}?branch=feature%2Fadd-a-half-function`);
  const here = panel(page, branch);
  await expect(screen(page, branch)).toContainText('Fake Claude Code', POLL);
  await expect(screen(page, branch)).not.toContainText('Address this review');
  await here.getByRole('button', { name: 'Send the verdict' }).click();
  await expect(screen(page, branch)).toContainText(
    'Address this review of the branch feature/add-a-half-function',
  );
  // Typed, not sent: the person presses Enter.
  await expect(screen(page, branch)).not.toContainText('got:');
  await page.keyboard.press('Enter');
  await expect(screen(page, branch)).toContainText('got: Address this review');
});

/** A 1×1 PNG and GIF, as base64 (V36). */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** Files as the page gets them from a clipboard or a drop: name, type and base64 bytes. */
type Given = { name: string; type: string; data: string };
const transfer = (page: Page, files: Given[], text = '') =>
  page.evaluateHandle(
    ({ files, text }) => {
      const data = new DataTransfer();
      for (const file of files) {
        const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
        data.items.add(new File([bytes], file.name, { type: file.type }));
      }
      if (text) data.setData('text/plain', text);
      return data;
    },
    { files, text },
  );

test('images pasted, dropped or Ctrl+V-ed into the terminal attach to the message (V36)', async ({
  page,
  context,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  await expect(screen(page, branch)).toContainText('Fake Claude Code · fake0', POLL);
  const input = terminal(page, branch).locator('.xterm-helper-textarea');
  const box = terminal(page, branch).locator('.agent-terminal-screen');
  const paste = async (files: Given[], text = '') => {
    const clipboardData = await transfer(page, files, text);
    await input.evaluate(
      (element, clipboardData) =>
        element.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
        ),
      clipboardData,
    );
  };

  // A screenshot pasted: Symbiote saves it, and pastes its path for the agent to attach.
  await paste([{ name: 'image.png', type: 'image/png', data: PNG }]);
  await expect(screen(page, branch)).toContainText('[Image #1]');
  const [first] = symbiote.images();
  expect(first?.data).toBe(PNG);
  expect(first?.path).toMatch(/[\\/]images[\\/][0-9a-f]{32}\.png$/);
  // Kept out of the worktree, where git would see it.
  expect(first?.path.startsWith(symbiote.folder(branch))).toBe(false);

  // Two dropped: both, in order; while dragged over, the terminal says where they go.
  const dropped = await transfer(page, [
    { name: 'a.gif', type: 'image/gif', data: GIF },
    { name: 'b.png', type: 'image/png', data: PNG },
  ]);
  await box.dispatchEvent('dragenter', { dataTransfer: dropped });
  await box.dispatchEvent('dragover', { dataTransfer: dropped });
  await expect(terminal(page, branch).getByText('Drop to attach')).toBeVisible();
  await box.dispatchEvent('drop', { dataTransfer: dropped });
  await expect(terminal(page, branch).getByText('Drop to attach')).toBeHidden();
  await expect(screen(page, branch)).toContainText('[Image #3]');
  expect(symbiote.images().map((image) => image.data)).toEqual([PNG, GIF, PNG]);

  // A file that is not an image: said, nothing pasted.
  const notes = await transfer(page, [{ name: 'notes.txt', type: 'text/plain', data: btoa('hi') }]);
  await box.dispatchEvent('drop', { dataTransfer: notes });
  await expect(terminal(page, branch).getByRole('alert')).toHaveText(
    'Only images can be attached: PNG, JPEG, GIF or WebP.',
  );
  // Text pastes as it did, even beside an image.
  await paste([{ name: 'image.png', type: 'image/png', data: PNG }], 'half');
  await expect(screen(page, branch)).toContainText('[Image #3] half');
  expect(symbiote.images()).toHaveLength(3);

  // Ctrl+V: the browser's paste, from the clipboard the page sees, not ^V to the agent.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, PNG);
  await input.focus();
  await page.keyboard.press('Control+V');
  await expect(screen(page, branch)).toContainText('[Image #4]');
  // The error went with the next image attached.
  await expect(terminal(page, branch).getByRole('alert')).toBeHidden();

  // Nothing is sent until Enter: then the message carries them all.
  await expect(screen(page, branch)).not.toContainText('got:');
  await page.keyboard.press('Enter');
  await expect(screen(page, branch)).toContainText(
    'got: [Image #1] [Image #2] [Image #3] half[Image #4]',
  );
});

test('paths and web addresses the agent prints open with Ctrl+click: files of its worktree only (V38)', async ({
  page,
  context,
}) => {
  symbiote = await serveWorkspaces();
  await context.route('https://example.com/**', (route) => route.fulfill({ body: 'the PR' }));
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const rows = screen(page, branch);
  await expect(rows).toContainText('Fake Claude Code · fake0', POLL);
  const worktree = symbiote.folder(branch);
  // The main checkout's file: outside the worktree.
  const outside = join(symbiote.repo, 'src', 'math.ts');
  // The agent's own link (OSC 8) to a file, as Claude Code makes one.
  const link = `\u001b]8;;file://${worktree}/src/app.ts\u0007the app\u001b]8;;\u0007`;
  symbiote.setSession('fake0', {
    state: 'done',
    status: 'idle',
    answer: [
      'Halved in src/math.ts:3',
      'not missing.ts',
      `nor ${outside}`,
      `see ${link}`,
      'and https://example.com/pr/1.',
    ].join('\r\n'),
  });
  await expect(rows).toContainText('and https://example.com/pr/1.', POLL);
  const hint = terminal(page, branch).getByRole('tooltip');
  const opens: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/open')) opens.push(request.postData() ?? '');
  });
  const hover = async (text: string) => {
    const at = await textAt(rows, text);
    // Each row's paths are asked about once, as the pointer reaches it.
    const asked = page.waitForResponse((response) => response.url().endsWith('/paths'));
    await page.mouse.move(at.x, at.y);
    return { at, asked };
  };
  const ctrlClick = async ({ x, y }: { x: number; y: number }) => {
    await page.keyboard.down('ControlOrMeta');
    await page.mouse.click(x, y);
    await page.keyboard.up('ControlOrMeta');
  };

  // A file of its worktree: underlined, with a hint; a plain click is the terminal's.
  const math = await hover('src/math.ts:3');
  await expect(hint).toHaveText(/^Open in VS Code\s*Ctrl\+click$/);
  await page.mouse.click(math.at.x, math.at.y);
  await ctrlClick(math.at);
  await expect
    .poll(() => symbiote.opened())
    .toEqual([[worktree, '--goto', `${join(worktree, 'src', 'math.ts')}:3:1`]]);
  expect(opens).toEqual([JSON.stringify({ path: 'src/math.ts', line: 3 })]);

  // A file that is not there, and one outside the worktree: no link.
  for (const text of ['missing.ts', outside]) {
    const { at, asked } = await hover(text);
    await asked;
    await expect(hint).toBeHidden();
    await ctrlClick(at);
  }

  // The agent's own link opens the file it names.
  const app = await textAt(rows, 'the app');
  await page.mouse.move(app.x, app.y);
  await expect(hint).toHaveText(/^Open in VS Code/);
  await ctrlClick(app);
  await expect
    .poll(() => symbiote.opened().at(-1))
    .toEqual([worktree, '--goto', `${join(worktree, 'src', 'app.ts')}:1:1`]);
  expect(opens).toHaveLength(2);

  // A web address, in a new tab, without the sentence's full stop.
  const web = await textAt(rows, 'example.com/pr/1');
  await page.mouse.move(web.x, web.y);
  await expect(hint).toHaveText(/^Open https:\/\/example\.com\/pr\/1\s*Ctrl\+click$/);
  const tab = context.waitForEvent('page');
  await ctrlClick(web);
  expect((await tab).url()).toBe('https://example.com/pr/1');

  // A file gone since it was linked: the server's words in the error line.
  rmSync(join(worktree, 'src', 'math.ts'));
  await page.mouse.move(math.at.x, math.at.y);
  await ctrlClick(math.at);
  await expect(terminal(page, branch).getByRole('alert')).toHaveText('src/math.ts is not a file');
  expect(symbiote.opened()).toHaveLength(2);
});

// A workspace's shells (V45): the person's shell in its worktree, in tabs after the agent's, kept
// by the server until closed.
const shellTab = (page: Page, branch: string, n: number) =>
  panel(page, branch).getByRole('tab', { name: `Shell ${n}`, exact: true });
/** A sleep this worker's shells run: its length is the worker's, as workers run side by side. */
const NAP = `sleep ${10_000 + (process.pid % 50_000)}`;
/** The NAPs running: one started in a shell. */
const sleeps = () => {
  try {
    return execFileSync('pgrep', ['-f', `^${NAP}$`], { encoding: 'utf8' })
      .trim()
      .split('\n').length;
  } catch {
    return 0; // pgrep exits 1 when none matches
  }
};
/** Types a line into the terminal shown and presses Enter. */
const typeLine = async (page: Page, line: string) => {
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
};

test("a workspace's shells: each its own, kept across tabs and a reload, closed by × or exit", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const here = panel(page, branch);
  await expect(screen(page, branch)).toContainText('Fake Claude Code · fake0', POLL);
  // The agent's tabs as they were, the shells after them.
  await expect(here.getByRole('tab')).toHaveText(['Terminal', 'Thread', 'Brief']);
  await here.getByRole('button', { name: 'New shell' }).click();
  await expect(shellTab(page, branch, 1)).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-a-half-function&shell=1`);
  await expect(screen(page, branch)).toContainText('shell$', POLL);
  // In the worktree.
  await typeLine(page, 'pwd');
  await expect(screen(page, branch)).toContainText(symbiote.folder(branch));
  await typeLine(page, 'echo one-$((1+1))');
  await expect(screen(page, branch)).toContainText('one-2');

  await here.getByRole('button', { name: 'New shell' }).click();
  await expect(shellTab(page, branch, 2)).toHaveAttribute('aria-selected', 'true');
  await expect(screen(page, branch)).toContainText('shell$', POLL);
  await expect(screen(page, branch)).not.toContainText('one-2');
  await typeLine(page, 'echo two-$((2+2))');
  await expect(screen(page, branch)).toContainText('two-4');
  await expect(here.getByRole('tab')).toHaveText([
    'Terminal',
    'Thread',
    'Brief',
    'Shell 1',
    'Shell 2',
  ]);

  // Shell 1 kept its own; what it runs goes on while another tab is shown, and through a reload.
  await shellTab(page, branch, 1).click();
  await expect(screen(page, branch)).toContainText('one-2', POLL);
  await expect(screen(page, branch)).not.toContainText('two-4');
  await typeLine(page, NAP);
  await expect.poll(sleeps).toBe(1);
  await here.getByRole('tab', { name: 'Thread' }).click();
  await here.getByRole('tab', { name: 'Terminal' }).click();
  await expect(screen(page, branch)).toContainText('Fake Claude Code · fake0', POLL);
  await shellTab(page, branch, 1).click();
  await page.reload();
  await expect(shellTab(page, branch, 1)).toHaveAttribute('aria-selected', 'true', POLL);
  await expect(screen(page, branch)).toContainText('one-2', POLL);
  expect(sleeps()).toBe(1);

  // × asks first while a program runs in it, naming it.
  await here.getByRole('button', { name: 'Close Shell 1' }).click();
  await expect(here).toContainText('sleep is running in Shell 1: closing the shell ends it.');
  await here.getByRole('button', { name: 'Cancel' }).click();
  await expect(shellTab(page, branch, 1)).toBeVisible();
  expect(sleeps()).toBe(1);
  await here.getByRole('button', { name: 'Close Shell 1' }).click();
  await here.getByRole('button', { name: 'Close it' }).click();
  await expect(shellTab(page, branch, 1)).toHaveCount(0);
  await expect.poll(sleeps).toBe(0);
  // Its neighbour shows.
  await expect(shellTab(page, branch, 2)).toHaveAttribute('aria-selected', 'true');
  await expect(screen(page, branch)).toContainText('two-4', POLL);

  // `exit` closes its tab; with no shell left, the agent's terminal shows.
  await typeLine(page, 'exit');
  await expect(shellTab(page, branch, 2)).toHaveCount(0, POLL);
  await expect(here.getByRole('tab', { name: 'Terminal' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-a-half-function`);

  // Numbered from 1 again, and at most 8.
  for (let n = 1; n <= 8; n += 1) {
    await here.getByRole('button', { name: 'New shell' }).click();
    await expect(shellTab(page, branch, n)).toHaveAttribute('aria-selected', 'true');
  }
  await expect(here.getByRole('button', { name: 'New shell' })).toBeDisabled();
  await expect(here.getByRole('button', { name: 'New shell' })).toHaveAttribute(
    'title',
    '8 shells are open: close one first',
  );
  // Narrower, the strip scrolls: the picked tab and + stay in sight.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(shellTab(page, branch, 8)).toBeInViewport({ ratio: 1 });
  await expect(here.getByRole('button', { name: 'New shell' })).toBeInViewport({ ratio: 1 });
  await shellTab(page, branch, 1).click();
  await expect(shellTab(page, branch, 1)).toBeInViewport({ ratio: 1 });
});

test('without terminals, the panel keeps Talk in its menu, and no Terminal tab', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const here = panel(page, 'feature/add-a-half-function');
  await expect(here.getByRole('tab')).toHaveText(['Thread', 'Brief']);
  // No shells either (V45).
  await expect(here.getByRole('button', { name: 'New shell' })).toHaveCount(0);
  await here.getByRole('button', { name: 'More actions' }).click();
  await expect(here.getByRole('menuitem', { name: 'Talk' })).toHaveAttribute(
    'title',
    /SYMBIOTE_TERMINAL=off/,
  );
});

test("an agent's report is drawn as Markdown; HTML in it, and your messages, stay as written", async ({
  page,
}) => {
  // Your message goes through the box: where no terminal runs (V21).
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const here = panel(page, branch);
  symbiote.report(
    branch,
    '## Done\n\n**What changed**\n- **half** (`src/half.ts`): added.\n  - tested\n\n<b>raw</b> [docs](https://example.com)',
  );
  const report = here.locator('.thread-agent').last();
  await expect(report.locator('h4')).toHaveText('Done', POLL);
  await expect(report.locator('strong').first()).toHaveText('What changed');
  await expect(report.locator('ul > li > strong')).toHaveText('half');
  await expect(report.locator('code')).toHaveText('src/half.ts');
  await expect(report.locator('ul ul li')).toHaveText('tested');
  await expect(report).toContainText('<b>raw</b>');
  await expect(report.locator('a')).toHaveAttribute('href', 'https://example.com');
  await expect(report).not.toContainText('**');
  // Your messages are shown as you typed them. Sent once the list says the turn ended: before
  // that, sending would stop a working agent, and asks first.
  await expect(here).toContainText('Plan ready', POLL);
  await box(page, branch).fill('Keep **this** as typed.');
  await box(page, branch).press('Control+Enter');
  await expect(here.locator('.thread-you').last()).toContainText('Keep **this** as typed.', POLL);
});

test("the records' folder before V25 left beside today's: Workspaces says so (V25)", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  // Both hold something (an empty symbiote/workspaces/ is replaced by the move).
  for (const folder of ['workspaces', 'features']) {
    mkdirSync(join(symbiote.repo, 'symbiote', folder), { recursive: true });
    writeFileSync(join(symbiote.repo, 'symbiote', folder, 'notes.txt'), folder);
  }
  await page.goto(symbiote.url);
  await expect(page.getByText('No workspaces yet')).toBeVisible();
  await expect(page.locator('.workspaces-note')).toHaveText(
    'symbiote/features/, where workspaces were kept before, is still here: Symbiote reads symbiote/workspaces/.',
  );
});

// The structured brief (V24c): a kind of work, its title and parts, which the server makes the
// agent's brief of; Done when with the check command guessed at the start commit; a draft.
const kind = (page: Page, name: string) => startPage(page).getByRole('radio', { name });
const part = (page: Page, name: string) => startPage(page).getByRole('textbox', { name });
const doneWhen = (page: Page) => part(page, 'Done when optional');
const startButton = (page: Page) =>
  startPage(page).getByRole('button', { name: 'Start', exact: true });
const info = (page: Page) =>
  startPage(page).getByRole('button', { name: 'About the kinds of work' });

test('each kind starts a workspace: its brief, its line, its branch, its tag (V24c)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  const kinds = [
    ['Fix', 'What happens', 'fix/', 'Reproduce it first, with a failing test'],
    ['Refactor', 'What to restructure', 'refactor/', 'Change structure, not behaviour'],
    ['Chore', 'What to change', 'chore/', 'Keep to what is asked'],
    ['Spike', 'Question', 'spike/', 'The answer is what is asked for, not a change to merge'],
  ] as const;
  let last = 'Feature';
  for (const [name, heading, prefix, line] of kinds) {
    await page.getByRole('link', { name: 'Start a workspace' }).click();
    // The kind picked last is picked again.
    await expect(kind(page, last)).toHaveAttribute('aria-checked', 'true');
    await kind(page, name).click();
    await title(page).fill(`${name} the totals`);
    await part(page, heading).fill(`Why ${name}.`);
    const slug = `${prefix}${name.toLowerCase()}-the-totals`;
    await expect(branch(page)).toHaveValue(slug);
    await startButton(page).click();
    await expect(page.getByRole('status')).toContainText(`Started ${slug}`);
    const prompt = symbiote.calls().at(-1)?.args.at(-1) ?? '';
    expect(prompt).toContain(`# ${name}: ${name} the totals\n\n## ${heading}\nWhy ${name}.\n`);
    expect(prompt).toContain(line);
    expect(prompt).toContain(`You are starting a new ${name.toLowerCase()} in this repository`);
    last = name;
  }
  // No check command here (no package.json): Done when says it in words.
  expect(symbiote.calls()[0]?.args.at(-1)).toContain(
    "## Done when\nA test that fails today passes, and the project's checks pass.\n",
  );

  // The list names each by its title, its kind before its branch (V29b).
  await page.goto(`${symbiote.url}`);
  const fix = workspaceRow(page, 'fix/fix-the-totals');
  await expect(fix.locator('.workspace-about')).toHaveText('Fix the totals');
  await expect(fix.locator('.workspace-branch .kind-tag')).toHaveText('fix');
});

test('Done when names the check guessed at the start commit; switching kinds keeps every text (V24c)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  writeFileSync(
    join(symbiote.repo, 'package.json'),
    JSON.stringify({ scripts: { check: 'eslint . && vitest run' } }),
  );
  git('add', 'package.json');
  git('commit', '-q', '-m', 'Add a check');
  await page.goto(`${symbiote.url}history`);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  // A Feature has no Done when of its own; the check is offered as an example.
  await expect(doneWhen(page)).toHaveValue('');
  await expect(doneWhen(page)).toHaveAttribute('placeholder', /e\.g\. `npm run check` passes/);
  await expect(startPage(page)).toContainText(
    'Check: npm run check, from package.json (scripts.check)',
  );

  await kind(page, 'Fix').click();
  await expect(doneWhen(page)).toHaveValue(
    'A test that fails today passes, and `npm run check` passes.',
  );
  await expect(startButton(page)).toBeDisabled();
  await title(page).fill('Dates sort as text');
  await expect(startButton(page)).toBeDisabled();
  await part(page, 'What happens').fill('They sort 1, 10, 2.');
  await expect(startButton(page)).toBeEnabled();

  // More: closed until asked for, or until a field in it has text.
  const more = startPage(page).getByRole('button', { name: /^More: How to reproduce/ });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await part(page, 'Where to look optional').fill('src/table.ts');

  // Another kind: the same text under its own label; an untouched Done when becomes its own.
  await kind(page, 'Chore').click();
  await expect(part(page, 'What to change')).toHaveValue('They sort 1, 10, 2.');
  await expect(doneWhen(page)).toHaveValue('Nothing else changes, and `npm run check` passes.');
  await expect(part(page, 'Where to look optional')).toHaveValue('src/table.ts');
  await expect(branch(page)).toHaveValue('chore/dates-sort-as-text');
  // Edited, Done when stays.
  await doneWhen(page).fill('The table test passes.');
  await kind(page, 'Fix').click();
  await expect(doneWhen(page)).toHaveValue('The table test passes.');
  await expect(part(page, 'What happens')).toHaveValue('They sort 1, 10, 2.');

  await startButton(page).click();
  await expect(page.getByRole('status')).toContainText('Started fix/dates-sort-as-text');
  expect(symbiote.calls().at(-1)?.args.at(-1)).toContain(
    [
      '# Fix: Dates sort as text',
      '',
      '## What happens',
      'They sort 1, 10, 2.',
      '',
      '## Where to look',
      'src/table.ts',
      '',
      '## Done when',
      'The table test passes.',
    ].join('\n'),
  );
});

test('the draft outlives Escape and a reload; after a start only the kind is kept (V24c)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const draft = async () =>
    (await (await page.request.get(`${symbiote.url}api/workspaces/draft`)).json()) as {
      title?: string;
    };
  await page.goto(`${symbiote.url}history`);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await kind(page, 'Fix').click();
  await title(page).fill('Dates sort as text');
  await part(page, 'What happens').fill('They sort 1, 10, 2.');
  await expect.poll(async () => (await draft()).title).toBe('Dates sort as text');
  await page.reload();
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await expect(kind(page, 'Fix')).toHaveAttribute('aria-checked', 'true');
  await expect(title(page)).toHaveValue('Dates sort as text');
  await expect(part(page, 'What happens')).toHaveValue('They sort 1, 10, 2.');
  await title(page).press('Control+Enter');
  await expect(page.getByRole('status')).toContainText('Started fix/dates-sort-as-text');
  await expect.poll(draft).toEqual({ kind: 'fix' });
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await expect(kind(page, 'Fix')).toHaveAttribute('aria-checked', 'true');
  await expect(title(page)).toHaveValue('');
  await expect(part(page, 'What happens')).toHaveValue('');
});

test('the keyboard: digits and arrows pick a kind; Tab goes kind, its info, title, part, Done when, More, start from, branch and effort with their help, permission, documents (V24c, V30, V33, V37, V40)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await page.keyboard.press('n');
  await expect(title(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(info(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(kind(page, 'Feature')).toBeFocused();
  await page.keyboard.press('2');
  await expect(kind(page, 'Fix')).toBeFocused();
  await expect(kind(page, 'Fix')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(kind(page, 'Refactor')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('5');
  await expect(kind(page, 'Spike')).toHaveAttribute('aria-checked', 'true');
  for (const next of [
    info(page),
    title(page),
    part(page, 'Question'),
    doneWhen(page),
    startPage(page).getByRole('button', { name: /More:/ }),
    startPage(page).getByLabel('Start from'),
    // V37: a field's help is a button before it, in the Tab order.
    startPage(page).getByRole('button', { name: 'Where its worktree goes' }),
    branch(page),
    startPage(page).getByRole('button', { name: 'About the effort' }),
    startPage(page).getByLabel('Effort', { exact: true }),
    startPage(page).getByLabel('Permission'),
    startPage(page).getByLabel('Plan first and wait for my OK'),
    // V40: the documents' help, then Add files (its file input is not a stop).
    startPage(page).getByRole('button', { name: 'About documents' }),
    startPage(page).getByRole('button', { name: 'Add files' }),
  ]) {
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
  }
});

test('a workspace started before V24 is named by its brief, with no kind', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  // What a page from before V24 posts: one brief.
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify({
        brief: 'Export the totals\n\nAs CSV.',
        branch: 'feature/old',
        planFirst: false,
      }),
    });
    return response.status;
  });
  expect(status).toBe(200);
  expect(symbiote.calls()[0]?.args.at(-1)).toContain(
    "The person's brief:\n\nExport the totals\n\nAs CSV.",
  );
  await page.goto(`${symbiote.url}`);
  const row = workspaceRow(page, 'feature/old');
  await expect(row.locator('.workspace-about')).toHaveText('Export the totals');
  await expect(row.locator('.kind-tag')).toHaveCount(0);

  // Its Brief tab: the text as paragraphs, no heading of Symbiote's.
  await row.locator('.workspace-about').click();
  await panel(page, 'feature/old').getByRole('tab', { name: 'Brief' }).click();
  const brief = panel(page, 'feature/old').locator('.workspace-brief');
  await expect(brief.locator('.markdown p')).toHaveText(['Export the totals', 'As CSV.']);
  await expect(brief.getByRole('heading')).toHaveCount(0);
});

test('the Brief tab draws the brief as Markdown: its headings, lists and code', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await title(page).fill('Add clamp');
  await goal(page).fill(
    'Clamp a value:\n\n- below `min` to `min`\n- above `max` to `max`\n\n<b>no</b>',
  );
  await doneWhen(page).fill('`npm test` passes');
  await goal(page).press('Control+Enter');
  await expect(startPage(page)).toBeHidden();

  const here = panel(page, 'feature/add-clamp');
  await here.getByRole('tab', { name: 'Brief' }).click();
  const brief = here.locator('.workspace-brief');
  // The brief's `#` and `##` lines are headings, below the page's own.
  await expect(brief.getByRole('heading')).toHaveText(['Feature: Add clamp', 'Goal', 'Done when']);
  await expect(brief.getByRole('listitem')).toHaveText(['below min to min', 'above max to max']);
  await expect(brief.locator('code')).toHaveText(['min', 'min', 'max', 'max', 'npm test']);
  await expect(brief).not.toContainText('## Goal');
  // HTML in a brief is text, as in an agent's report.
  await expect(brief).toContainText('<b>no</b>');
  await expect(brief.locator('b')).toHaveCount(0);
});

test('the kinds explained: a tooltip after the picker, on hover, focus or a tap (V24c)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await kind(page, 'Fix').click();
  // A help's tip is drawn on the page's body (V37), named by the button's aria-describedby.
  const about = page.locator('#kind-about[role="tooltip"]');
  await expect(about).toBeHidden();
  await info(page).hover();
  await expect(about).toBeVisible();
  await expect(about.locator('dt')).toHaveText(['Feature', 'Fix', 'Refactor', 'Chore', 'Spike']);
  await expect(about).toContainText('Something that goes wrong');
  await expect(about).toContainText('A question to answer');
  // The kind picked is marked.
  await expect(about.locator('.current dt')).toHaveText('Fix');
  await expect(info(page)).toHaveAttribute('aria-describedby', 'kind-about');
  await title(page).hover();
  await expect(about).toBeHidden();

  // From the keyboard: shown while the button has the focus; Escape hides it, and the page stays.
  await kind(page, 'Fix').focus();
  await page.keyboard.press('Tab');
  await expect(info(page)).toBeFocused();
  await expect(about).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();
  await expect(startPage(page)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(about).toBeHidden();

  // A tap (no hover on a phone) shows it too.
  await info(page).click();
  await expect(about).toBeVisible();
});

test('Merge on an approved workspace: Symbiote merges it in its own worktree, Land moves main (V26a)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const tip = symbiote.commit(
    branch,
    'src/half.ts',
    'export const half = (a: number) => a / 2;\n',
    'Add half',
  );
  symbiote.report(branch, 'Done: half() in src/half.ts.');
  await expect(workspaceRow(page, branch)).toContainText('Ready for review', POLL);
  // Not approved: no Merge.
  await expect(panel(page, branch).getByRole('button', { name: /^Merge into/ })).toHaveCount(0);

  await panel(page, branch).getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText(`Approved ${short(tip)}`);
  await page.goto(`${symbiote.url}?branch=${encodeURIComponent(branch)}`);

  // Preselected: main, where the workspace started from.
  const here = panel(page, branch);
  await expect(here.getByLabel('Branch to merge into')).toHaveValue('main');
  const main = git('rev-parse', 'main');
  await here.getByRole('button', { name: 'Merge into', exact: true }).click();

  // The sidenav's Merging group, above the workspaces: no check here, so it waits for Land.
  const merging = page.getByRole('region', { name: 'Merging' });
  await expect(page.locator('.sidenav .workspace-group').first()).toHaveAttribute(
    'aria-label',
    'Merging',
  );
  const card = merging.locator(`[data-merge="${branch}"]`);
  await expect(card).toContainText('Merged, not checked', POLL);
  await expect(here.locator('p.merge-control')).toHaveText(/^Merged, not checked/);
  expect(git('rev-parse', 'main')).toBe(main);
  // The agent's worktree and the main checkout were not used to merge.
  expect(git('status', '--porcelain', '--untracked-files=no')).toBe('');
  expect(git('-C', symbiote.folder(branch), 'rev-parse', 'HEAD')).toBe(tip);

  // Its card opens it in the main area. Its reads are slow here: Land, clicked while the one the
  // merge opened with is under way, still shows what it did (V29b).
  await page.route('**/api/merges', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });
  await card.getByRole('link').click();
  const entry = page.getByRole('region', { name: `Merge of ${branch}` });
  await entry.getByRole('button', { name: 'Land' }).click();
  await expect(entry.locator('.merge-row-state')).toHaveText(/^Landed: main is at/, POLL);
  expect(git('log', '-1', '--format=%P%n%s', 'main')).toBe(
    `${main} ${tip}\nMerge ${branch}: Add a half function`,
  );
  expect(existsSync(join(symbiote.repo, 'src', 'half.ts'))).toBe(true);
  // Merged: the workspace offers Clean up, and no Merge.
  await expect(workspaceRow(page, branch)).toContainText('Merged', POLL);
  await workspaceRow(page, branch).getByRole('button', { name: 'Add a half function' }).click();
  await here.getByRole('button', { name: 'More actions' }).click();
  await expect(here.getByRole('menuitem', { name: 'Clean up', exact: true })).toBeVisible();
  await expect(here.getByRole('button', { name: /^Merge into/ })).toHaveCount(0);
});

test('Merge into merges into the branch picked in its dropdown, not main', async ({ page }) => {
  symbiote = await serveWorkspaces({ terminal: false });
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const tip = symbiote.commit(
    branch,
    'src/half.ts',
    'export const half = (a: number) => a / 2;\n',
    'Add half',
  );
  symbiote.report(branch, 'Done: half() in src/half.ts.');
  await expect(workspaceRow(page, branch)).toContainText('Ready for review', POLL);
  await panel(page, branch).getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText(`Approved ${short(tip)}`);
  const main = git('rev-parse', 'main');
  git('branch', 'release', main);
  await page.goto(`${symbiote.url}?branch=${encodeURIComponent(branch)}`);

  // The button names no branch: the dropdown beside it does, preselected main.
  const here = panel(page, branch);
  const target = here.getByLabel('Branch to merge into');
  await expect(target).toHaveValue('main');
  const button = here.getByRole('button', { name: 'Merge into', exact: true });
  await expect(button).toBeVisible();
  await target.selectOption('release');
  await expect(button).toBeVisible();
  await button.click();

  const entry = page.getByRole('region', { name: 'Merging' }).locator(`[data-merge="${branch}"]`);
  await expect(entry).toContainText('Merged, not checked', POLL);
  await entry.getByRole('link').click();
  const merge = page.getByRole('region', { name: `Merge of ${branch}` });
  await merge.getByRole('button', { name: 'Land' }).click();
  await expect(merge.locator('.merge-row-state')).toHaveText(/^Landed: release is at/, POLL);
  expect(git('log', '-1', '--format=%P', 'release')).toBe(`${main} ${tip}`);
  expect(git('rev-parse', 'main')).toBe(main);
});
