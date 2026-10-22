import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { dragTo, stops } from './stepper.js';
import { serveFixture, serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// Start a workspace as a page (V30a): /start in the main area, right of the sidenav; the brief and
// the run side by side; back to where it was opened from; a start takes its place in the history.
let running: { stop(): void }[] = [];
const errors: string[] = [];
const serve = async (
  options: Parameters<typeof serveWorkspaces>[0] = {},
): Promise<RunningWorkspaces> => {
  const served = await serveWorkspaces(options);
  running.push(served);
  return served;
};

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  for (const served of running) served.stop();
  running = [];
  expect(errors).toEqual([]);
});

const sidenav = (page: Page) => page.getByRole('complementary', { name: 'Pages and workspaces' });
const startLink = (page: Page) => sidenav(page).getByRole('link', { name: 'Start a workspace' });
const start = (page: Page) => page.getByRole('region', { name: 'Start a workspace' });
const title = (page: Page) => start(page).getByRole('textbox', { name: 'Title' });
const goal = (page: Page) => start(page).getByRole('textbox', { name: 'Goal' });
const effort = (page: Page) => start(page).getByRole('slider', { name: 'Effort' });
const from = (page: Page) => start(page).getByLabel('Start from');
const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);

test('Start a workspace is a page right of the sidenav, at /start', async ({ page }) => {
  const symbiote = await serve();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${symbiote.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await startLink(page).click();
  await expect(page).toHaveURL(`${symbiote.url}start`);
  await expect(start(page)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(title(page)).toBeFocused();
  await expect(startLink(page)).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle(/^Start a workspace · /);
  await expect(start(page)).toContainText(`From main at ${short(symbiote.shas.at(-1))}`);
  // The whole main area: from the sidenav's edge to the window's.
  const nav = await sidenav(page).boundingBox();
  const box = await start(page).boundingBox();
  expect(Math.abs((box?.x ?? 0) - ((nav?.x ?? 0) + (nav?.width ?? 0)))).toBeLessThanOrEqual(1);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBe(1440);

  // Its address loads it.
  await page.reload();
  await expect(title(page)).toBeVisible();
  // The sidenav stays usable: History opens in place.
  await sidenav(page).getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(`${symbiote.url}history`);
  await expect(start(page)).toHaveCount(0);
});

test('n opens it from any page; on it, n goes back to the title', async ({ page }) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}settings`);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('n');
  await expect(page).toHaveURL(`${symbiote.url}start`);
  await expect(title(page)).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('n');
  await expect(title(page)).toBeFocused();
  await expect(title(page)).toHaveValue('');
});

test('Escape and Cancel go back to the page it was opened from; the draft stays', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}settings`);
  await startLink(page).click();
  await title(page).fill('Keep me');
  await title(page).press('Escape');
  await expect(page).toHaveURL(`${symbiote.url}settings`);
  await startLink(page).click();
  await expect(title(page)).toHaveValue('Keep me');

  await sidenav(page).getByRole('link', { name: 'History' }).click();
  await startLink(page).click();
  await start(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(`${symbiote.url}history`);

  // Opened by its address, with no page of Symbiote's before it: Cancel goes to History.
  const fresh = await page.context().newPage();
  await fresh.goto(`${symbiote.url}start`);
  await start(fresh).getByRole('button', { name: 'Cancel' }).click();
  await expect(fresh).toHaveURL(`${symbiote.url}history`);
  await expect(title(fresh)).toHaveCount(0);
});

test('a start takes its place in the history: Back goes to the page before it', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}history`);
  await startLink(page).click();
  await title(page).fill('Add clamp');
  await goal(page).fill('Clamp a value.');
  await goal(page).press('Control+Enter');
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-clamp`);
  await expect(page.getByRole('region', { name: 'Workspace feature/add-clamp' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`${symbiote.url}history`);
});

test('the brief and the run side by side; More open without a scroll at 1440 × 900; one column on a phone', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${symbiote.url}start`);
  const brief = page.locator('.start-brief');
  const run = page.locator('.start-run');
  await start(page).getByRole('button', { name: /^More/ }).click();
  await expect(start(page).getByRole('textbox', { name: 'Notes optional' })).toBeVisible();
  let b = await brief.boundingBox();
  let r = await run.boundingBox();
  expect(r?.x ?? 0).toBeGreaterThanOrEqual((b?.x ?? 0) + (b?.width ?? 0));
  expect(Math.abs((r?.y ?? 0) - (b?.y ?? 0))).toBeLessThanOrEqual(1);
  // The text areas use the room: wider than the dialog's 598 px.
  expect((await goal(page).boundingBox())?.width ?? 0).toBeGreaterThan(640);
  const scrolls = await page
    .locator('.start-body')
    .evaluate((body) => body.scrollHeight > body.clientHeight);
  expect(scrolls).toBe(false);
  await expect(start(page).getByRole('button', { name: 'Start', exact: true })).toBeInViewport();

  await page.setViewportSize({ width: 390, height: 844 });
  b = await brief.boundingBox();
  r = await run.boundingBox();
  expect(r?.y ?? 0).toBeGreaterThanOrEqual((b?.y ?? 0) + (b?.height ?? 0));
  // The head and its Start stay in view while the form scrolls.
  await run.scrollIntoViewIfNeeded();
  await expect(start(page).getByRole('button', { name: 'Start', exact: true })).toBeInViewport();
});

test("from a diff, the sidenav's Start and n load /start", async ({ page }) => {
  const diff = await serveFixture('callers');
  running.push(diff);
  await page.goto(diff.url);
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('[');
  await startLink(page).click();
  await expect(page).toHaveURL(new URL('/start', diff.url).href);
  await expect(title(page)).toBeVisible();

  await page.goBack();
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('n');
  await expect(page).toHaveURL(new URL('/start', diff.url).href);
});

// The agent's effort (V30b): its own default, or a level it lists, for the session it starts; on a
// stepper, a stop for each (fix/scout-effort-level).
test("Effort: the agent's default or a level it lists; a level reaches Claude Code, and the Brief tab says it", async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}start`);
  await expect(stops(effort(page))).toHaveText([
    'Default',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ]);
  await expect(effort(page)).toHaveAttribute('aria-valuetext', "Claude Code's default");
  await title(page).fill('Add clamp');
  await goal(page).fill('Clamp a value.');
  // A stop's word picks it.
  await stops(effort(page))
    .filter({ hasText: /^high$/ })
    .click();
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  // Leaving keeps it, as the rest of the form.
  await title(page).press('Escape');
  await startLink(page).click();
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  await goal(page).press('Control+Enter');
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-clamp`);
  const args = symbiote.calls().at(-1)?.args ?? [];
  expect(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2)).toEqual([
    '--effort',
    'high',
  ]);
  const workspace = page.getByRole('region', { name: 'Workspace feature/add-clamp' });
  await workspace.getByRole('tab', { name: 'Brief' }).click();
  await expect(workspace.locator('.workspace-started')).toHaveText(
    'Started with Claude Code at high effort.',
  );

  // For that session only: the next workspace starts at the default, and passes no level.
  await startLink(page).click();
  await expect(effort(page)).toHaveAttribute('aria-valuetext', "Claude Code's default");
  await title(page).fill('Add round');
  await goal(page).fill('Round a value.');
  await goal(page).press('Control+Enter');
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-round`);
  expect(symbiote.calls().at(-1)?.args).not.toContain('--effort');
});

test("Effort for Codex on its app server: its model's levels and its default; the level on its first turn", async ({
  page,
}) => {
  const symbiote = await serve({ codex: true, appServer: true });
  await page.goto(`${symbiote.url}start`);
  await dragTo(page, effort(page), 3);
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  // Codex takes high too: kept when the agent changes; its default named with its level.
  await start(page).getByLabel('Agent').selectOption({ label: 'Codex' });
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  await expect(stops(effort(page))).toHaveText([
    'Default',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ]);
  await expect(stops(effort(page)).first()).toHaveAttribute('title', "Codex's default (medium)");
  await effort(page).press('Home');
  await expect(effort(page)).toHaveAttribute('aria-valuetext', "Codex's default (medium)");
  await effort(page).press('ArrowRight');
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'low');
  await title(page).fill('Add clamp');
  await goal(page).fill('Clamp a value.');
  await goal(page).press('Control+Enter');
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-clamp`);
  const turn = symbiote.codexServer?.calls.find((call) => call.method === 'turn/start');
  expect(turn?.params).toMatchObject({ effort: 'low' });
});

// Start from a branch (V33): the default branch first, then the local ones, then remote-only.
test("Start from: the branches listed; one picked is where it starts and its name the record's", async ({
  page,
}) => {
  const symbiote = await serve();
  const [base, head] = symbiote.shas;
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: symbiote.repo, encoding: 'utf8' }).trim();
  git('branch', 'topic', base ?? '');
  git('update-ref', 'refs/remotes/origin/shared', base ?? '');
  await page.goto(`${symbiote.url}start`);
  await expect(from(page).locator('option')).toHaveText(['main', 'topic', 'shared']);
  await expect(from(page).locator('optgroup')).toHaveAttribute('label', 'Only on a remote');
  await expect(from(page)).toHaveValue('main');
  await expect(start(page)).toContainText(`From main at ${short(head)}`);

  await from(page).selectOption('topic');
  await expect(start(page)).toContainText(`From topic at ${short(base)}`);
  await title(page).fill('Stack on topic');
  await goal(page).fill('Build on it.');
  // Leaving keeps it, as the rest of the form.
  await title(page).press('Escape');
  await startLink(page).click();
  await expect(from(page)).toHaveValue('topic');
  await goal(page).press('Control+Enter');
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fstack-on-topic`);
  expect(git('rev-parse', 'feature/stack-on-topic')).toBe(base);
  expect(symbiote.calls().at(-1)?.args.at(-1)).toContain(`topic at ${short(base)}`);

  // A start ends it: the next workspace starts from the default branch.
  await startLink(page).click();
  await expect(from(page)).toHaveValue('main');
  // A remote's branch is started from as well.
  await from(page).selectOption('shared');
  await title(page).fill('From shared');
  await goal(page).fill('Build on it.');
  await goal(page).press('Control+Enter');
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Ffrom-shared`);
  expect(git('rev-parse', 'feature/from-shared')).toBe(base);
});

test("Start from a History row: the row's commit first, a branch instead when picked", async ({
  page,
}) => {
  const symbiote = await serve();
  const [base, head] = symbiote.shas;
  await page.goto(`${symbiote.url}history`);
  await page
    .locator('.commit', { has: page.locator('.commit-subject').getByText('base', { exact: true }) })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start a workspace here' }).click();
  await expect(from(page).locator('option').first()).toHaveText(`The commit ${short(base)}`);
  await expect(start(page)).toContainText(`From the commit ${short(base)}`);
  await from(page).selectOption('main');
  await expect(start(page)).toContainText(`From main at ${short(head)}`);
  await from(page).selectOption({ label: `The commit ${short(base)}` });
  await expect(start(page)).toContainText(`From the commit ${short(base)}`);
});
