import { existsSync, realpathSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Hermes as a workspace's agent (V58): run in a terminal Symbiote keeps, in its worktree, with
// Symbiote's prompt as its first turn; its state read from its session (a fake Hermes, which stores
// its sessions as 0.21.3's CLI lists and exports them); stopped by a hang-up, continued with
// `--resume`.
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
const BRANCH = 'feature/add-a-half-function';
const startPage = (page: Page) => page.getByRole('region', { name: 'Start a workspace' });
const panel = (page: Page) => page.getByRole('region', { name: `Workspace ${BRANCH}` });
const workspaceRow = (page: Page) => page.locator(`.workspace-row[data-branch="${BRANCH}"]`);
const screen = (page: Page) => panel(page).locator('.agent-terminal .xterm-rows');

test('Hermes in its terminal: started with the prompt, kept while its tab is left, its state from its session, stopped and continued', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ agent: false, hermes: true });
  await page.goto(symbiote.url);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  // Hermes alone: named, its levels offered, its approvals in its terminal.
  await expect(startPage(page)).toContainText('Hermes');
  await expect(startPage(page)).toContainText('In its terminal');
  await startPage(page).getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await startPage(page).getByRole('textbox', { name: 'Goal' }).fill('Return a / 2, and test it.');
  await startPage(page).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(startPage(page)).toBeHidden();
  const folder = symbiote.folder(BRANCH);
  await expect(page.getByRole('status')).toHaveText(
    `Started ${BRANCH}: Hermes is working in ${folder}.`,
  );

  // Its panel opens on Hermes itself: one Hermes, in the worktree, given the prompt.
  const here = panel(page);
  await expect(here.getByRole('tab', { name: 'Terminal' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(screen(page)).toContainText('Fake Hermes ·', POLL);
  const id = symbiote.hermesSession(BRANCH);
  const [call, ...more] = symbiote.hermesCalls();
  expect(more).toEqual([]);
  expect(call?.cwd).toBe(realpathSync(folder));
  expect(call?.args[0]).toBe('chat');
  expect(call?.args[1]).toMatch(/^--query=[\s\S]*Add a half function/);
  await expect(here.getByRole('tab', { name: 'Terminal' })).toHaveAttribute(
    'data-tip',
    /\/help in its prompt lists Hermes's commands/,
  );
  await expect(workspaceRow(page).locator('.state-dot')).toHaveClass(/tone-working/, POLL);

  // Its plan: the card follows while the terminal is open; the thread has it.
  symbiote.hermesAnswer(BRANCH, 'Plan: add half(a) to src/half.ts, then test it.');
  await expect(workspaceRow(page)).toContainText('Plan ready', POLL);
  await here.getByRole('tab', { name: 'Thread' }).click();
  await expect(here.locator('.thread-agent').last()).toContainText('Plan: add half(a)', POLL);

  // Leaving its tab does not hang Hermes up: it is the agent, not a client of it.
  await page.waitForTimeout(1_000);
  expect(symbiote.hermesHangups()).toEqual([]);
  await here.getByRole('button', { name: 'open its terminal' }).click();
  await expect(screen(page)).toContainText(`Fake Hermes · ${id}`, POLL);
  expect(symbiote.hermesCalls()).toHaveLength(1);

  // A line typed there is a turn: working again.
  await page.keyboard.type('Go ahead.');
  await page.keyboard.press('Enter');
  await expect(screen(page)).toContainText('sent: Go ahead.', POLL);
  await expect(workspaceRow(page).locator('.state-dot')).toHaveClass(/tone-working/, POLL);

  // Stop hangs it up; its session stays, and its terminal continues it, asked first.
  await here.getByRole('button', { name: 'Stop the agent' }).click();
  await expect(workspaceRow(page)).toContainText('Stopped', POLL);
  expect(symbiote.hermesHangups()).toEqual([id]);
  await here.getByRole('button', { name: 'Open again' }).click();
  await expect(here).toContainText('Opening the terminal continues the stopped session');
  await here.getByRole('button', { name: 'Open the terminal' }).click();
  await expect(screen(page)).toContainText(`Resumed session ${id}`, POLL);
  expect(symbiote.hermesCalls()[1]).toEqual({
    args: ['--resume', id],
    cwd: realpathSync(folder),
  });

  // Clean up hangs Hermes up with its worktree.
  await here.getByRole('button', { name: 'More actions' }).click();
  await here.getByRole('menuitem', { name: 'Clean up…' }).click();
  await here.getByRole('button', { name: 'Clean up anyway' }).click();
  await expect(workspaceRow(page)).toHaveCount(0, POLL);
  expect(symbiote.hermesHangups()).toEqual([id, id]);
  expect(existsSync(folder)).toBe(false);
});

test('Hermes is not offered where no terminal can run', async ({ page }) => {
  symbiote = await serveWorkspaces({ agent: false, hermes: true, terminal: false });
  await page.goto(symbiote.url);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await expect(startPage(page)).toContainText('No agent found');
  expect(symbiote.hermesCalls()).toEqual([]);
});
