import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './cpr.js';

// Codex on its app server (V27a): a workspace's thread started on the person's daemon (faked in
// this process, as Codex 0.163 answers), read from there — CPR's prompt, a turn typed in Codex's
// own terminal, an approval it waits on — and a message that joins the turn that runs.
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
const panel = (page: Page) => page.getByRole('region', { name: `Workspace ${BRANCH}` });
const workspaceRow = (page: Page) => page.locator(`.workspace-row[data-branch="${BRANCH}"]`);
const box = (page: Page) => panel(page).getByRole('textbox', { name: 'Reply to the agent' });

/** Starts a workspace with Codex (the only agent installed), from the page open. */
const start = async (page: Page) => {
  await page.getByRole('button', { name: 'Start a workspace' }).click();
  await dialog(page).getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await dialog(page).getByRole('textbox', { name: 'Goal' }).fill('Return a / 2, and test it.');
  await dialog(page).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
};

test('Codex on its app server: its thread from there, a turn typed in its terminal, an approval it waits on, a message that joins its turn', async ({
  page,
}) => {
  cpr = await serveWorkspaces({ agent: false, codex: true, appServer: true });
  const server = cpr.codexServer!;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(cpr.url);
  await start(page);
  const folder = cpr.folder(BRANCH);
  await expect(page.getByRole('status')).toHaveText(
    `Started ${BRANCH}: Codex is working in ${folder}.`,
  );

  // On the server, not through CPR's runner: a thread in the worktree, named after the branch,
  // the branch's git folders writable.
  expect(cpr.codexCalls()).toEqual([]);
  const [thread, ...more] = server.threads;
  expect(more).toEqual([]);
  const common = realpathSync(join(cpr.repo, '.git'));
  expect(thread).toMatchObject({
    cwd: folder,
    name: BRANCH,
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    writableRoots: [
      join(common, 'worktrees', 'feature-add-a-half-function'),
      join(common, 'objects'),
      join(common, 'refs', 'heads', 'feature'),
      join(common, 'logs', 'refs', 'heads', 'feature'),
    ],
  });
  const id = thread!.id;

  // Its panel: CPR's prompt, read from the server; Talk joins the same thread there.
  await page.goto(`${cpr.url}?branch=${encodeURIComponent(BRANCH)}`);
  const here = panel(page);
  await expect(here.getByText("CPR's prompt")).toBeVisible(POLL);
  await expect(workspaceRow(page)).toContainText('Working', POLL);
  const talk = here.getByRole('button', { name: 'Talk' });
  await expect(talk).not.toHaveAttribute('title', /not recorded/);
  await talk.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `codex resume ${id} --remote ${server.address} -C ${folder}`,
  );

  // Its plan, then a turn the person typed in Codex's own terminal: both in the thread.
  server.reply(id, 'Plan\n1. Add half(a) to src/half.ts\n2. Test it');
  await expect(workspaceRow(page)).toContainText('Plan ready: read it and answer', POLL);
  await expect(here.locator('.thread-agent ol li').first()).toHaveText(
    'Add half(a) to src/half.ts',
    POLL,
  );
  // Typed in the person's own terminal (Talk): back on the page, it is read again (focus).
  server.typed(id, 'Go ahead, from the terminal');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(here.locator('.thread-you').last()).toHaveText(/Go ahead, from the terminal/, POLL);
  await expect(workspaceRow(page)).toContainText('Working', POLL);

  // A message while it works joins its turn: sent at once, nothing stopped.
  await expect(here.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await box(page).fill('Also test it.');
  await box(page).press('Control+Enter');
  await expect(here.locator('.thread-you').last()).toHaveText(/Also test it\./, POLL);
  expect(server.thread(id).turns.map((t) => t.status)).toEqual(['completed', 'inProgress']);
  expect(server.calls.map((c) => c.method)).toContain('turn/steer');
  expect(server.calls.map((c) => c.method)).not.toContain('turn/interrupt');

  // It asks for an approval: "needs you", and what it said in the thread.
  server.ask(id, 'May I run pnpm install with the network?', 'pnpm install');
  await expect(workspaceRow(page)).toContainText('Waiting: approval prompt', POLL);
  await expect(here.locator('.thread-agent').last()).toContainText(
    'May I run pnpm install with the network?',
    POLL,
  );

  // It commits and answers: ready for review.
  cpr.commit(BRANCH, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  server.reply(id, 'Added half, committed.');
  await expect(here.locator('.thread-agent').last()).toContainText('Added half, committed.', POLL);
  await expect(workspaceRow(page)).toContainText('Ready for review', POLL);
});

test('Codex on its app server: Stop interrupts its turn, Start again makes a new thread, Clean up archives both there', async ({
  page,
}) => {
  cpr = await serveWorkspaces({ agent: false, codex: true, appServer: true });
  const server = cpr.codexServer!;
  await page.goto(cpr.url);
  await start(page);
  const here = panel(page);
  await expect(workspaceRow(page)).toContainText('Working', POLL);

  await here.getByRole('button', { name: 'Stop the agent' }).click();
  await expect(workspaceRow(page)).toContainText('Stopped', POLL);
  expect(server.threads[0]?.turns.at(-1)?.status).toBe('interrupted');

  await here.getByRole('button', { name: 'Start the agent' }).click();
  await expect(workspaceRow(page)).toContainText('Working', POLL);
  expect(server.threads).toHaveLength(2);
  server.fail(server.threads[1]!.id, 'unexpected status 401 Unauthorized');
  await expect(workspaceRow(page)).toContainText(
    'Its agent failed: unexpected status 401 Unauthorized',
    POLL,
  );

  await here.getByRole('button', { name: 'Clean up' }).click();
  await here.getByRole('button', { name: 'Clean up anyway' }).click();
  await expect(workspaceRow(page)).toHaveCount(0, POLL);
  expect(server.threads.map((t) => t.archived)).toEqual([true, true]);
  expect(cpr.codexArchived()).toEqual([]);
  expect(existsSync(cpr.folder(BRANCH))).toBe(false);
});
