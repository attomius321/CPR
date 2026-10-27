import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { dragTo, stops } from './stepper.js';
import { graphPage, serveFixture, serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

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
// Start from (V66): a button that opens a search over the branches.
const from = (page: Page) => start(page).getByRole('button', { name: /^Start from/ });
const branchSearch = (page: Page) => start(page).getByRole('combobox', { name: 'Search branches' });
const branchList = (page: Page) => start(page).getByRole('listbox', { name: 'Branches' });
const pickFrom = async (page: Page, name: string) => {
  await from(page).click();
  await branchList(page).getByRole('option', { name, exact: true }).click();
  await expect(branchList(page)).toHaveCount(0);
};
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
  await expect(start(page)).toContainText(
    `Will be created from main at ${short(symbiote.shas.at(-1))}`,
  );
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

test('the brief and the run side by side; More closed fits 1440 × 900, More open scrolls under the head; one column on a phone', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${symbiote.url}start`);
  const brief = page.locator('.start-brief');
  const run = page.locator('.start-run');
  const body = page.locator('.start-body');
  const go = start(page).getByRole('button', { name: 'Start workspace' });
  let b = await brief.boundingBox();
  let r = await run.boundingBox();
  expect(r?.x ?? 0).toBeGreaterThanOrEqual((b?.x ?? 0) + (b?.width ?? 0));
  expect(Math.abs((r?.y ?? 0) - (b?.y ?? 0))).toBeLessThanOrEqual(1);
  // The text areas use the room: wider than the dialog's 598 px.
  expect((await goal(page).boundingBox())?.width ?? 0).toBeGreaterThan(640);
  // V63: the run as seven cards is the taller column; with More closed nothing scrolls.
  expect(await body.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(false);
  // More open: the body scrolls, the head and its Start stay in view.
  await start(page).getByRole('button', { name: /^More/ }).click();
  await expect(start(page).getByRole('textbox', { name: 'Notes' })).toBeVisible();
  await body.evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await expect(start(page).getByRole('textbox', { name: 'Notes' })).toBeInViewport();
  await expect(go).toBeInViewport();

  await page.setViewportSize({ width: 390, height: 844 });
  b = await brief.boundingBox();
  r = await run.boundingBox();
  expect(r?.y ?? 0).toBeGreaterThanOrEqual((b?.y ?? 0) + (b?.height ?? 0));
  // The head and its Start stay in view while the form scrolls.
  await run.scrollIntoViewIfNeeded();
  await expect(go).toBeInViewport();
  // The five kinds on one line: their icons hide.
  const kinds = start(page).getByRole('radio');
  const first = await kinds.first().boundingBox();
  const last = await kinds.last().boundingBox();
  expect(Math.abs((last?.y ?? 0) - (first?.y ?? 0))).toBeLessThanOrEqual(1);
});

// V49: centred in the main area at any width, the head's contents over the cards; the run's choices
// as rows, their names beside them; a tall window's room to the goal.
test('centred in a wide main area, the head over the cards; the run as rows', async ({ page }) => {
  const symbiote = await serve();
  const brief = page.locator('.start-brief');
  const run = page.locator('.start-run');
  for (const [width, height] of [
    [1920, 1080],
    [2560, 1440],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`${symbiote.url}start`);
    await expect(title(page)).toBeVisible();
    const area = await page.locator('.start-body').boundingBox();
    const b = await brief.boundingBox();
    const r = await run.boundingBox();
    if (!area || !b || !r) throw new Error('no box');
    const left = b.x - area.x;
    const right = area.x + area.width - (r.x + r.width);
    expect(left).toBeGreaterThan(100);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    // The head's contents in the cards' width: the S over the brief, Start over the run.
    const mark = await page.locator('.start-top .symbiote-mark').boundingBox();
    const go = await start(page).getByRole('button', { name: 'Start workspace' }).boundingBox();
    expect(Math.abs((mark?.x ?? 0) - b.x)).toBeLessThanOrEqual(1);
    expect(Math.abs((go?.x ?? 0) + (go?.width ?? 0) - (r.x + r.width))).toBeLessThanOrEqual(1);
  }
  // A row: the name at the left, its control beside it on the same line.
  const name = await run.getByText('Start from', { exact: true }).boundingBox();
  const field = await from(page).boundingBox();
  if (!name || !field) throw new Error('no box');
  expect(field.x).toBeGreaterThan(name.x + name.width);
  expect(Math.abs(field.y + field.height / 2 - (name.y + name.height / 2))).toBeLessThanOrEqual(4);

  // The goal opens taller where the main area is tall.
  await page.setViewportSize({ width: 1440, height: 900 });
  const short = (await goal(page).boundingBox())?.height ?? 0;
  await page.setViewportSize({ width: 1440, height: 1200 });
  expect((await goal(page).boundingBox())?.height ?? 0).toBeGreaterThan(short + 80);
});

// V63: the person's mockup, at its own size (its main area: 1641 × 959 less the sidenav).
test("as the person's mockup: the S and a line in the head, the kinds as tabs, the run as seven cards", async ({
  page,
}) => {
  const symbiote = await serve();
  await page.setViewportSize({ width: 1641, height: 959 });
  await page.goto(`${symbiote.url}start`);
  const head = page.locator('.start-top');
  await expect(head.locator('.symbiote-mark')).toBeVisible();
  await expect(head.getByRole('heading', { name: 'Start a workspace' })).toBeVisible();
  await expect(head).toContainText('Create a new workspace from a branch with an AI agent');
  for (const name of ['Cancel', 'Clear']) {
    await expect(head.getByRole('button', { name })).toHaveClass(/secondary/);
  }
  await expect(head.getByRole('button', { name: 'Start workspace' })).toHaveClass(/primary/);

  // The kinds: tabs with an icon each, still a radio group.
  const kinds = start(page).getByRole('radiogroup', { name: 'Kind of work' }).getByRole('radio');
  await expect(kinds).toHaveText(['Feature', 'Fix', 'Refactor', 'Chore', 'Spike']);
  for (const kind of await kinds.all()) await expect(kind.locator('svg.icon')).toHaveCount(1);
  // A "?" beside each of the brief's fields; the mockup's advice; More a framed row, optional.
  for (const name of ['About the title', 'About the goal', 'About Done when']) {
    await expect(start(page).getByRole('button', { name })).toBeVisible();
  }
  await expect(start(page).getByText('Be specific for better results')).toBeVisible();
  await expect(start(page).getByRole('button', { name: /^More/ })).toContainText('Optional');

  // The run: seven cards, an icon and a heading each.
  const cards = page.locator('.start-run > .start-card');
  await expect(cards.locator('h2')).toHaveText([
    'Source',
    'Agent',
    'Model',
    'Effort',
    'Permissions',
    'Plan first and wait for my OK',
    'Documents (optional)',
  ]);
  for (const card of await cards.all()) {
    await expect(card.locator('.start-card-icon svg')).toHaveCount(1);
  }
  await expect(cards.first()).toContainText(
    `Will be created from main at ${short(symbiote.shas.at(-1))} as feature/new`,
  );
  await expect(start(page)).toContainText('Let the agent propose a plan before making changes.');
  await expect(start(page)).toContainText('Add context files, docs, mockups, or requirements.');

  // The mockup's widths: 1,312 px at most, centred; the run ~470, 16 px from the brief.
  const area = await page.locator('.start-body').boundingBox();
  const b = await page.locator('.start-brief').boundingBox();
  const r = await page.locator('.start-run').boundingBox();
  if (!area || !b || !r) throw new Error('no box');
  expect(r.x + r.width - b.x).toBeLessThanOrEqual(1312);
  expect(r.x + r.width - b.x).toBeGreaterThan(1300);
  expect(Math.abs(b.x - area.x - (area.x + area.width - r.x - r.width))).toBeLessThanOrEqual(1);
  expect(r.width).toBeGreaterThan(460);
  expect(r.width).toBeLessThan(480);
  expect(Math.abs(r.x - (b.x + b.width) - 16)).toBeLessThanOrEqual(1);
});

test("the goal's tools: the brief's length against its limit, a Markdown preview, files for the documents", async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}start`);
  const tools = start(page).getByRole('toolbar', { name: 'Goal tools' });
  const count = tools.locator('.start-count');
  await expect(count).toHaveText(/^[\d,]+\/20,000$/);
  const before = Number((await count.textContent())?.split('/')[0]?.replaceAll(',', ''));
  await goal(page).fill('Clamp a **value**.');
  // The goal's section joins the brief: a blank line, "## Goal" and its text.
  await expect(count).toHaveText(`${before + 2 + '## Goal\n'.length + 18}/20,000`);

  // The preview: the goal as Markdown; again, back to writing it.
  const preview = tools.getByRole('button', { name: 'Preview' });
  await preview.click();
  await expect(preview).toHaveAttribute('aria-pressed', 'true');
  await expect(goal(page)).toHaveCount(0);
  await expect(start(page).locator('.start-preview strong')).toHaveText('value');
  await preview.click();
  await expect(goal(page)).toHaveValue('Clamp a **value**.');

  // 📎 picks files for the documents.
  const chooser = page.waitForEvent('filechooser');
  await tools.getByRole('button', { name: 'Attach files' }).click();
  await (
    await chooser
  ).setFiles([{ name: 'spec.md', mimeType: 'text/markdown', buffer: Buffer.from('# Spec\n') }]);
  const documents = start(page).getByRole('group', { name: /^Documents/ });
  await expect(documents.getByRole('listitem')).toHaveCount(1);
  await expect(documents.getByRole('listitem')).toContainText('spec.md7 B');
});

test('Branch name: ⤨ names it after the title again', async ({ page }) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}start`);
  const branch = start(page).getByRole('textbox', { name: 'Branch name' });
  const again = start(page).getByRole('button', { name: 'Name it after the title' });
  await title(page).fill('Add clamp');
  await expect(branch).toHaveValue('feature/add-clamp');
  await expect(again).toBeDisabled();
  await branch.fill('feature/clamp-it');
  await expect(start(page)).toContainText(
    `Will be created from main at ${short(symbiote.shas.at(-1))} as feature/clamp-it`,
  );
  await expect(again).toBeEnabled();
  await again.click();
  await expect(branch).toHaveValue('feature/add-clamp');
  await expect(again).toBeDisabled();
  // It follows the title again.
  await title(page).fill('Add clamp twice');
  await expect(branch).toHaveValue('feature/add-clamp-twice');
});

test('Plan first is a switch: on at first, Space turns it off, the draft keeps it', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}start`);
  const plan = start(page).getByRole('switch', { name: 'Plan first and wait for my OK' });
  await expect(plan).toBeChecked();
  await plan.focus();
  // The draft is saved once typing pauses.
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/workspaces/draft') && r.request().method() === 'POST',
  );
  await page.keyboard.press('Space');
  await expect(plan).not.toBeChecked();
  await saved;
  await page.reload();
  await expect(plan).not.toBeChecked();
});

test("from a diff, the sidenav's Start and n load /start", async ({ page }) => {
  const diff = await serveFixture('callers');
  running.push(diff);
  await page.goto(graphPage(diff.url));
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
    'Low',
    'Medium',
    'High',
    'xHigh',
    'Max',
  ]);
  await expect(effort(page)).toHaveAttribute('aria-valuetext', "Claude Code's default");
  await title(page).fill('Add clamp');
  await goal(page).fill('Clamp a value.');
  // A stop's word picks it.
  await stops(effort(page))
    .filter({ hasText: /^High$/ })
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
    'Low',
    'Medium',
    'High',
    'xHigh',
    'Max',
  ]);
  await expect(stops(effort(page)).first()).toHaveAttribute('data-tip', "Codex's default (medium)");
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

// The agent's model (V47): its default, or one from the agent's own list; the levels follow it.
const model = (page: Page) => start(page).getByLabel('Model', { exact: true });

test("Model: Claude Code's own list after its default; the levels follow the model; a pick reaches it as --model", async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}start`);
  // Its list, not its "Default (recommended)": that is not the person's default (decision 337).
  await expect(model(page).locator('option')).toHaveText([
    "Claude Code's default",
    'Opus 5.5',
    'Sonnet 5.5',
    'Haiku 4.5',
    'Opus 4.6',
  ]);
  await expect(model(page)).toHaveValue('');
  await title(page).fill('Add clamp');
  await goal(page).fill('Clamp a value.');
  await stops(effort(page))
    .filter({ hasText: /^xHigh$/ })
    .click();
  // Opus 4.6 takes no xhigh: its own levels, the level back to the default; its words under it.
  await model(page).selectOption({ label: 'Opus 4.6' });
  await expect(stops(effort(page))).toHaveText(['Default', 'Low', 'Medium', 'High', 'Max']);
  await expect(effort(page)).toHaveAttribute('aria-valuetext', "Claude Code's default");
  await expect(start(page).locator('.start-model-note')).toHaveText(
    'Best for everyday, complex tasks',
  );
  // Haiku 4.5 takes none: no Effort.
  await model(page).selectOption({ label: 'Haiku 4.5' });
  await expect(effort(page)).toHaveCount(0);
  await model(page).selectOption({ label: 'Sonnet 5.5' });
  await stops(effort(page))
    .filter({ hasText: /^High$/ })
    .click();
  // Leaving keeps both, as the rest of the form.
  await title(page).press('Escape');
  await startLink(page).click();
  await expect(model(page)).toHaveValue('sonnet');
  await expect(effort(page)).toHaveAttribute('aria-valuetext', 'high');
  await goal(page).press('Control+Enter');
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-clamp`);
  const args = symbiote.calls().at(-1)?.args ?? [];
  expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual([
    '--model',
    'sonnet',
  ]);
  const workspace = page.getByRole('region', { name: 'Workspace feature/add-clamp' });
  await workspace.getByRole('tab', { name: 'Brief' }).click();
  await expect(workspace.locator('.workspace-started')).toHaveText(
    'Started with Claude Code on sonnet at high effort.',
  );

  // For that session only: the next workspace starts on the default, and passes no model.
  await startLink(page).click();
  await expect(model(page)).toHaveValue('');
  await title(page).fill('Add round');
  await goal(page).fill('Round a value.');
  await goal(page).press('Control+Enter');
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-round`);
  expect(symbiote.calls().at(-1)?.args).not.toContain('--model');
  // Its list was read once, and kept (decision 340).
  expect(symbiote.modelReads()).toBe(1);
});

test("Model for Codex on its app server: its list, its configured model named; a pick on the thread's start", async ({
  page,
}) => {
  const symbiote = await serve({ codex: true, appServer: true });
  await page.goto(`${symbiote.url}start`);
  await model(page).selectOption({ label: 'Haiku 4.5' });
  // A model is one agent's: the other starts on its default.
  await start(page).getByLabel('Agent').selectOption({ label: 'Codex' });
  await expect(model(page).locator('option')).toHaveText([
    "Codex's default (GPT-6-Luna)",
    'GPT-6-Luna',
    'GPT-5.6-Terra',
    'GPT-5.6-Luna',
  ]);
  await expect(model(page)).toHaveValue('');
  await expect(start(page).locator('.start-model-note')).toHaveText(
    'Fast and affordable model for easier tasks.',
  );
  // GPT-5.6-Terra has one more level.
  await model(page).selectOption({ label: 'GPT-5.6-Terra' });
  await expect(stops(effort(page)).last()).toHaveText('Ultra');
  await effort(page).press('End');
  await title(page).fill('Add clamp');
  await goal(page).fill('Clamp a value.');
  await goal(page).press('Control+Enter');
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-clamp`);
  const calls = symbiote.codexServer?.calls ?? [];
  expect(calls.find((call) => call.method === 'thread/start')?.params).toMatchObject({
    model: 'gpt-5.6-terra',
  });
  expect(calls.find((call) => call.method === 'turn/start')?.params).toMatchObject({
    effort: 'ultra',
  });
});

test('Model: none offered for an agent whose list Symbiote cannot read (Codex without its daemon)', async ({
  page,
}) => {
  const symbiote = await serve({ codex: true });
  await page.goto(`${symbiote.url}start`);
  await expect(model(page)).toBeVisible();
  await start(page).getByLabel('Agent').selectOption({ label: 'Codex' });
  await expect(model(page)).toHaveCount(0);
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
  await expect(from(page)).toHaveText('main');
  await expect(from(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(start(page)).toContainText(`Will be created from main at ${short(head)}`);
  await from(page).click();
  await expect(from(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(branchSearch(page)).toBeFocused();
  await expect(branchList(page).getByRole('option')).toHaveText(['main', 'topic', 'shared']);
  // V66: the groups are the page's, the remote's under its heading.
  await expect(branchList(page).getByRole('group')).toHaveCount(2);
  await expect(
    branchList(page).getByRole('group', { name: 'Local 2' }).getByRole('option'),
  ).toHaveText(['main', 'topic']);
  await expect(
    branchList(page).getByRole('group', { name: 'Only on a remote 1' }).getByRole('option'),
  ).toHaveText(['shared']);
  await expect(branchList(page).getByRole('option', { selected: true })).toHaveText('main');

  await branchList(page).getByRole('option', { name: 'topic' }).click();
  await expect(branchList(page)).toHaveCount(0);
  await expect(from(page)).toBeFocused();
  await expect(from(page)).toHaveText('topic');
  await expect(start(page)).toContainText(`Will be created from topic at ${short(base)}`);
  await title(page).fill('Stack on topic');
  await goal(page).fill('Build on it.');
  // Leaving keeps it, as the rest of the form.
  await title(page).press('Escape');
  await startLink(page).click();
  await expect(from(page)).toHaveText('topic');
  await goal(page).press('Control+Enter');
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fstack-on-topic`);
  expect(git('rev-parse', 'feature/stack-on-topic')).toBe(base);
  expect(symbiote.calls().at(-1)?.args.at(-1)).toContain(`topic at ${short(base)}`);

  // A start ends it: the next workspace starts from the default branch.
  await startLink(page).click();
  await expect(from(page)).toHaveText('main');
  // A remote's branch is started from as well.
  await pickFrom(page, 'shared');
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
  await expect(from(page)).toHaveText(`The commit ${short(base)}`);
  await expect(start(page)).toContainText(`Will be created from the commit ${short(base)}`);
  await from(page).click();
  await expect(branchList(page).getByRole('option')).toHaveText([
    `The commit ${short(base)}`,
    'main',
  ]);
  await expect(branchList(page).getByRole('option', { selected: true })).toHaveText(
    `The commit ${short(base)}`,
  );
  await branchList(page).getByRole('option', { name: 'main' }).click();
  await expect(start(page)).toContainText(`Will be created from main at ${short(head)}`);
  await pickFrom(page, `The commit ${short(base)}`);
  await expect(start(page)).toContainText(`Will be created from the commit ${short(base)}`);
});

// V66: a search over the branches, and the keys.
test('Start from: typing narrows the branches to those holding every word; the keys pick', async ({
  page,
}) => {
  const symbiote = await serve();
  const [base] = symbiote.shas;
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: symbiote.repo, encoding: 'utf8' }).trim();
  for (const name of ['topic', 'fix/title-bar', 'milestone/v65-review-against'])
    git('branch', name, base ?? '');
  git('update-ref', 'refs/remotes/origin/feature/old-start', base ?? '');
  await page.goto(`${symbiote.url}start`);
  const options = branchList(page).getByRole('option');

  // A letter on the closed field opens it with that letter (m is the shell's Monitor key, not
  // taken here), then the words narrow it.
  await from(page).focus();
  await page.keyboard.press('m');
  await expect(branchSearch(page)).toBeFocused();
  await expect(branchSearch(page)).toHaveValue('m');
  await expect(page).toHaveURL(`${symbiote.url}start`);
  await expect(options).toHaveText(['main', 'milestone/v65-review-against']);
  await page.keyboard.type('ilestone AGAINST v65');
  await expect(options).toHaveText(['milestone/v65-review-against']);
  // The words found are marked.
  await expect(options.locator('mark')).toHaveText(['milestone', 'v65', 'against']);
  await expect(branchList(page).getByRole('group')).toHaveAccessibleName('Local 1');
  await page.keyboard.press('Enter');
  await expect(branchList(page)).toHaveCount(0);
  await expect(from(page)).toBeFocused();
  await expect(from(page)).toHaveText('milestone/v65-review-against');
  await expect(start(page)).toContainText(
    `Will be created from milestone/v65-review-against at ${short(base)}`,
  );

  // Enter opens it with nothing typed, at the branch picked; ↑ and ↓ move, Enter picks.
  await page.keyboard.press('Enter');
  await expect(branchSearch(page)).toHaveValue('');
  await expect(options).toHaveText([
    'main',
    'fix/title-bar',
    'milestone/v65-review-against',
    'topic',
    'feature/old-start',
  ]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(from(page)).toHaveText('topic');

  // A search picks its first match; one on a remote too.
  await page.keyboard.press('ArrowDown');
  await branchSearch(page).fill('old start');
  await expect(
    branchList(page).getByRole('group', { name: 'Only on a remote 1' }).getByRole('option'),
  ).toHaveText(['feature/old-start']);
  await page.keyboard.press('Enter');
  await expect(from(page)).toHaveText('feature/old-start');

  // Nothing matches: it says so, and Enter picks nothing.
  await page.keyboard.press(' ');
  await branchSearch(page).fill('nothing like it');
  await expect(options).toHaveCount(0);
  await expect(start(page).getByText('No branch matches')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(branchSearch(page)).toBeFocused();

  // Escape closes the list, not the page.
  await page.keyboard.press('Escape');
  await expect(branchList(page)).toHaveCount(0);
  await expect(page).toHaveURL(`${symbiote.url}start`);
  await expect(from(page)).toBeFocused();
  await expect(from(page)).toHaveText('feature/old-start');

  // A click outside closes it, and Tab: nothing picked.
  await from(page).click();
  await branchSearch(page).fill('main');
  await title(page).click();
  await expect(branchList(page)).toHaveCount(0);
  await from(page).click();
  await expect(branchSearch(page)).toHaveValue('');
  await page.keyboard.press('Tab');
  await expect(branchList(page)).toHaveCount(0);
  await expect(start(page).getByRole('button', { name: 'Where its worktree goes' })).toBeFocused();
  await expect(from(page)).toHaveText('feature/old-start');
  await expect(start(page)).toContainText(
    `Will be created from feature/old-start at ${short(base)}`,
  );
});

/** Files as the page gets them from a clipboard or a drop: name, type and their text. */
type Given = { name: string; type: string; text: string };
const transfer = (page: Page, files: Given[], text = '') =>
  page.evaluateHandle(
    ({ files, text }) => {
      const data = new DataTransfer();
      for (const file of files)
        data.items.add(new File([file.text], file.name, { type: file.type }));
      if (text) data.setData('text/plain', text);
      return data;
    },
    { files, text },
  );

test('Documents: chosen, dropped and pasted files go beside the record, and the prompt names each (V40)', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}start`);
  const documents = start(page).getByRole('group', { name: /^Documents/ });
  const rows = documents.getByRole('listitem');
  await title(page).fill('Read the spec');
  await goal(page).fill('Build what the spec says.');

  // Chosen with Add files.
  await documents.getByLabel('Add files').setInputFiles([
    { name: 'spec.md', mimeType: 'text/markdown', buffer: Buffer.from('# Spec\n') },
    { name: 'data.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}\n') },
  ]);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('spec.md7 B');
  await expect(rows.nth(1)).toContainText('data.json8 B');

  // Dropped anywhere on the page; while dragged over, the page says what a drop does.
  const dropped = await transfer(page, [{ name: 'notes.txt', type: 'text/plain', text: 'hi' }]);
  await goal(page).dispatchEvent('dragenter', { dataTransfer: dropped });
  await goal(page).dispatchEvent('dragover', { dataTransfer: dropped });
  await expect(start(page).getByText('Drop to add them to the documents')).toBeVisible();
  await goal(page).dispatchEvent('drop', { dataTransfer: dropped });
  await expect(start(page).getByText('Drop to add them to the documents')).toBeHidden();
  await expect(rows.nth(2)).toContainText('notes.txt2 B');

  // A screenshot pasted into the brief; text pastes as text, even beside an image.
  const paste = async (files: Given[], text = '') => {
    const clipboardData = await transfer(page, files, text);
    await goal(page).evaluate(
      (element, clipboardData) =>
        element.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
        ),
      clipboardData,
    );
  };
  await paste([{ name: 'image.png', type: 'image/png', text: 'png' }]);
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toContainText('image.png3 B');
  await paste([{ name: 'image.png', type: 'image/png', text: 'png' }], 'A1\tB1');
  await expect(rows).toHaveCount(4);

  // Too large: listed with why, Start waits until it is removed.
  const startButton = start(page).getByRole('button', { name: 'Start workspace' });
  await documents
    .getByLabel('Add files')
    .setInputFiles([
      { name: 'movie.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc((20 << 20) + 1) },
    ]);
  await expect(rows.nth(4)).toContainText('movie.mp4Larger than 20 MB.');
  await expect(startButton).toBeDisabled();
  await expect(startButton).toHaveAttribute(
    'data-tip',
    'movie.mp4 was not added: remove it to start.',
  );
  await documents.getByRole('button', { name: 'Remove movie.mp4' }).click();
  // One taken off is not given.
  await documents.getByRole('button', { name: 'Remove data.json' }).click();
  await expect(rows).toHaveCount(3);
  await expect(startButton).toBeEnabled();

  // Leaving keeps them, as the rest of the form.
  await title(page).press('Escape');
  await startLink(page).click();
  await expect(rows).toHaveCount(3);

  await goal(page).press('Control+Enter');
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fread-the-spec`);
  const folder = `${symbiote.repo}/symbiote/documents/feature/read-the-spec`;
  const prompt = symbiote.calls().at(-1)?.args.at(-1) ?? '';
  expect(prompt).toContain(`in ${folder}:\n\n- spec.md\n- notes.txt\n- image.png\n`);
  expect(execFileSync('ls', [folder], { encoding: 'utf8' }).trim().split('\n').sort()).toEqual([
    'image.png',
    'notes.txt',
    'spec.md',
  ]);
  expect(execFileSync('cat', [`${folder}/spec.md`], { encoding: 'utf8' })).toBe('# Spec\n');

  // The workspace's Brief lists them, and where they are.
  const workspace = page.getByRole('region', { name: 'Workspace feature/read-the-spec' });
  await workspace.getByRole('tab', { name: 'Brief' }).click();
  const listed = workspace.getByRole('region', { name: 'Documents' });
  await expect(listed).toContainText(`In ${folder}`);
  await expect(listed.getByRole('listitem')).toHaveText(['spec.md', 'notes.txt', 'image.png']);

  // A start ends them: the next form has none.
  await startLink(page).click();
  await expect(rows).toHaveCount(0);
});
