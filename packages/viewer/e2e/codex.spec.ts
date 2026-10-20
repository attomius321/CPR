import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './cpr.js';

// Codex as a workspace's agent (V20a): picked in the start dialog, run by CPR's runner (the
// real one) on a fake Codex, its thread recorded from its events, replies by `exec resume`.
let cpr: RunningWorkspaces;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  cpr.stop();
  expect(errors).toEqual([]);
});

const POLL = { timeout: 12_000 };
const BRANCH = 'feature/add-a-half-function';
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Start a workspace' });
const panel = (page: Page, branch = BRANCH) =>
  page.getByRole('region', { name: `Workspace ${branch}` });
const workspaceRow = (page: Page, branch = BRANCH) =>
  page.locator(`.workspace-row[data-branch="${branch}"]`);
const box = (page: Page) => panel(page).getByRole('textbox', { name: 'Reply to the agent' });
/** Opens the start dialog and fills a Feature's title and goal. */
const openDialog = async (page: Page) => {
  await page.getByRole('button', { name: 'Start a workspace' }).click();
  await dialog(page).getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await dialog(page).getByRole('textbox', { name: 'Goal' }).fill('Return a / 2, and test it.');
};
/** Starts a workspace with Codex picked, from the page open. */
const startWithCodex = async (page: Page) => {
  await openDialog(page);
  await dialog(page).getByLabel('agent').selectOption({ label: 'Codex' });
  await dialog(page).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
};
/** What a commit on the branch writes, as CPR names it to Codex's sandbox. */
const roots = () => {
  const common = realpathSync(join(cpr.repo, '.git'));
  return `sandbox_workspace_write.writable_roots=${JSON.stringify([
    join(common, 'worktrees', 'feature-add-a-half-function'),
    join(common, 'objects'),
    join(common, 'refs', 'heads', 'feature'),
    join(common, 'logs', 'refs', 'heads', 'feature'),
  ])}`;
};

test('a workspace with Codex: picked in the dialog, its plan in the thread, a reply that resumes it', async ({
  page,
}) => {
  cpr = await serveWorkspaces({ codex: true });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${cpr.url}history`);
  await openDialog(page);
  // Both installed: Claude Code first (no `agent.kind`), with its permission mode.
  const agent = dialog(page).getByLabel('agent');
  await expect(agent).toHaveValue('claude');
  await expect(dialog(page).getByLabel('permission')).toBeVisible();
  await agent.selectOption({ label: 'Codex' });
  await expect(dialog(page)).toContainText(
    'Codex · your ChatGPT account · sandbox: its worktree and branch',
  );
  await expect(dialog(page).getByLabel('permission')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Start', exact: true }).click();
  const folder = cpr.folder(BRANCH);
  await expect(page.getByRole('status')).toHaveText(
    `Started ${BRANCH}: Codex is working in ${folder}.`,
  );

  // Codex, not Claude Code: in its worktree, sandboxed, its branch's git folders writable.
  expect(cpr.calls()).toEqual([]);
  const [call, ...more] = cpr.codexCalls();
  expect(more).toEqual([]);
  expect(call?.cwd).toBe(folder);
  expect(call?.args.slice(0, 9)).toEqual([
    'exec',
    '--json',
    '-C',
    folder,
    '-s',
    'workspace-write',
    '-c',
    roots(),
    '--',
  ]);
  expect(call?.args.at(-1)).toContain('## Goal\nReturn a / 2, and test it.\n');

  // Its panel: CPR's prompt in the thread, recorded by the runner; no terminal, Talk instead.
  await page.goto(`${cpr.url}?branch=${encodeURIComponent(BRANCH)}`);
  const here = panel(page);
  await expect(here.getByText("CPR's prompt")).toBeVisible(POLL);
  await expect(workspaceRow(page)).toContainText('Working', POLL);
  await expect(here.getByRole('tab', { name: 'Terminal' })).toHaveCount(0);

  // The turn ends with a plan: drawn in the thread, "plan ready".
  cpr.codexTurn(BRANCH, { text: 'Plan\n1. Add half(a) to src/half.ts\n2. Test it' });
  await expect(here.locator('.thread-agent ol li').first()).toHaveText(
    'Add half(a) to src/half.ts',
    POLL,
  );
  await expect(workspaceRow(page)).toContainText('Plan ready: read it and answer', POLL);
  await here.getByRole('button', { name: 'More actions' }).click();
  await here.getByRole('menuitem', { name: 'Talk' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `codex resume thread-0 -C ${folder}`,
  );

  // A reply: the same thread resumed with the text, the same sandbox.
  await box(page).fill('OK, go ahead.');
  await box(page).press('Control+Enter');
  await expect(here.locator('.thread-you')).toContainText('OK, go ahead.', POLL);
  expect(cpr.codexCalls().at(-1)).toEqual({
    args: [
      'exec',
      'resume',
      '--json',
      '-c',
      'sandbox_mode="workspace-write"',
      '-c',
      roots(),
      '--',
      'thread-0',
      'OK, go ahead.',
    ],
    cwd: folder,
  });
  await expect(here.locator('.thread-line')).toHaveText('Continued');
  await expect(workspaceRow(page)).toContainText('Working', POLL);

  // It commits and reports: ready for review.
  cpr.commit(BRANCH, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  cpr.codexTurn(BRANCH, { text: 'Added half, committed.' });
  await expect(here.locator('.thread-agent').last()).toContainText('Added half, committed.', POLL);
  await expect(workspaceRow(page)).toContainText('Ready for review', POLL);
});

test("Codex: Stop while it works, a failure in Codex's words, Start again, Clean up archives its thread", async ({
  page,
}) => {
  cpr = await serveWorkspaces({ codex: true });
  await page.goto(`${cpr.url}`);
  await startWithCodex(page);
  const here = panel(page);
  await expect(workspaceRow(page)).toContainText('Working', POLL);
  await expect(here.getByText("CPR's prompt")).toBeVisible(POLL);

  // Stop: the run ends (its process group), the thread says so.
  await here.getByRole('button', { name: 'Stop the agent' }).click();
  await expect(workspaceRow(page)).toContainText('Stopped', POLL);

  // Started again: a new run, which fails in Codex's words.
  await here.getByRole('button', { name: 'Start the agent' }).click();
  await expect(workspaceRow(page)).toContainText('Working', POLL);
  expect(cpr.codexCalls()).toHaveLength(2);
  cpr.codexTurn(BRANCH, { fail: 'unexpected status 401 Unauthorized' });
  await expect(workspaceRow(page)).toContainText(
    'Its agent failed: unexpected status 401 Unauthorized',
    POLL,
  );

  // Clean up, unmerged: asked first; its threads archived, its worktree removed.
  await here.getByRole('button', { name: 'More actions' }).click();
  await here.getByRole('menuitem', { name: 'Clean up…' }).click();
  await here.getByRole('button', { name: 'Clean up anyway' }).click();
  await expect(workspaceRow(page)).toHaveCount(0, POLL);
  expect(cpr.codexArchived().sort()).toEqual(['thread-0', 'thread-1']);
  expect(existsSync(cpr.folder(BRANCH))).toBe(false);
  expect(
    execFileSync('git', ['branch', '--list', BRANCH], { cwd: cpr.repo, encoding: 'utf8' }),
  ).toContain(BRANCH);
});

test('the dialog offers the agents installed: Codex alone, or Claude Code alone, with no picker', async ({
  page,
}) => {
  cpr = await serveWorkspaces({ agent: false, codex: true });
  await page.goto(`${cpr.url}history`);
  await openDialog(page);
  await expect(dialog(page)).toContainText('Codex · your ChatGPT account');
  await expect(dialog(page).getByLabel('agent')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Codex is working');
  cpr.stop();

  cpr = await serveWorkspaces();
  await page.goto(`${cpr.url}history`);
  await openDialog(page);
  await expect(dialog(page)).toContainText('Claude Code · your Pro subscription');
  await expect(dialog(page).getByLabel('agent')).toHaveCount(0);
});
