import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { spinner } from './spinner.js';
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
  startPage(page).getByRole('textbox', { name: 'Branch name', exact: true });
const row = (page: Page, subject: string) =>
  page.locator('.commit', {
    has: page.locator('.commit-subject').getByText(subject, { exact: true }),
  });

test('starts a workspace from the header: its branch, its worktree, the agent there', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const main = symbiote.shas.at(-1);
  await page.goto(`${symbiote.url}git`);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await expect(startPage(page)).toBeVisible();
  await expect(title(page)).toBeFocused();
  await fillWork(page, 'Add a half function', 'Return a / 2, and test it.');
  // Named after the title; where it starts and where its worktree goes.
  await expect(branch(page)).toHaveValue('feature/add-a-half-function');
  const folder = `${symbiote.repo}.worktrees/feature-add-a-half-function`;
  await expect(startPage(page)).toContainText(`Will be created from main at ${short(main)}`);
  // The worktree's path is in Branch's help (V37, decision 248).
  await startPage(page).getByRole('button', { name: 'Where its worktree goes' }).click();
  await expect(page.getByRole('tooltip')).toContainText(folder);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  // The agent, the only one installed, and whose account it runs on.
  await expect(startPage(page).locator('.start-value')).toHaveText('Claude Code');
  await expect(startPage(page)).toContainText('your Pro subscription');
  await expect(startPage(page).getByLabel('Plan first and wait for my OK')).toBeChecked();
  await startPage(page).getByRole('button', { name: 'Start workspace' }).click();

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
  await page.goto(`${symbiote.url}git`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await page.keyboard.press('n');
  await expect(startPage(page)).toBeVisible();
  await fillWork(page, 'Something');
  await branch(page).fill('main');
  await expect(startPage(page)).toContainText('a branch main exists');
  await expect(startPage(page).getByRole('button', { name: 'Start workspace' })).toBeDisabled();
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
  await page.goto(`${symbiote.url}git`);
  await row(page, 'base').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start a workspace here' }).click();
  await expect(startPage(page)).toContainText(`Will be created from the commit ${short(base)}`);
  await fillWork(page, 'Fix from the base');
  await startPage(page).getByRole('button', { name: 'Start workspace' }).click();
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
  await page.goto(`${symbiote.url}git`);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await fillWork(page, 'Add a half function');
  await startPage(page).getByRole('button', { name: 'Start workspace' }).click();
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
  await page.goto(`${symbiote.url}git`);
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
  // Working: its tools recorded (V48f), none running yet.
  await expect(group(page, 'Working').locator(row)).toContainText('Thinking');

  // The agent asks for a permission: it needs you, and the sidenav counts it.
  symbiote.session(branch, { state: 'blocked', waitingFor: 'permission prompt' });
  await expect(group(page, 'Waiting for you').locator(row)).toContainText(
    'Waiting: permission prompt',
    POLL,
  );
  await expect(page.locator('.sidenav .page-count')).toHaveText('1');

  // Esc in its session: no hook fires and Claude Code still says `working`, but it waits.
  symbiote.interrupt(branch);
  await expect(group(page, 'Waiting for you').locator(row)).toContainText(
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

test('the agents that wait for you: first, what each asks, Respond, the count in the title, the next one (V48)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  await startFrom(page, 'Pick a store');
  const tests = 'feature/add-a-half-function';
  const store = 'feature/pick-a-store';
  const waiting = group(page, 'Waiting for you');
  await expect(waiting).toHaveCount(0);

  // It asks to run a command: in Waiting for you, saying what it asks, counted.
  symbiote.hook(tests, {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'pnpm test -- --run src/half' },
  });
  symbiote.session(tests, { state: 'blocked', waitingFor: 'permission prompt' });
  await expect(waiting.locator(workspaceRow(page, tests))).toContainText(
    'Permission to run pnpm test -- --run src/half',
    POLL,
  );
  await expect(page.locator('.sidenav .page-count')).toHaveText('1');
  await expect(page).toHaveTitle(/^\(1\) /);
  // Its kind ends over its time, as on every card (V53).
  const card = waiting.locator(workspaceRow(page, tests));
  const [kind, age] = await Promise.all(
    [card.locator('.kind-tag'), card.locator('.workspace-respond .commit-date')].map((part) =>
      part.boundingBox(),
    ),
  );
  expect(Math.abs(kind!.x + kind!.width - (age!.x + age!.width))).toBeLessThanOrEqual(1);

  // Respond: its workspace, on its terminal, focused.
  await page.goto(`${symbiote.url}git`);
  await waiting.locator(workspaceRow(page, tests)).getByRole('button', { name: 'Respond' }).click();
  await expect(panel(page, tests)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Terminal' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(terminal(page, tests).locator('.xterm-helper-textarea')).toBeFocused(POLL);
  // Its heading's strip says it too, with Respond there.
  const strip = panel(page, tests).getByRole('region', { name: 'Waiting for you' });
  await expect(strip).toContainText('Permission to run pnpm test -- --run src/half');

  // A second asks a question: two, the next one a click away.
  symbiote.hook(store, {
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [{ question: 'Which store?', options: [{ label: 'Redis' }, { label: 'SQLite' }] }],
    },
  });
  symbiote.session(store, { state: 'blocked', waitingFor: 'question' });
  await expect(page.locator('.sidenav .page-count')).toHaveText('2', POLL);
  await expect(page).toHaveTitle(/^\(2\) /);
  await strip.getByRole('button', { name: 'Next waiting (1)' }).click();
  await expect(panel(page, store)).toBeVisible();
  await expect(panel(page, store).getByRole('region', { name: 'Waiting for you' })).toContainText(
    'Asks: Which store? — Redis · SQLite',
  );

  // Answered: it leaves the section by itself, no reload.
  symbiote.session(tests, { state: 'working' });
  await expect(waiting.locator(workspaceRow(page, tests))).toHaveCount(0, POLL);
  await expect(group(page, 'Working').locator(workspaceRow(page, tests))).toBeVisible();
  await expect(page.locator('.sidenav .page-count')).toHaveText('1');
  await expect(page).toHaveTitle(/^\(1\) /);
});

// N2: in the app, the page says what waits; the app puts a dot on the window's icon. Here a
// stand-in app records what the page says.
test('what waits is said to the app: from a diff too, and while the window is hidden (N2)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const said: number[] = [];
    Object.assign(window, {
      said,
      symbioteApp: {
        platform: 'linux',
        titleBar: () => undefined,
        waiting: (n: number) => said.push(n),
      },
    });
  });
  const said = () => page.evaluate(() => (window as unknown as { said: number[] }).said);
  const last = async () => (await said()).at(-1);
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}history`);
  await startFrom(page, 'Add a half function');
  const tests = 'feature/add-a-half-function';
  // Nothing waits: said once, after the first read, and not again while it stays so.
  await expect.poll(said).toEqual([0]);

  symbiote.session(tests, { state: 'blocked', waitingFor: 'permission prompt' });
  await expect.poll(last, POLL).toBe(1);
  await expect(page).toHaveTitle(/^\(1\) /);

  // A diff's page is a document of its own: it says it too, once it has read.
  const [base, head] = symbiote.shas;
  await page.goto(`${symbiote.url}diff/${base}..${head}/`);
  await expect.poll(said, POLL).toEqual([1]);

  // Hidden, as a minimized window: the app's page still reads, and says it was answered.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  symbiote.session(tests, { state: 'working' });
  await expect.poll(last, POLL).toBe(0);
});

test('a working agent says what it runs, from its tools, and since when; thinking between them (V48f)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const row = workspaceRow(page, branch);
  const tool = (event: string, id: string) =>
    symbiote.hook(branch, {
      hook_event_name: event,
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test -- --run src/half' },
      tool_use_id: id,
    });
  tool('PreToolUse', 't1');
  await expect(row.locator('.workspace-state strong')).toHaveText(
    'Running pnpm test -- --run src/half',
    POLL,
  );
  // Since its prompt: under a minute, in its heading.
  await expect(panel(page, branch).locator('.state-for')).toHaveText(/under a minute/);
  tool('PostToolUse', 't1');
  await expect(row.locator('.workspace-state strong')).toHaveText('Thinking', POLL);
});

test("a working agent's dot is a spinner, a turn a second; without motion it holds still (V53)", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const dot = workspaceRow(page, 'feature/add-a-half-function').locator('.state-dot');
  await expect(dot).toHaveClass(/tone-working/);
  // Wider than the 7 px dot, drawn around its place: the name does not move.
  await expect
    .poll(() => spinner(dot))
    .toEqual({ animation: 'state-spin 1s', across: 11, comet: true });
  // Without motion: the arc, still — its own shape beside a waiting dot's halo.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => spinner(dot)).toEqual({ animation: 'none 0s', across: 11, comet: true });
});

test('a working card names its agent by its mark, in its colour, before what it does; none on Symbiote’s words (V53)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const row = workspaceRow(page, branch);
  const state = row.locator('.workspace-state');
  await expect(state.locator('strong')).toHaveText('Thinking');
  // Claude's spark, first on the line, named; in Claude's terracotta.
  const mark = state.getByRole('img', { name: 'Claude Code' });
  await expect(mark).toBeVisible();
  await expect(state.locator('> :first-child')).toHaveClass(/agent-mark/);
  expect(await mark.evaluate((svg) => getComputedStyle(svg).fill)).toBe('rgb(217, 119, 87)');
  expect(await mark.boundingBox()).toMatchObject({ width: 14, height: 14 });
  // Its heading's line too.
  await expect(
    panel(page, branch).locator('.workspace-state').getByRole('img', { name: 'Claude Code' }),
  ).toBeVisible();

  // Finished with a commit: what is next is Symbiote's to say, not the agent's doing.
  symbiote.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  symbiote.session(branch, { state: 'done' });
  await expect(state.locator('strong')).toHaveText('Ready for review', POLL);
  await expect(row.locator('.agent-mark')).toHaveCount(0);
});

test('every card says its kind in a chip at the end of its name’s line, Feature too (V53)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const row = workspaceRow(page, 'feature/add-a-half-function');
  const chip = row.locator('.workspace-head .kind-tag');
  await expect(chip).toHaveText('feature');
  await expect(row.locator('.workspace-branch .kind-tag')).toHaveCount(0);
  // At the line's end, over its time: the kinds make a column down the list.
  const [name, tag, time] = await Promise.all(
    [row.locator('.workspace-about'), chip, row.locator('.workspace-line .commit-date')].map(
      (part) => part.boundingBox(),
    ),
  );
  expect(tag!.x).toBeGreaterThan(name!.x + name!.width);
  expect(Math.abs(tag!.x + tag!.width - (time!.x + time!.width))).toBeLessThanOrEqual(1);
  // The style's metadata chip: raised, no edge; 22 px for its 13 px words (V61).
  expect(
    await chip.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopWidth, style.height];
    }),
  ).toEqual(['0px', '22px']);
  // The heading: its kind before its name, as before.
  await expect(
    panel(page, 'feature/add-a-half-function').locator('.workspace-title h1 .kind-tag'),
  ).toHaveText('feature');
  // Folded to the rail: the card is its dot alone.
  await page.getByRole('button', { name: 'Fold the sidenav' }).click();
  await expect(row.locator('.state-dot')).toBeVisible();
  await expect(chip).toBeHidden();
});

test('an agent that starts waiting while you are elsewhere: one line in the status bar, and Open (V48)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  await page.getByRole('link', { name: 'Git' }).first().click();
  const bar = page.getByRole('contentinfo', { name: 'Status bar' });
  symbiote.hook(branch, {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'pnpm test' },
  });
  symbiote.session(branch, { state: 'blocked', waitingFor: 'permission prompt' });
  await expect(bar).toContainText(
    'Add a half function waits for you: Permission to run pnpm test',
    POLL,
  );
  await bar.getByRole('link', { name: 'Open' }).click();
  await expect(panel(page, branch)).toBeVisible();
});

test('Symbiote not answering: what was read stays, said to be old, and comes back by itself (V48)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const row = workspaceRow(page, 'feature/add-a-half-function');
  await expect(row).toBeVisible();
  await page.route('**/api/workspaces', (route) => route.abort());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const stale = page.locator('.sidenav .workspaces-stale');
  await expect(stale).toContainText(/^Not updated since .+: Symbiote does not answer/, POLL);
  await expect(row).toBeVisible();
  await page.unroute('**/api/workspaces');
  await expect(stale).toHaveCount(0, POLL);
});

test('while a workspace is made, its card says it starts; its own card takes its place (V48)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  // The list's first read held: its cards' outlines show meanwhile.
  let held = true;
  await page.route('**/api/workspaces', async (route) => {
    if (held && route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.goto(`${symbiote.url}`);
  await expect(page.locator('.sidenav .workspace-skeleton')).toBeVisible();
  await expect(page.getByText('No workspaces yet')).toBeVisible(POLL);
  held = false;
  // The start held: its card, starting.
  await page.route('**/api/workspaces', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1_500));
    await route.continue();
  });
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  await fillWork(page, 'Add a half function');
  await goal(page).press('Control+Enter');
  const starting = page.locator('.sidenav .workspace-row.starting');
  await expect(starting).toContainText('Starting · its worktree, then Claude Code');
  await expect(starting.locator('.state-dot')).toHaveClass(/tone-starting/);
  // The working agent's spinner (V53): busy is busy, its words say which.
  await expect
    .poll(() => spinner(starting.locator('.state-dot')))
    .toEqual({ animation: 'state-spin 1s', across: 11, comet: true });
  // A card's height, as every card's (look.spec.ts).
  expect((await starting.boundingBox())?.height ?? 0).toBeLessThanOrEqual(72);
  await expect(starting).toHaveCount(0, POLL);
  await expect(workspaceRow(page, 'feature/add-a-half-function')).toBeVisible();
});

test('Stop the agent says it stops until Symbiote answers (V48)', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const here = panel(page, 'feature/add-a-half-function');
  await page.route('**/api/workspaces/stop', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await here.getByRole('button', { name: 'Stop the agent' }).click();
  await expect(here.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
  await expect(here.locator('.workspace-top')).toContainText('Stopped', POLL);
});

test('a workspace and its branch lead to each other', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  symbiote.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  symbiote.session(branch, { state: 'done' });
  await page.goto(`${symbiote.url}git`);

  // The branch's mark on the commits page goes to its workspace, its card in view.
  const mark = page.locator('.commit .ref', { hasText: branch }).locator('.workspace-mark');
  // Claude Code's sessions are read at most every 2 s: the page's next look sees it.
  await expect(mark).toHaveText('●', POLL);
  await expect(mark).toHaveAttribute(
    'data-tip',
    /Workspace: Add a half function — Ready for review/,
  );
  await mark.click();
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-a-half-function`);
  await expect(workspaceRow(page, branch)).toBeInViewport();

  // The branch on the workspace goes to its tip on the commits page.
  await workspaceRow(page, branch).getByRole('link', { name: branch }).click();
  await expect(page).toHaveURL(`${symbiote.url}git?branch=feature%2Fadd-a-half-function`);
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
  await page.goto(`${symbiote.url}git`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  await page.goto(`${symbiote.url}git`);
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
  await page.goto(`${symbiote.url}git`);
  await startFrom(page, 'Add a half function');
  await startFrom(page, 'Export the totals');
  await page.goto(`${symbiote.url}git`);
  const half = 'feature/add-a-half-function';
  const totals = 'feature/export-the-totals';
  const branches = page.locator('.branches');
  // Local first, then the remote's `main`.
  const names = branches.locator('.branches-branch .branches-name');
  const entry = (branch: string) =>
    branches.locator('li.has-workspace', { has: page.locator(`[data-tip="${branch}"]`) });

  // Both agents work: the one started last on top, then the checked-out branch.
  await expect(names).toHaveText([totals, half, 'main', 'main']);
  await expect(entry(half).locator('.branches-age')).toHaveText('now');
  await expect(entry(half).locator('.branches-age')).toHaveAttribute(
    'data-tip',
    /^Last agent action (just now|1 minute ago)\n/,
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
  // Working again, its tools recorded (V48f): none running yet.
  await expect(row).toContainText('Thinking');
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
  await page.goto(`${symbiote.url}git`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  await page.goto(`${symbiote.url}git?branch=${encodeURIComponent(branch)}`);
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
  await page.goto(`${symbiote.url}git`);
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
  await expect(workspaceRow(page, branch).locator('.state-dot')).toHaveClass(/tone-working/, POLL);

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
  await page.goto(`${symbiote.url}git`);
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
  // V55: the head's primary button, no longer under ⋯; Review a plain one beside it.
  const head = panel(page, branch).locator('.workspace-top');
  const cleanUp = head.getByRole('button', { name: 'Clean up', exact: true });
  await expect(cleanUp).toHaveClass(/\bprimary\b/);
  await expect(head.getByRole('button', { name: 'Review', exact: true })).not.toHaveClass(
    /\bprimary\b/,
  );
  await panel(page, branch).getByRole('button', { name: 'More actions' }).click();
  await expect(panel(page, branch).getByRole('menuitem', { name: /^Clean up/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await cleanUp.click();
  await expect(workspaceRow(page, branch)).toHaveCount(0, POLL);
  expect(symbiote.removed()).toEqual(['fake0']);
  expect(existsSync(symbiote.folder(branch))).toBe(false);
  expect(git('branch', '--list', branch)).toBe('');
  await expect(page.getByText('No workspaces yet')).toBeVisible();
  await expect(page).toHaveURL(`${symbiote.url}git`);
  await expect(page.getByRole('contentinfo', { name: 'Status bar' })).toContainText(
    `Cleaned up ${branch}: its worktree is removed.`,
  );
});

test("a done card's icon cleans it up from the sidenav: on hover or focus, without opening it (V55)", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  symbiote.commit(branch, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');
  symbiote.session(branch, { state: 'done' });
  await startFrom(page, 'Add a double function');
  const other = 'feature/add-a-double-function';
  symbiote.commit(other, 'src/double.ts', 'export const double = (a: number) => a * 2;\n', 'Add');
  symbiote.session(other, { state: 'done' });
  git('merge', '--quiet', '--ff-only', branch);
  const card = workspaceRow(page, branch);
  await expect(card).toContainText('Merged', POLL);
  await expect(workspaceRow(page, other)).toContainText('Ready for review', POLL);
  const icon = card.getByRole('button', { name: 'Clean up Add a half function' });
  await expect(icon).toHaveAttribute(
    'data-tip',
    /Remove its sessions, its worktree and its merged/,
  );
  // Only a done card has it.
  await expect(workspaceRow(page, other).getByRole('button', { name: /^Clean up/ })).toHaveCount(0);

  // At rest it is transparent (named all the same); on hover it shows where the kind and the time
  // were, and nothing moves.
  await page.mouse.move(800, 600);
  await expect(icon).toHaveCSS('opacity', '0');
  await expect(card.locator('.kind-tag')).toBeVisible();
  const name = await card.locator('.workspace-about').boundingBox();
  await card.hover();
  await expect(icon).toHaveCSS('opacity', '1');
  await expect(card.locator('.kind-tag')).toBeHidden();
  await expect(card.locator('.workspace-line .commit-date')).toBeHidden();
  expect(await card.locator('.workspace-about').boundingBox()).toEqual(name);
  const box = await icon.boundingBox();
  const row = await card.boundingBox();
  expect(box!.width).toBe(24);
  expect(Math.round(row!.x + row!.width - (box!.x + box!.width))).toBeLessThanOrEqual(8);
  // From the keyboard: Tab from the card's name reaches it, and it shows.
  await page.mouse.move(800, 600);
  await card.locator('.workspace-about').focus();
  await page.keyboard.press('Tab');
  await expect(icon).toBeFocused();
  await expect(icon).toHaveCSS('opacity', '1');

  // A file not committed: refused, the error in the status bar, the card kept.
  writeFileSync(join(symbiote.folder(branch), 'notes.md'), 'todo\n');
  await icon.click();
  await expect(page.getByRole('alert')).toContainText('1 file not committed');
  await expect(card).toBeVisible();
  rmSync(join(symbiote.folder(branch), 'notes.md'));

  // Folded to the rail: no icon, even on hover.
  await page.getByRole('button', { name: 'Fold the sidenav' }).click();
  await card.hover();
  await expect(icon).toBeHidden();
  await page.getByRole('button', { name: 'Open the sidenav' }).click();

  // A click cleans it up and opens nothing: the workspace shown stays.
  await expect(panel(page, other)).toBeVisible();
  await card.hover();
  await icon.click();
  await expect(card).toHaveCount(0, POLL);
  await expect(panel(page, other)).toBeVisible();
  await expect(page.getByRole('contentinfo', { name: 'Status bar' })).toContainText(
    `Cleaned up ${branch}: its worktree is removed.`,
  );
  expect(existsSync(symbiote.folder(branch))).toBe(false);
  expect(git('branch', '--list', branch)).toBe('');

  // The one shown, cleaned up from its card: History takes its place.
  git('merge', '--quiet', '--no-ff', '-m', `Merge ${other}`, other);
  await expect(workspaceRow(page, other)).toContainText('Merged', POLL);
  await workspaceRow(page, other).hover();
  await workspaceRow(page, other)
    .getByRole('button', { name: 'Clean up Add a double function' })
    .click();
  await expect(workspaceRow(page, other)).toHaveCount(0, POLL);
  await expect(page).toHaveURL(`${symbiote.url}git`);
  await expect(page.getByText('No workspaces yet')).toBeVisible();
});

/** Holds the requests to `path` until `release()`: what the page shows while the server works. */
const hold = async (page: Page, path: string) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**${path}`, async (route) => {
    await held;
    await route.continue();
  });
  return () => release();
};
/** A dot's colour (`--dot`) and the token it should be. */
const dotIs = (dot: Locator, token: string) =>
  dot.evaluate(
    (element, name) => [
      getComputedStyle(element).getPropertyValue('--dot').trim(),
      getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    ],
    token,
  );

test('a card being cleaned up is disabled until it goes: it says so, opens nothing, the arrows skip it (V57)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  const half = 'feature/add-a-half-function';
  const double = 'feature/add-a-double-function';
  const triple = 'feature/add-a-triple-function';
  for (const [what, branch] of [
    ['Add a half function', half],
    ['Add a double function', double],
    ['Add a triple function', triple],
  ] as const) {
    await startFrom(page, what);
    symbiote.commit(branch, `src/${branch.slice(14, -9)}.ts`, 'export {};\n', what);
    symbiote.session(branch, { state: 'done' });
  }
  git('merge', '--quiet', '--no-ff', '-m', `Merge ${half}`, half);
  git('merge', '--quiet', '--no-ff', '-m', `Merge ${double}`, double);
  // To review, then Done: the one cleaned up is between two others.
  const card = workspaceRow(page, half);
  await expect(card).toContainText('Merged', POLL);
  await expect(workspaceRow(page, double)).toContainText('Merged', POLL);
  await expect(workspaceRow(page, triple)).toContainText('Ready for review', POLL);
  await expect(panel(page, triple)).toBeVisible();
  const before = page.url();

  const release = await hold(page, '/api/workspaces/clean');
  await card.hover();
  await card.getByRole('button', { name: 'Clean up Add a half function' }).click();
  // Disabled, saying what happens, its dot a grey comet; its name and branch dimmed, its line not.
  await expect(card).toHaveAttribute('aria-busy', 'true');
  await expect(card).toHaveAttribute('aria-disabled', 'true');
  await expect(card.locator('.workspace-state')).toHaveText(
    'Cleaning up · its worktree and its branch',
  );
  // Cut by a narrow sidenav: its tip says it whole.
  await expect(card.locator('.workspace-state')).toHaveAttribute(
    'data-tip',
    'Cleaning up · its worktree and its branch',
  );
  await expect(card.locator('.commit-date')).toHaveCount(0);
  const dot = card.locator('.state-dot');
  await expect(dot).toHaveClass(/tone-cleaning/);
  await expect
    .poll(() => spinner(dot))
    .toEqual({ animation: 'state-spin 1s', across: 11, comet: true });
  const [colour, faint] = await dotIs(dot, '--faint');
  expect(colour).toBe(faint);
  await expect(card.locator('.workspace-about')).toHaveCSS('opacity', '0.5');
  await expect(card.locator('.workspace-branch')).toHaveCSS('opacity', '0.5');
  await expect(card.locator('.workspace-line')).toHaveCSS('opacity', '1');
  // Nothing to use: no bin, no hover, its name a disabled button; a click opens nothing.
  await expect(card.locator('.workspace-about')).toBeDisabled();
  await expect(card.getByRole('button', { name: /^Clean up/ })).toHaveCount(0);
  await expect(card.locator('.kind-tag')).toBeVisible();
  await card.hover();
  // Past the wash's 150 ms transition, which starts from transparent too.
  await page.waitForTimeout(200);
  await expect(card).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(card).toHaveCSS('cursor', 'default');
  expect((await card.boundingBox())?.height ?? 0).toBeLessThanOrEqual(72);
  const box = (await card.locator('.workspace-state').boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await expect(panel(page, triple)).toBeVisible();
  expect(page.url()).toBe(before);
  // The arrows go from the card before it to the one after it, and back.
  await workspaceRow(page, triple).locator('.workspace-about').focus();
  await page.keyboard.press('ArrowDown');
  await expect(workspaceRow(page, double).locator('.workspace-about')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(workspaceRow(page, triple).locator('.workspace-about')).toBeFocused();
  // Folded: its dot, the comet; its tip says so.
  await page.getByRole('button', { name: 'Fold the sidenav' }).click();
  await expect(card).toHaveAttribute('data-tip', 'Add a half function\nCleaning up');
  await expect(dot).toHaveClass(/tone-cleaning/);
  await page.getByRole('button', { name: 'Open the sidenav' }).click();

  // Done: the card goes, the status bar says so.
  release();
  await expect(card).toHaveCount(0, POLL);
  await expect(page.getByRole('contentinfo', { name: 'Status bar' })).toContainText(
    `Cleaned up ${half}: its worktree is removed.`,
  );

  // Refused (a file not committed): disabled while it is asked, then as it was.
  writeFileSync(join(symbiote.folder(double), 'notes.md'), 'todo\n');
  await page.unrouteAll();
  const refuse = await hold(page, '/api/workspaces/clean');
  const next = workspaceRow(page, double);
  await next.hover();
  await next.getByRole('button', { name: 'Clean up Add a double function' }).click();
  await expect(next).toHaveAttribute('aria-busy', 'true');
  refuse();
  await expect(page.getByRole('alert')).toContainText('1 file not committed');
  await expect(next).not.toHaveAttribute('aria-busy');
  await expect(next).not.toHaveAttribute('aria-disabled');
  await expect(next.locator('.workspace-about')).toBeEnabled();
  await expect(next.locator('.workspace-state')).toContainText('Merged');
  await next.hover();
  await expect(next.getByRole('button', { name: 'Clean up Add a double function' })).toBeVisible();
});

test("Clean up from a workspace's head: Cleaning up…, and its card disabled until it goes; Clean up anyway says the branch stays (V57)", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  const half = 'feature/add-a-half-function';
  const double = 'feature/add-a-double-function';
  await startFrom(page, 'Add a half function');
  symbiote.commit(half, 'src/half.ts', 'export {};\n', 'Add half');
  symbiote.session(half, { state: 'done' });
  await startFrom(page, 'Add a double function');
  symbiote.commit(double, 'src/double.ts', 'export {};\n', 'Add double');
  symbiote.session(double, { state: 'done' });
  git('merge', '--quiet', '--no-ff', '-m', `Merge ${half}`, half);
  await expect(workspaceRow(page, half)).toContainText('Merged', POLL);
  await expect(workspaceRow(page, double)).toContainText('Ready for review', POLL);

  // Not merged: Clean up anyway, from ⋯; its card says the branch stays.
  const release = await hold(page, '/api/workspaces/clean');
  await more(page, double, 'Clean up…');
  await panel(page, double).getByRole('button', { name: 'Clean up anyway' }).click();
  const unmerged = workspaceRow(page, double);
  await expect(unmerged).toHaveAttribute('aria-disabled', 'true');
  await expect(unmerged.locator('.workspace-state')).toHaveText(
    'Cleaning up · its worktree; the branch stays',
  );
  // `w` focuses the first card's name: the first one there is, past the one going.
  await page.keyboard.press('w');
  await expect(workspaceRow(page, half).locator('.workspace-about')).toBeFocused();
  release();
  await expect(unmerged).toHaveCount(0, POLL);
  expect(git('branch', '--list', double)).not.toBe('');

  // Merged: the head's Clean up says it runs, its actions wait; its card is disabled.
  await page.unrouteAll();
  const go = await hold(page, '/api/workspaces/clean');
  await workspaceRow(page, half)
    .getByRole('button', { name: 'Add a half function', exact: true })
    .click();
  const head = panel(page, half).locator('.workspace-top');
  await head.getByRole('button', { name: 'Clean up', exact: true }).click();
  await expect(head.getByRole('button', { name: 'Cleaning up…' })).toBeDisabled();
  await expect(head.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
  const card = workspaceRow(page, half);
  await expect(card).toHaveAttribute('aria-disabled', 'true');
  await expect(card.locator('.workspace-state')).toHaveText(
    'Cleaning up · its worktree and its branch',
  );
  go();
  await expect(page).toHaveURL(`${symbiote.url}git`, POLL);
  await expect(card).toHaveCount(0, POLL);
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
    'data-tip',
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

// Symbiote's window on WSL gets no drop from Windows (WSLg has no drag and drop): a picker instead.
test('images chosen with Attach images attach to the message, as dropped ones do', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}`);
  await startFrom(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  await expect(screen(page, branch)).toContainText('Fake Claude Code · fake0', POLL);
  const attach = panel(page, branch).getByRole('button', { name: 'Attach images' });
  const choose = async (files: Given[]) => {
    const chosen = page.waitForEvent('filechooser');
    await attach.click();
    const chooser = await chosen;
    expect(chooser.isMultiple()).toBe(true);
    expect(await chooser.element().getAttribute('accept')).toBe(
      'image/png,image/jpeg,image/gif,image/webp',
    );
    await chooser.setFiles(
      files.map((file) => ({
        name: file.name,
        mimeType: file.type,
        buffer: Buffer.from(file.data, 'base64'),
      })),
    );
  };

  // Two chosen: both, in order, and the keys are the terminal's again.
  await choose([
    { name: 'a.gif', type: 'image/gif', data: GIF },
    { name: 'b.png', type: 'image/png', data: PNG },
  ]);
  await expect(screen(page, branch)).toContainText('[Image #1] [Image #2]');
  expect(symbiote.images().map((image) => image.data)).toEqual([GIF, PNG]);
  await page.keyboard.press('Enter');
  await expect(screen(page, branch)).toContainText('got: [Image #1] [Image #2]');

  // A file that is not an image, if the system's picker lets one through: said, nothing pasted.
  await choose([{ name: 'notes.txt', type: 'text/plain', data: btoa('hi') }]);
  await expect(terminal(page, branch).getByRole('alert')).toHaveText(
    'Only images can be attached: PNG, JPEG, GIF or WebP.',
  );
  expect(symbiote.images()).toHaveLength(2);

  // Only beside the agent's terminal.
  await panel(page, branch).getByRole('tab', { name: 'Thread' }).click();
  await expect(attach).toBeHidden();
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
  await expect(hint).toHaveText(/^Open in VS Code\s*Ctrl\s*click$/);
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
  await expect(hint).toHaveText(/^Open https:\/\/example\.com\/pr\/1\s*Ctrl\s*click$/);
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
  await expect(here.getByRole('tab')).toHaveText(['Terminal', 'Thread', 'Activity', 'Brief']);
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
    'Activity',
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
    'data-tip',
    '8 shells are open\nClose one first',
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
  await expect(here.getByRole('tab')).toHaveText(['Thread', 'Activity', 'Brief']);
  // No shells either (V45).
  await expect(here.getByRole('button', { name: 'New shell' })).toHaveCount(0);
  await here.getByRole('button', { name: 'More actions' }).click();
  await expect(here.getByRole('menuitem', { name: 'Talk' })).toHaveAttribute(
    'data-tip',
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
const doneWhen = (page: Page) => part(page, 'Done when (optional)');
const startButton = (page: Page) =>
  startPage(page).getByRole('button', { name: 'Start workspace' });
const info = (page: Page) =>
  startPage(page).getByRole('button', { name: 'About the kinds of work' });

test('each kind starts a workspace: its brief, its line, its branch, its tag (V24c)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
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

  // The list names each by its title, its kind in a chip on its name's line (V53).
  await page.goto(`${symbiote.url}`);
  const fix = workspaceRow(page, 'fix/fix-the-totals');
  await expect(fix.locator('.workspace-about')).toHaveText('Fix the totals');
  await expect(fix.locator('.workspace-head .kind-tag')).toHaveText('fix');
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
  await page.goto(`${symbiote.url}git`);
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
  await part(page, 'Where to look').fill('src/table.ts');

  // Another kind: the same text under its own label; an untouched Done when becomes its own.
  await kind(page, 'Chore').click();
  await expect(part(page, 'What to change')).toHaveValue('They sort 1, 10, 2.');
  await expect(doneWhen(page)).toHaveValue('Nothing else changes, and `npm run check` passes.');
  await expect(part(page, 'Where to look')).toHaveValue('src/table.ts');
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
  await page.goto(`${symbiote.url}git`);
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

test('the keyboard: digits and arrows pick a kind; Tab goes kind, its info, title, part and its tools, Done when, More, start from, branch, model and effort, permission, documents, each field after its help (V24c, V30, V33, V37, V40, V47, V63)', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await page.keyboard.press('n');
  await expect(title(page)).toBeFocused();
  // V63: the title's help, before it.
  await page.keyboard.press('Shift+Tab');
  await expect(startPage(page).getByRole('button', { name: 'About the title' })).toBeFocused();
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
    startPage(page).getByRole('button', { name: 'About the title' }),
    title(page),
    startPage(page).getByRole('button', { name: 'About the question' }),
    part(page, 'Question'),
    // V63: the part's tools, in its frame.
    startPage(page).getByRole('button', { name: 'Preview' }),
    startPage(page).getByRole('button', { name: 'Attach files' }),
    startPage(page).getByRole('button', { name: 'About Done when' }),
    doneWhen(page),
    startPage(page).getByRole('button', { name: /More:/ }),
    startPage(page).getByLabel('Start from'),
    // V37: a field's help is a button before it, in the Tab order.
    startPage(page).getByRole('button', { name: 'Where its worktree goes' }),
    branch(page),
    // V47: the model, under the agent.
    startPage(page).getByRole('button', { name: 'About the model' }),
    startPage(page).getByLabel('Model', { exact: true }),
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
  await page.goto(`${symbiote.url}git`);
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
  await page.goto(`${symbiote.url}git`);
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
  await page.goto(`${symbiote.url}git`);
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
  await entry.getByRole('button', { name: 'Land', exact: true }).click();
  await expect(entry.locator('.merge-row-state')).toHaveText(/^Landed: main is at/, POLL);
  expect(git('log', '-1', '--format=%P%n%s', 'main')).toBe(
    `${main} ${tip}\nMerge ${branch}: Add a half function`,
  );
  expect(existsSync(join(symbiote.repo, 'src', 'half.ts'))).toBe(true);
  // Landed (V55): Remove is the head's primary button, and ⋯ is gone with it.
  const remove = entry.getByRole('button', { name: 'Remove', exact: true });
  await expect(remove).toHaveClass(/\bprimary\b/);
  await expect(entry.getByRole('button', { name: 'More actions' })).toHaveCount(0);
  // Merged: the workspace offers Clean up in its head (V55), and no Merge.
  await expect(workspaceRow(page, branch)).toContainText('Merged', POLL);
  await workspaceRow(page, branch)
    .getByRole('button', { name: 'Add a half function', exact: true })
    .click();
  await expect(here.getByRole('button', { name: 'Clean up', exact: true })).toHaveClass(
    /\bprimary\b/,
  );
  await expect(here.getByRole('button', { name: /^Merge into/ })).toHaveCount(0);
  // The landed merge's card has the icon (V55): it removes the merge from the queue, and the
  // workspace shown stays.
  await card.hover();
  const icon = card.getByRole('button', { name: `Remove the merge of ${branch}` });
  await expect(icon).toHaveAttribute('data-tip', /Remove it from the queue/);
  // Held (V57): its card disabled and saying so, its link no longer one, until it goes.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/merges/remove', async (route) => {
    await held;
    await route.continue();
  });
  await icon.click();
  await expect(card).toHaveAttribute('aria-busy', 'true');
  await expect(card).toHaveAttribute('aria-disabled', 'true');
  await expect(card.locator('.workspace-state')).toHaveText('Removing it from the queue');
  await expect(card.locator('.state-dot')).toHaveClass(/tone-cleaning/);
  await expect(card.locator('.workspace-about')).not.toHaveAttribute('href');
  await expect(icon).toHaveCount(0);
  release();
  await expect(merging).toHaveCount(0, POLL);
  await expect(here).toBeVisible();
  await expect(page.getByRole('contentinfo', { name: 'Status bar' })).toContainText(
    `Removed the merge of ${branch} from the queue.`,
  );
  expect(git('log', '-1', '--format=%s', 'main')).toBe(`Merge ${branch}: Add a half function`);
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
  await merge.getByRole('button', { name: 'Land', exact: true }).click();
  await expect(merge.locator('.merge-row-state')).toHaveText(/^Landed: release is at/, POLL);
  expect(git('log', '-1', '--format=%P', 'release')).toBe(`${main} ${tip}`);
  expect(git('rev-parse', 'main')).toBe(main);
});

/** A workspace with one commit, reviewed and approved; its panel open. */
async function approvedWorkspace(page: Page) {
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
  return { branch, tip };
}

test('Merge into by fast-forward: main moves to the approved commit, no merge commit; a target that cannot take it says why (V67)', async ({
  page,
}) => {
  const { branch, tip } = await approvedWorkspace(page);
  const main = git('rev-parse', 'main');
  // release has a commit the workspace does not: it cannot fast-forward.
  git('branch', 'release', git('commit-tree', '-p', main, '-m', 'Release', `${main}^{tree}`));
  await page.goto(`${symbiote.url}?branch=${encodeURIComponent(branch)}`);

  const here = panel(page, branch);
  const how = here.getByLabel('How it lands');
  const button = here.getByRole('button', { name: 'Merge into', exact: true });
  await expect(how).toHaveValue('merge');
  await how.selectOption('fast-forward');
  await here.getByLabel('Branch to merge into').selectOption('release');
  await expect(button).toBeDisabled();
  const why = here.getByRole('img', { name: 'release cannot fast-forward' });
  await expect(why).toHaveAttribute(
    'data-tip',
    `release has commits ${branch} does not: it cannot fast-forward. Merge with a merge commit, or bring release into the branch and review it again.`,
  );
  await here.getByLabel('Branch to merge into').selectOption('main');
  await expect(here.locator('.merge-control-why')).toHaveCount(0);
  await expect(button).toBeEnabled();
  await button.click();

  // No check here: it waits for Land, nothing merged.
  const card = page.getByRole('region', { name: 'Merging' }).locator(`[data-merge="${branch}"]`);
  await expect(card).toContainText('Not checked', POLL);
  await card.getByRole('link').click();
  const entry = page.getByRole('region', { name: `Merge of ${branch}` });
  await expect(entry.locator('.merge-how')).toHaveText('by fast-forward');
  await expect(entry.locator('.merge-title')).toHaveText(
    `No merge commit: a fast-forward to ${short(tip)}, the approved commit`,
  );
  expect(git('rev-parse', 'main')).toBe(main);
  await entry.getByRole('button', { name: 'Land', exact: true }).click();
  await expect(entry.locator('.merge-row-state')).toHaveText(
    `Landed: main fast-forwarded to ${short(tip)}`,
    POLL,
  );
  expect(git('rev-parse', 'main')).toBe(tip);
  expect(git('rev-list', '--count', `${main}..main`)).toBe('1');
  expect(existsSync(join(symbiote.repo, 'src', 'half.ts'))).toBe(true);
  // Merged: the workspace offers Clean up, as after a merge commit.
  await expect(workspaceRow(page, branch)).toContainText('Merged', POLL);
});

test('a fast-forward main can no longer take waits for you; Merge commit instead lands it with one (V67)', async ({
  page,
}) => {
  const { branch, tip } = await approvedWorkspace(page);
  await page.goto(`${symbiote.url}?branch=${encodeURIComponent(branch)}`);
  const here = panel(page, branch);
  await here.getByLabel('How it lands').selectOption('fast-forward');
  await here.getByRole('button', { name: 'Merge into', exact: true }).click();
  const card = page.getByRole('region', { name: 'Merging' }).locator(`[data-merge="${branch}"]`);
  await expect(card).toContainText('Not checked', POLL);

  // main moves while it waits to land: at Land it is fast-forwarded again, and cannot be.
  git('commit', '--allow-empty', '-qm', 'Main: moved');
  const moved = git('rev-parse', 'main');
  await card.getByRole('link').click();
  const entry = page.getByRole('region', { name: `Merge of ${branch}` });
  await entry.getByRole('button', { name: 'Land', exact: true }).click();
  await expect(entry.locator('.merge-row-state')).toHaveText(
    `Cannot fast-forward: main has 1 commit ${branch} does not. Merge with a merge commit, or bring main into the branch and review it again`,
    POLL,
  );
  await expect(entry.locator('.merge-label')).toHaveText('Needs you');
  expect(git('rev-parse', 'main')).toBe(moved);

  const instead = entry.getByRole('button', { name: 'Merge commit instead', exact: true });
  await expect(instead).toHaveClass(/\bprimary\b/);
  await instead.click();
  await expect(entry.locator('.merge-row-state')).toHaveText(/^Merged, not checked/, POLL);
  await expect(entry.locator('.merge-how')).toHaveCount(0);
  await entry.getByRole('button', { name: 'Land', exact: true }).click();
  await expect(entry.locator('.merge-row-state')).toHaveText(/^Landed: main is at/, POLL);
  expect(git('log', '-1', '--format=%P', 'main')).toBe(`${moved} ${tip}`);
});
