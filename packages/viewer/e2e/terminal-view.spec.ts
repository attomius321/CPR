import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// V89 (decisions 823–834): a workspace's terminal view as the redesign draws it: the steps in the
// head, session tabs that name what runs in them, the bar under the terminal, Focus, Split, and a
// plan that waits with Approve plan. The terminal first: no toggle attaches the agent again.
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

const POLL = { timeout: 15_000 };
const BRANCH = 'feature/cart';

const start = (page: Page, branch: string, title: string, planFirst = false) =>
  page.evaluate(
    async ({ branch, title, planFirst }) => {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
        body: JSON.stringify({
          kind: 'feature',
          title,
          parts: { goal: `${title}.` },
          branch,
          planFirst,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
    },
    { branch, title, planFirst },
  );

const panel = (page: Page, branch = BRANCH) =>
  page.getByRole('region', { name: `Workspace ${branch}` });
const tabs = (page: Page) => panel(page).getByRole('tablist', { name: 'Talk to the agent' });
const bar = (page: Page) => panel(page).getByRole('region', { name: 'Agent status' });
const screen = (page: Page) => panel(page).locator('.agent-terminal .xterm-rows').first();

/** Opens a workspace started through the API, its agent's terminal drawn. */
async function opened(page: Page, planFirst = false) {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
  await start(page, BRANCH, 'Save a cart', planFirst);
  await page.goto(`${symbiote.url}?branch=${encodeURIComponent(BRANCH)}`);
  await expect(screen(page)).toContainText('Fake Claude Code', POLL);
}

test('the head says the steps; the tabs name the agent and what runs in each shell', async ({
  page,
}) => {
  await opened(page);
  const head = panel(page).locator('.workspace-top');
  // Normal mode, no plan first: Build, Review, Merge; building now, the agent's turn.
  await expect(head.locator('.head-steps')).toContainText('Build');
  await expect(
    head.getByRole('img', { name: 'Build now, Review and Merge to come' }),
  ).toBeVisible();
  await expect(head.locator('.head-steps')).toContainText('Commits0');
  // The agent's tab by its name, with an amber dot while it works; then the views.
  await expect(tabs(page).getByRole('tab')).toHaveText([
    'Claude Code',
    'Thread',
    'Activity',
    'Brief',
  ]);
  const agent = tabs(page).getByRole('tab', { name: 'Claude Code' });
  await expect(agent).toHaveAttribute('aria-selected', 'true');
  await expect(agent.locator('.stab-dot')).toHaveAttribute('data-state', 'run');

  // A shell: its program named in its tab while it runs.
  await panel(page).getByRole('button', { name: 'New shell' }).click();
  const shell = tabs(page).getByRole('tab', { name: 'Shell 1', exact: true });
  await expect(shell).toHaveAttribute('aria-selected', 'true');
  await expect(screen(page)).toContainText('$', POLL);
  await page.keyboard.type('sleep 300');
  await page.keyboard.press('Enter');
  await expect(shell.locator('.stab-what')).toHaveText('sleep', POLL);
  await expect(shell.locator('.stab-dot')).toHaveAttribute('data-state', 'ok');

  // The agent waits: its dot turns violet.
  symbiote.session(BRANCH, { state: 'blocked', waitingFor: 'permission prompt' });
  await expect(agent.locator('.stab-dot')).toHaveAttribute('data-state', 'you', POLL);
  await expect(head.locator('.head-steps')).toContainText('asks you');
});

test("the bar under the terminal: what waits in the agent's words, the keys that answer it, never a button", async ({
  page,
}) => {
  await opened(page);
  // Working: what it does, and Symbiote's own keys.
  await expect(bar(page)).toContainText('Claude Code is working', POLL);
  await expect(bar(page)).toContainText('opens a path');

  symbiote.hook(BRANCH, {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'npm install pg' },
  });
  symbiote.hook(BRANCH, {
    hook_event_name: 'Notification',
    notification_type: 'permission_prompt',
    message: 'Claude needs your permission to use Bash',
  });
  symbiote.session(BRANCH, { state: 'blocked', waitingFor: 'permission prompt' });
  await expect(bar(page)).toContainText('Claude needs your permission to use Bash', POLL);
  await expect(bar(page).locator('kbd')).toHaveText(['Enter', 'Esc']);
  await expect(bar(page)).toContainText('allows it');
  await expect(bar(page)).toContainText('says no and ends its turn');
  // Nothing in it answers for the person.
  await expect(bar(page).getByRole('button', { name: /yes|allow|no|approve/i })).toHaveCount(0);
  // The waiting strip of V48 is gone: the bar says it.
  await expect(panel(page).locator('.workspace-strip')).toHaveCount(0);

  // On the thread, the bar says it too, with the way to the terminal.
  await tabs(page).getByRole('tab', { name: 'Thread' }).click();
  await expect(bar(page)).toContainText('Claude needs your permission to use Bash');
  await bar(page).getByRole('button', { name: 'Answer in its terminal' }).click();
  await expect(tabs(page).getByRole('tab', { name: 'Claude Code' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(panel(page).locator('.xterm-helper-textarea')).toBeFocused(POLL);
});

test('Focus: the sidenav as its rail and no side card, kept across a reload, the agent not attached again', async ({
  page,
}) => {
  await opened(page);
  const attached = symbiote.attaches().length;
  const focus = panel(page).getByRole('button', { name: 'Focus' });
  await expect(page.locator('aside.changes')).toBeVisible();
  await focus.click();
  await expect(focus).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.shell')).toHaveClass(/\bfolded\b/);
  await expect(page.locator('aside.changes')).toHaveCount(0);
  // Typing still reaches the agent.
  await panel(page).locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('hello');
  await expect(screen(page)).toContainText('> hello');
  expect(symbiote.attaches()).toHaveLength(attached);

  // Remembered in the browser, as the sidenav's fold is.
  await page.reload();
  await expect(panel(page).getByRole('button', { name: 'Focus' })).toHaveAttribute(
    'aria-pressed',
    'true',
    POLL,
  );
  await expect(page.locator('aside.changes')).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Focus' }).click();
  await expect(page.locator('aside.changes')).toBeVisible();
  // The person's own fold is theirs: Focus off, the sidenav open again.
  await expect(page.locator('.shell')).not.toHaveClass(/\bfolded\b/);
});

test('Split: the agent and a shell side by side, in the address, the agent not attached again', async ({
  page,
}) => {
  await opened(page);
  const attached = symbiote.attaches().length;
  const split = panel(page).getByRole('button', { name: 'Split' });
  await split.click();
  await expect(split).toHaveAttribute('aria-pressed', 'true');
  const panes = panel(page).locator('.term-pane');
  await expect(panes).toHaveCount(2);
  await expect(page).toHaveURL(/[?&]split=1(&|$)/);
  // A new shell for its right pane; both tabs marked.
  await expect(panes.nth(1).locator('.xterm-rows')).toContainText('$', POLL);
  await expect(tabs(page).getByRole('tab', { name: 'Claude Code' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(tabs(page).getByRole('tab', { name: 'Shell 1', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Each pane takes its own keys.
  await panes.nth(1).locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('echo right-$((1+1))');
  await page.keyboard.press('Enter');
  await expect(panes.nth(1).locator('.xterm-rows')).toContainText('right-2', POLL);
  await panes.nth(0).locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('left');
  // Sent, the fake says the whole line: the split's resize redraws its prompt, and it came between
  // two keys on CI (`> l[49x37]> eft`, fix-ci-green).
  await page.keyboard.press('Enter');
  await expect(panes.nth(0).locator('.xterm-rows')).toContainText('got: left', POLL);
  expect(symbiote.attaches()).toHaveLength(attached);

  // Kept through a reload; off again, the agent alone, not attached again.
  await page.reload();
  await expect(panel(page).locator('.term-pane')).toHaveCount(2, POLL);
  await expect(panel(page).locator('.term-pane').nth(1).locator('.xterm-rows')).toContainText(
    'right-2',
    POLL,
  );
  // A reload attaches the agent's pane once, as any page load does: counted once its terminal is
  // drawn (the fake writes it after recording the attach), not when the shell's is. Under load the
  // shell's pane drew first and the reload's attach was counted as Split's (5 of 24 runs).
  await expect(panel(page).locator('.term-pane').nth(0).locator('.xterm-rows')).toContainText(
    'Fake Claude Code',
    POLL,
  );
  expect(symbiote.attaches()).toHaveLength(attached + 1);
  const reattached = symbiote.attaches().length;
  await panel(page).getByRole('button', { name: 'Split' }).click();
  await expect(panel(page).locator('.term-pane')).toHaveCount(1);
  await expect(page).not.toHaveURL(/split=/);
  expect(symbiote.attaches()).toHaveLength(reattached);
});

test('a plan that waits: typeset, and Approve plan types the OK into its terminal and sends it', async ({
  page,
}) => {
  await opened(page, true);
  const head = panel(page).locator('.workspace-top');
  await expect(head.locator('.head-steps')).toContainText('Plan');
  symbiote.report(
    BRANCH,
    '# Save a cart\n\n## Today\nA cart lives in memory.\n\n## What I would change\n1. `src/cart.ts`',
  );
  await expect(head.locator('.head-steps')).toContainText('Your OK', POLL);
  await expect(
    head.getByRole('img', {
      name: 'Plan done, Your OK waits for you, Build, Review and Merge to come',
    }),
  ).toBeVisible();
  await expect(bar(page)).toContainText('The plan waits for your OK');

  await tabs(page).getByRole('tab', { name: 'Thread' }).click();
  const plan = panel(page).locator('.thread-plan');
  await expect(plan).toBeVisible();
  await expect(plan.getByRole('heading', { name: 'Save a cart' })).toBeVisible();
  const reply = panel(page).locator('form.reply');
  await expect(reply.getByRole('button', { name: 'Send reply' })).toBeVisible();
  await reply.getByRole('button', { name: 'Approve plan' }).click();
  // Typed into its terminal and sent (decision 834): the agent's prompt, the terminal shown.
  await expect(tabs(page).getByRole('tab', { name: 'Claude Code' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(screen(page)).toContainText(
    'got: Your plan is approved. Build it as planned, and commit in small steps.',
    POLL,
  );
  // Its turn starts: Approve plan is no longer offered.
  symbiote.session(BRANCH, { state: 'working' });
  await expect(head.locator('.head-steps')).toContainText('Build', POLL);
  await tabs(page).getByRole('tab', { name: 'Thread' }).click();
  await expect(panel(page).getByRole('button', { name: 'Approve plan' })).toHaveCount(0);
});

test('Send reply on a plan that waits types the reply into its terminal and sends it', async ({
  page,
}) => {
  await opened(page, true);
  symbiote.report(BRANCH, '# Save a cart\n\nOne saved cart an account.');
  await tabs(page).getByRole('tab', { name: 'Thread' }).click();
  const reply = panel(page).locator('form.reply');
  await expect(reply.getByRole('button', { name: 'Approve plan' })).toBeVisible(POLL);
  await reply.getByRole('textbox', { name: 'Reply to the agent' }).fill('Keep two carts');
  await reply.getByRole('button', { name: 'Send reply' }).click();
  await expect(screen(page)).toContainText('got: Keep two carts', POLL);
});
