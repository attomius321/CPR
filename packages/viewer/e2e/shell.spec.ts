import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { spinner } from './spinner.js';
import { serveFixture, serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// The shell (V29a): no Workspaces page; a sidenav with the pages and, under them, the workspaces;
// the main area shows what is picked; a status bar along the bottom.
let running: { stop(): void }[] = [];
const errors: string[] = [];
const serve = async (): Promise<RunningWorkspaces> => {
  const served = await serveWorkspaces();
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

const POLL = { timeout: 12_000 };
const sidenav = (page: Page) => page.getByRole('complementary', { name: 'Pages and workspaces' });
const pages = (page: Page) => sidenav(page).getByRole('navigation', { name: 'Pages' });
const card = (page: Page, branch: string) =>
  sidenav(page).locator(`.workspace-row[data-branch="${branch}"]`);
const group = (page: Page, name: string) => sidenav(page).getByRole('region', { name });
const workspace = (page: Page, branch: string) =>
  page.getByRole('region', { name: `Workspace ${branch}` });
const statusBar = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const startPage = (page: Page) => page.getByRole('region', { name: 'Start a workspace' });
const start = async (page: Page, what: string) => {
  await sidenav(page).getByRole('link', { name: 'Start a workspace' }).click();
  await startPage(page).getByRole('textbox', { name: 'Title' }).fill(what);
  await startPage(page).getByRole('textbox', { name: 'Goal' }).fill(what);
  await startPage(page).getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  await expect(startPage(page)).toBeHidden();
};
/** Marks the document: a navigation that keeps the mark did not load the page again. */
const mark = (page: Page) =>
  page.evaluate(() => ((window as { symbioteMark?: number }).symbioteMark = 1));
const marked = (page: Page) =>
  page.evaluate(() => (window as { symbioteMark?: number }).symbioteMark === 1);

test('symbiote view opens History in the shell: the pages, then the workspaces, and a status bar', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(symbiote.url);
  // The root alone is History, shown at its own address.
  await expect(page).toHaveURL(`${symbiote.url}history`);
  // A title bar is Symbiote's window's only (N1c): none in a browser.
  await expect(page.locator('.titlebar')).toHaveCount(0);
  const links = pages(page).getByRole('link');
  await expect(links).toHaveCount(5);
  await expect(links.nth(0)).toHaveAccessibleName('History');
  await expect(links.nth(1)).toHaveAccessibleName('Scout');
  await expect(links.nth(2)).toHaveAccessibleName('Skills');
  await expect(links.nth(3)).toHaveAccessibleName('Monitor');
  await expect(links.nth(4)).toHaveAccessibleName('Settings');
  await expect(pages(page).getByRole('link', { name: 'History' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.commit').first()).toBeVisible();
  await expect(sidenav(page)).toContainText('No workspaces yet');
  await expect(statusBar(page)).toBeVisible();

  // Started from the sidenav: the new workspace opens in the main area, its card in its group.
  await mark(page);
  await start(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-a-half-function`);
  await expect(workspace(page, branch)).toBeVisible();
  await expect(group(page, 'Working').locator(`[data-branch="${branch}"]`)).toBeVisible();
  await expect(card(page, branch)).toHaveClass(/picked/);
  await expect(statusBar(page).getByRole('status')).toHaveText(
    /^Started feature\/add-a-half-function: Claude Code is working in /,
  );
  await expect(pages(page).getByRole('link', { name: 'History' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await marked(page)).toBe(true);
});

test('a card opens its workspace from History and Settings, in place; Back returns', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}settings`);
  await start(page, 'Add a half function');
  await start(page, 'Add clamp');
  const half = 'feature/add-a-half-function';
  const clamp = 'feature/add-clamp';

  await pages(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(`${symbiote.url}settings`);
  await expect(page.getByRole('navigation', { name: 'Settings' })).toBeVisible();
  await mark(page);
  await card(page, half).getByRole('button', { name: 'Add a half function' }).click();
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-a-half-function`);
  await expect(workspace(page, half)).toBeVisible();
  await pages(page).getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(`${symbiote.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await card(page, clamp).getByRole('button', { name: 'Add clamp' }).click();
  await expect(workspace(page, clamp)).toBeVisible();
  // None of it loaded the page again.
  expect(await marked(page)).toBe(true);

  await page.goBack();
  await expect(page).toHaveURL(`${symbiote.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await page.goBack();
  await expect(workspace(page, half)).toBeVisible();
});

test('keys: h and s go to the pages, w to the workspaces and the arrows between them, [ folds the sidenav', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}history`);
  await start(page, 'Add a half function');
  await start(page, 'Add clamp');
  await page.locator('body').click({ position: { x: 1, y: 1 } });

  await page.keyboard.press('h');
  await expect(page).toHaveURL(`${symbiote.url}history`);
  await page.keyboard.press('s');
  await expect(page).toHaveURL(`${symbiote.url}settings`);
  await page.keyboard.press('h');
  await expect(page).toHaveURL(`${symbiote.url}history`);
  // Both cards listed before the keys, as in the card-focus test below: ArrowDown on the only
  // card stays there (on 8 workers, 2 of 32 runs failed on main; 0 of 64 once it waits).
  const buttons = sidenav(page).locator('.workspace-row .workspace-about');
  await expect(buttons).toHaveCount(2, POLL);

  // w: the first workspace's card takes the focus; the arrows move it; Enter opens it.
  await page.keyboard.press('w');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?branch=feature%2F/);

  // [ folds the sidenav to a rail of icons and dots, kept across a reload.
  await page.locator('body').click({ position: { x: 600, y: 1 } });
  await page.keyboard.press('h');
  await expect(page).toHaveURL(`${symbiote.url}history`);
  await page.keyboard.press('[');
  await expect(sidenav(page)).toHaveClass(/rail/);
  await expect(pages(page).getByRole('link', { name: 'History' })).toBeVisible();
  const before = (await sidenav(page).boundingBox())?.width ?? 0;
  expect(before).toBeLessThanOrEqual(56);
  await page.reload();
  await expect(sidenav(page)).toHaveClass(/rail/);
  await sidenav(page).getByRole('button', { name: 'Open the sidenav' }).click();
  await expect(sidenav(page)).not.toHaveClass(/rail/);
  expect((await sidenav(page).boundingBox())?.width ?? 0).toBeGreaterThan(200);
});

test('a card keeps the focus when its workspace moves to another group', async ({ page }) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}history`);
  await start(page, 'Add a half function');
  await start(page, 'Add clamp');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('h');
  await expect(page).toHaveURL(`${symbiote.url}history`);
  // Both cards listed before the keys: under load the sidenav lists the second workspace a moment
  // after its start page closes, and ArrowDown on the only card stays there (on 8 workers, 4 of 64
  // runs failed with 1 card listed at the key; 0 of 64 once it waits).
  const buttons = sidenav(page).locator('.workspace-row .workspace-about');
  await expect(buttons).toHaveCount(2, POLL);

  // The second card, by the arrows; then its agent reports, and it needs you.
  await page.keyboard.press('w');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(buttons.nth(1)).toBeFocused();
  const branch = await page.evaluate(
    () => document.activeElement?.closest<HTMLElement>('.workspace-row')?.dataset.branch,
  );
  expect(branch).toMatch(/^feature\//);
  symbiote.report(branch as string, 'The plan');
  await expect(group(page, 'Waiting for you').locator(`[data-branch="${branch}"]`)).toBeVisible(
    POLL,
  );

  // Drawn anew in its new group, it still has the focus: the arrows go on from it.
  await expect(card(page, branch as string).locator('.workspace-about')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(card(page, branch as string).locator('.workspace-about')).not.toBeFocused();
  await expect(buttons.nth(1)).toBeFocused();
});

/** A colour token as the page computes it (`rgb(…)`), to compare with a computed style. */
const tokenColour = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement('i');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);

test('each group of workspaces has its icon, in its colour; the cards keep their dots (V44)', async ({
  page,
}) => {
  const symbiote = await serve();
  // A merge in the queue, for the Merging group.
  await page.route('**/api/merges', (route) =>
    route.fulfill({
      json: {
        merges: [
          {
            id: 'm1',
            branch: 'feature/tidy-the-readme',
            head: symbiote.shas[1],
            into: 'main',
            title: 'Merge feature/tidy-the-readme: Tidy the README',
            state: 'checking',
            queued: new Date().toISOString(),
            updated: new Date().toISOString(),
            check: { commands: ['pnpm check'], source: 'package.json' },
          },
        ],
      },
    }),
  );
  await page.goto(`${symbiote.url}history`);
  await start(page, 'Add a half function');
  await start(page, 'Add clamp');
  await start(page, 'Add a double function');
  await start(page, 'Add a triple function');
  await start(page, 'Add zero');
  const rows = sidenav(page).locator('.workspace-row[data-branch]');
  await expect(rows).toHaveCount(5, POLL);
  const branches = await rows.evaluateAll((all) =>
    all.map((row) => (row as HTMLElement).dataset.branch ?? ''),
  );
  const [waiting, merged, toReview, , stopped] = branches.sort();
  // One waits for the person; one is merged into main; one is to review and one stopped (V48);
  // the fifth works.
  symbiote.report(waiting!, 'The plan');
  symbiote.commit(merged!, 'double.ts', 'export const double = (a: number) => a * 2;\n', 'Double');
  execFileSync('git', ['-C', symbiote.repo, 'merge', '-q', '--no-ff', '-m', 'Merge', merged!]);
  symbiote.commit(
    toReview!,
    'triple.ts',
    'export const triple = (a: number) => a * 3;\n',
    'Triple',
  );
  symbiote.session(toReview!, { state: 'done' });
  symbiote.session(stopped!, { state: 'stopped' });

  const tones = [
    ['Merging', '--moved'],
    ['Waiting for you', '--warning'],
    ['To review', '--warning'],
    ['Not running', '--muted'],
    ['Working', '--moved'],
    ['Done', '--added'],
  ] as const;
  const drawings = new Set<string>();
  for (const [name, tone] of tones) {
    const icon = group(page, name).locator('h3 > svg.icon');
    await expect(icon).toBeVisible(POLL);
    await expect(icon).toHaveCSS('color', await tokenColour(page, tone));
    drawings.add(await icon.innerHTML());
    // Only the group has the icon: its cards keep their state's dot. A done card's bin (V55) is
    // an action, not its state.
    await expect(
      group(page, name).locator('.workspace-row .icon:not(.card-remove .icon)'),
    ).toHaveCount(0);
    await expect(group(page, name).locator('.workspace-row .state-dot')).toBeVisible();
  }
  // The merges first, above Waiting for you, whatever waits (fix/merging-status); one at work spins
  // as a working agent's dot does.
  await expect(sidenav(page).locator('.workspace-group h3 .sidenav-label')).toHaveText(
    tones.map(([name]) => name),
  );
  const merging = group(page, 'Merging').locator('.state-dot');
  await expect
    .poll(() => spinner(merging))
    .toEqual({ animation: 'state-spin 1s', across: 11, comet: true });
  // Six drawings, none of them History's clock.
  drawings.add(await pages(page).getByRole('link', { name: 'History' }).locator('svg').innerHTML());
  expect(drawings.size).toBe(7);

  // Folded to the rail: each icon stands for its group, named in its tooltip; the merge shows
  // only its dot, as a workspace does.
  await sidenav(page).getByRole('button', { name: 'Fold the sidenav' }).click();
  await expect(sidenav(page)).toHaveClass(/rail/);
  for (const [name] of tones) {
    const heading = group(page, name).locator('h3');
    await expect(heading.locator('> svg.icon')).toBeVisible();
    await expect(heading.locator('.sidenav-label')).toBeHidden();
    await expect(heading).toHaveAttribute('title', name);
  }
  await expect(group(page, 'Merging').locator('.workspace-state')).toBeHidden();
  await expect
    .poll(() => spinner(merging))
    .toEqual({ animation: 'state-spin 1s', across: 11, comet: true });
});

test('the terminal fills the main area, down to the status bar', async ({ page }) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}history`);
  await start(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  const screen = workspace(page, branch).locator('.xterm-rows');
  // The fake agent prints its terminal's size: [<columns>x<rows>], again on each resize.
  await expect(screen).toContainText(/\[\d+x\d+\]/, POLL);
  const size = async () =>
    [...((await screen.textContent()) ?? '').matchAll(/\[(\d+)x(\d+)\]/g)]
      .at(-1)
      ?.slice(1)
      .map(Number) ?? [0, 0];
  // Without the branch's changes beside it (V29d; changes.spec measures it with them).
  await workspace(page, branch).getByRole('button', { name: 'Changes' }).click();
  await expect.poll(async () => (await size())[0], POLL).toBeGreaterThanOrEqual(140);
  const [, rows = 0] = await size();
  // At least 65 % of the window. In Geist Mono at 14 px (V32) a cell is 8 x 18 px: 148 x 44 here;
  // 46 rows at 13 px (V29b), 58 in the fallback font's 13 px lines (V29a), 41 on `main` then.
  expect(rows).toBeGreaterThanOrEqual(43);
  const box = await workspace(page, branch).locator('.xterm-screen').boundingBox();
  expect(((box?.width ?? 0) * (box?.height ?? 0)) / (1440 * 900)).toBeGreaterThan(0.65);
  const bar = await statusBar(page).boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan((bar?.y ?? 0) - 40);
});

test('narrow: the sidenav is a drawer, closed once a workspace is picked', async ({ page }) => {
  const symbiote = await serve();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${symbiote.url}history`);
  await expect(sidenav(page)).toBeHidden();
  await page.getByRole('button', { name: 'Open the sidenav' }).click();
  await expect(sidenav(page)).toBeVisible();
  await start(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  await expect(workspace(page, branch)).toBeVisible();
  await expect(sidenav(page)).toBeHidden();
  await page.getByRole('button', { name: 'Open the sidenav' }).click();
  await pages(page).getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(`${symbiote.url}history`);
  await expect(sidenav(page)).toBeHidden();
});

test('narrow: a diff opens its sidenav from the strip at the top (V29b)', async ({ page }) => {
  const diff = await serveFixture('callers');
  running.push(diff);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(diff.url);
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  await expect(sidenav(page)).toBeHidden();
  await page.getByRole('button', { name: 'Open the sidenav' }).click();
  await expect(sidenav(page)).toBeVisible();
  await expect(pages(page).getByRole('link', { name: 'History' })).toBeVisible();
  // A click beside the drawer closes it.
  await page.locator('.shell-scrim').click({ position: { x: 370, y: 400 } });
  await expect(sidenav(page)).toBeHidden();
});

test('old addresses: a workspace to its address today, the rest to History', async ({ page }) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}workspaces?branch=feature%2Fx`);
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fx`);
  // A workspace that is not there: said in the main area.
  await expect(page.getByRole('main')).toContainText('No workspace feature/x');
  await page.goto(`${symbiote.url}features`);
  await expect(page).toHaveURL(`${symbiote.url}history`);
  await page.goto(`${symbiote.url}workspaces`);
  await expect(page).toHaveURL(`${symbiote.url}history`);
});

test('a diff of symbiote view: the sidenav as a rail beside its canvas, [ opens it', async ({
  page,
}) => {
  const diff = await serveFixture('callers');
  running.push(diff);
  await page.goto(diff.url);
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  await expect(sidenav(page)).toHaveClass(/rail/);
  expect((await sidenav(page).boundingBox())?.width ?? 0).toBeLessThanOrEqual(56);
  // The canvas keeps nearly all of its width: 1,140 px at 1440 without the rail (V29 spike).
  expect((await page.locator('.react-flow').boundingBox())?.width ?? 0).toBeGreaterThan(1080);
  await expect(statusBar(page)).toBeVisible();

  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('[');
  await expect(sidenav(page)).not.toHaveClass(/rail/);
  await page.reload();
  await expect(sidenav(page)).not.toHaveClass(/rail/);
  // A page picked here loads the shell.
  await pages(page).getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(new URL('/history', diff.url).href);
  await expect(page.locator('.commit').first()).toBeVisible();
});
