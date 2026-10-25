import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Codex on its app server (V27a): a workspace's thread started on the person's daemon (faked in
// this process, as Codex 0.163 answers), read from there — Symbiote's prompt, a turn typed in
// Codex's own terminal, an approval it waits on — and a message that joins the turn that runs.
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
/** A card's dot: its tone says its agent works, whatever it runs (V48f). */
const working = (row: Locator) => row.locator('.state-dot');
const workspaceRow = (page: Page) => page.locator(`.workspace-row[data-branch="${BRANCH}"]`);
const box = (page: Page) => panel(page).getByRole('textbox', { name: 'Reply to the agent' });
const screen = (page: Page) => panel(page).locator('.agent-terminal .xterm-rows');

/** Starts a workspace with Codex (the only agent installed), from the page open. */
const start = async (page: Page) => {
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await startPage(page).getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await startPage(page).getByRole('textbox', { name: 'Goal' }).fill('Return a / 2, and test it.');
  await startPage(page).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(startPage(page)).toBeHidden();
};

test('Codex on its app server, without terminals: its thread from there, a turn typed in your terminal, an approval it waits on, a message that joins its turn', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ agent: false, codex: true, appServer: true, terminal: false });
  const server = symbiote.codexServer!;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(symbiote.url);
  await start(page);
  const folder = symbiote.folder(BRANCH);
  await expect(page.getByRole('status')).toHaveText(
    `Started ${BRANCH}: Codex is working in ${folder}.`,
  );

  // On the server, not through Symbiote's runner: a thread in the worktree, named after the branch,
  // the branch's git folders writable.
  expect(symbiote.codexCalls()).toEqual([]);
  const [thread, ...more] = server.threads;
  expect(more).toEqual([]);
  const common = realpathSync(join(symbiote.repo, '.git'));
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

  // Its panel: Symbiote's prompt, read from the server; Talk joins the same thread there.
  await page.goto(`${symbiote.url}?branch=${encodeURIComponent(BRANCH)}`);
  const here = panel(page);
  await expect(here.getByText("Symbiote's prompt")).toBeVisible(POLL);
  await expect(working(workspaceRow(page))).toHaveClass(/tone-working/, POLL);
  await here.getByRole('button', { name: 'More actions' }).click();
  const talk = here.getByRole('menuitem', { name: 'Talk' });
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
  await expect(working(workspaceRow(page))).toHaveClass(/tone-working/, POLL);

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
  // Its card says what it asked (V48); its heading, what it waits on.
  await expect(workspaceRow(page)).toContainText('May I run pnpm install with the network?', POLL);
  await expect(here.locator('.workspace-top')).toContainText('Waiting: approval prompt');
  await expect(here.locator('.thread-agent').last()).toContainText(
    'May I run pnpm install with the network?',
    POLL,
  );

  // It commits and answers: ready for review.
  symbiote.commit(BRANCH, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  server.reply(id, 'Added half, committed.');
  await expect(here.locator('.thread-agent').last()).toContainText('Added half, committed.', POLL);
  await expect(workspaceRow(page)).toContainText('Ready for review', POLL);
});

test('Codex on its app server: Stop interrupts its turn, Start again makes a new thread, Clean up archives both there', async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ agent: false, codex: true, appServer: true });
  const server = symbiote.codexServer!;
  await page.goto(symbiote.url);
  await start(page);
  const here = panel(page);
  await expect(working(workspaceRow(page))).toHaveClass(/tone-working/, POLL);

  await here.getByRole('button', { name: 'Stop the agent' }).click();
  await expect(workspaceRow(page)).toContainText('Stopped', POLL);
  expect(server.threads[0]?.turns.at(-1)?.status).toBe('interrupted');

  await here.getByRole('button', { name: 'Start the agent' }).click();
  await expect(working(workspaceRow(page))).toHaveClass(/tone-working/, POLL);
  expect(server.threads).toHaveLength(2);
  server.fail(server.threads[1]!.id, 'unexpected status 401 Unauthorized');
  await expect(workspaceRow(page)).toContainText(
    'Its agent failed: unexpected status 401 Unauthorized',
    POLL,
  );

  await here.getByRole('button', { name: 'More actions' }).click();
  await here.getByRole('menuitem', { name: 'Clean up…' }).click();
  await here.getByRole('button', { name: 'Clean up anyway' }).click();
  await expect(workspaceRow(page)).toHaveCount(0, POLL);
  expect(server.threads.map((t) => t.archived)).toEqual([true, true]);
  expect(symbiote.codexArchived()).toEqual([]);
  expect(existsSync(symbiote.folder(BRANCH))).toBe(false);
});

test("Codex's own terminal in its panel: the trust it asks for, a turn typed there followed, Stop ending its commands (V27b)", async ({
  page,
}) => {
  symbiote = await serveWorkspaces({ agent: false, codex: true, appServer: true });
  const server = symbiote.codexServer!;
  await page.goto(symbiote.url);
  await start(page);
  const here = panel(page);
  const folder = symbiote.folder(BRANCH);
  const id = server.threads[0]!.id;

  // The panel opens on Codex's terminal, its thread joined; no box, no Talk.
  await expect(here.getByRole('tab', { name: 'Terminal' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(box(page)).toBeHidden();
  await expect(here.getByRole('menuitem', { name: 'Talk' })).toHaveCount(0);
  await expect(here.getByRole('tab', { name: 'Terminal' })).toHaveAttribute(
    'title',
    /\? in an empty prompt lists Codex's keys/,
  );
  // Codex asks to trust the worktree first: the panel says so, and the answer is the person's.
  await expect(screen(page)).toContainText('Trust this folder?', POLL);
  await expect(here.locator('.terminal-trust')).toContainText(
    'Codex asks first whether you trust this worktree',
  );
  expect(symbiote.codexResumes()).toEqual([
    { args: ['resume', id, '--remote', server.address, '-C', folder], cwd: realpathSync(folder) },
  ]);
  await page.keyboard.press('Enter');
  await expect(screen(page)).toContainText(`Fake Codex · ${id}`, POLL);
  expect(server.trusted[realpathSync(folder)]).toBe('trusted');
  // Answered: the note has done its work.
  await expect(here.locator('.terminal-trust')).toHaveCount(0);

  // Its plan, then a turn typed in the terminal: the row follows while the terminal is open,
  // without the page losing focus.
  server.reply(id, 'Plan: add half(a).');
  await expect(workspaceRow(page)).toContainText('Plan ready', POLL);
  await page.keyboard.type('Go ahead.');
  await page.keyboard.press('Enter');
  await expect(screen(page)).toContainText('sent: Go ahead.', POLL);
  await expect(working(workspaceRow(page))).toHaveClass(/tone-working/, POLL);

  // The thread, read only, has it; leaving the terminal hangs it up, the thread goes on.
  await here.getByRole('tab', { name: 'Thread' }).click();
  await expect(here.locator('.thread-you').last()).toContainText('Go ahead.', POLL);
  await expect(box(page)).toBeHidden();
  await expect.poll(() => symbiote.codexHangups()).toEqual([id]);
  expect(server.thread(id).turns.at(-1)?.status).toBe('inProgress');

  // Opened again: trusted now, nothing to say first.
  await here.getByRole('button', { name: 'open its terminal' }).click();
  await expect(screen(page)).toContainText(`Fake Codex · ${id}`, POLL);
  await expect(here.locator('.terminal-trust')).toHaveCount(0);

  // Stop ends the turn and the command it left running.
  server.command(id, 'pnpm dev');
  await here.getByRole('button', { name: 'Stop the agent' }).click();
  await expect(workspaceRow(page)).toContainText('Stopped', POLL);
  expect(server.thread(id).terminals).toEqual([]);
});
