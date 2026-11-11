import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import {
  graphPage,
  serveFixture,
  serveWorkspaces,
  wholeFirst,
  type RunningWorkspaces,
} from './symbiote.js';
import { noStream } from './overview-data.js';

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
/** Settings: the sidenav's last row, under the workspaces. */
const settingsLink = (page: Page) =>
  sidenav(page).locator(':scope > :last-child').getByRole('link', { name: 'Settings' });
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

test('symbiote view opens the Overview in the shell: the pages, then the workspaces, and a status bar', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(symbiote.url);
  // The root alone is the Overview (V91, decision 848; Git before), shown at its own address.
  await expect(page).toHaveURL(`${symbiote.url}overview`);
  // A title bar is Symbiote's window's only (N1c): none in a browser.
  await expect(page.locator('.titlebar')).toHaveCount(0);
  // The pages one works in; Settings is at the sidenav's bottom, after the workspaces.
  const links = pages(page).getByRole('link');
  await expect(links).toHaveCount(7);
  // The Overview first (V91), then Nucleus and Git, as the proofs (V93).
  await expect(links.nth(0)).toHaveAccessibleName('Overview');
  await expect(links.nth(1)).toHaveAccessibleName('Nucleus');
  await expect(links.nth(2)).toHaveAccessibleName('Git');
  await expect(links.nth(3)).toHaveAccessibleName('Skills');
  await expect(links.nth(4)).toHaveAccessibleName('Monitor');
  // Issues (IS1), then History (V77): the cleaned-up workspaces.
  await expect(links.nth(5)).toHaveAccessibleName('Issues');
  await expect(links.nth(6)).toHaveAccessibleName('History');
  await expect(settingsLink(page)).toBeVisible();
  await expect(pages(page).getByRole('link', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.overview')).toBeVisible();
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
  await expect(pages(page).getByRole('link', { name: 'Overview' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await marked(page)).toBe(true);
});

test('a card opens its workspace from Git and Settings, in place; Back returns', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}settings`);
  await start(page, 'Add a half function');
  await start(page, 'Add clamp');
  const half = 'feature/add-a-half-function';
  const clamp = 'feature/add-clamp';

  await settingsLink(page).click();
  await expect(page).toHaveURL(`${symbiote.url}settings`);
  await expect(page.getByRole('navigation', { name: 'Settings' })).toBeVisible();
  await mark(page);
  await card(page, half).getByRole('button', { name: 'Add a half function' }).click();
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fadd-a-half-function`);
  await expect(workspace(page, half)).toBeVisible();
  await pages(page).getByRole('link', { name: 'Git' }).click();
  await expect(page).toHaveURL(`${symbiote.url}git`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await card(page, clamp).getByRole('button', { name: 'Add clamp' }).click();
  await expect(workspace(page, clamp)).toBeVisible();
  // None of it loaded the page again.
  expect(await marked(page)).toBe(true);

  await page.goBack();
  await expect(page).toHaveURL(`${symbiote.url}git`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await page.goBack();
  await expect(workspace(page, half)).toBeVisible();
});

test('keys: h and s go to the pages, w to the workspaces and the arrows between them, [ folds the sidenav', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}git`);
  await start(page, 'Add a half function');
  await start(page, 'Add clamp');
  await page.locator('body').click({ position: { x: 1, y: 1 } });

  await page.keyboard.press('g');
  await expect(page).toHaveURL(`${symbiote.url}git`);
  await page.keyboard.press('s');
  await expect(page).toHaveURL(`${symbiote.url}settings`);
  await page.keyboard.press('g');
  await expect(page).toHaveURL(`${symbiote.url}git`);
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
  await page.keyboard.press('g');
  await expect(page).toHaveURL(`${symbiote.url}git`);
  await page.keyboard.press('[');
  await expect(sidenav(page)).toHaveClass(/rail/);
  await expect(pages(page).getByRole('link', { name: 'Git' })).toBeVisible();
  const before = (await sidenav(page).boundingBox())?.width ?? 0;
  expect(before).toBeLessThanOrEqual(56);
  await page.reload();
  await expect(sidenav(page)).toHaveClass(/rail/);
  await sidenav(page).getByRole('button', { name: 'Open the sidenav' }).click();
  await expect(sidenav(page)).not.toHaveClass(/rail/);
  expect((await sidenav(page).boundingBox())?.width ?? 0).toBeGreaterThan(200);
});

test('Settings at the sidenav’s bottom, under the workspaces: open, folded, and when the list scrolls', async ({
  page,
}) => {
  const symbiote = await serve();
  // A short window: the workspaces' list scrolls, and Settings stays in view under it.
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`${symbiote.url}git`);
  for (const what of ['Add a half function', 'Add clamp', 'Add a sum', 'Add a max'])
    await start(page, what);
  const list = sidenav(page).locator('.sidenav-list');
  await expect(list.locator('.workspace-row')).toHaveCount(4, POLL);
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  /** Its bottom at the sidenav's (inside its padding), and under the list. */
  const atTheBottom = async () => {
    const side = await sidenav(page).boundingBox();
    const link = await settingsLink(page).boundingBox();
    const shown = await list.boundingBox();
    if (!side || !link || !shown) throw new Error('Not drawn');
    expect(side.y + side.height - (link.y + link.height)).toBeLessThanOrEqual(12);
    expect(link.y).toBeGreaterThanOrEqual(shown.y + shown.height);
    return link;
  };
  await atTheBottom();
  // A page's link as before: it opens Settings and says it is the page shown.
  await settingsLink(page).click();
  await expect(page).toHaveURL(`${symbiote.url}settings`);
  await expect(settingsLink(page)).toHaveAttribute('aria-current', 'page');

  // Folded to the rail: its icon at the bottom, where the pages' icons are across.
  await sidenav(page).getByRole('button', { name: 'Fold the sidenav' }).click();
  await expect(sidenav(page)).toHaveClass(/rail/);
  const link = await atTheBottom();
  const history = await pages(page).getByRole('link', { name: 'Git' }).boundingBox();
  expect([link.x, link.width]).toEqual([history?.x, history?.width]);
});

test('a card keeps the focus when its workspace moves to another group', async ({ page }) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}git`);
  await start(page, 'Add a half function');
  await start(page, 'Add clamp');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('g');
  await expect(page).toHaveURL(`${symbiote.url}git`);
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

test('a workspace whose agent is still starting is at work, never "No agent" (fix/e2e-flakes)', async ({
  page,
}) => {
  const symbiote = await serve();
  // Claude Code's --bg takes 1.5 s, as under load: its record is there before its session is.
  symbiote.slowStarts(1_500);
  await page.goto(`${symbiote.url}git`);
  await start(page, 'Add a half function');
  const buttons = sidenav(page).locator('.workspace-row .workspace-about');
  await expect(buttons).toHaveCount(1, POLL);
  // Every state the sidenav shows while the second one starts.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as { seen?: string[] }).seen = seen;
    new MutationObserver(() => {
      const side = document.querySelector('.sidenav');
      for (const row of side?.querySelectorAll<HTMLElement>('.workspace-row[data-branch]') ?? []) {
        const group = row.closest('.workspace-group')?.getAttribute('aria-label') ?? '';
        seen.push(`${group}: ${row.textContent ?? ''}`);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await start(page, 'Add clamp');
  await expect(group(page, 'Working').locator('.workspace-row')).toHaveCount(2, POLL);
  // The start answered: the cards in the order they were started, both at work.
  await expect(buttons.first()).toContainText('Add a half function');
  const seen = await page.evaluate(() => (window as { seen?: string[] }).seen ?? []);
  expect(seen.filter((s) => s.startsWith('Not running') || s.includes('No agent'))).toEqual([]);
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

// V88: the sidenav's top is the S and the project's name alone, as the redesign's kits draw it; the
// tip and the link's name keep Symbiote's, for the rail where only the S shows.
test("the sidenav's top names the project alone, beside the S", async ({ page }) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}git`);
  const brand = sidenav(page).locator('.sidenav-brand');
  const project = basename(symbiote.repo);
  await expect(brand).toHaveText(project);
  await expect(brand).toHaveAccessibleName(`Symbiote · ${project}`);
  await expect(brand.locator('img')).toBeVisible();
});

test("each group is a name and a count; each row its state's icon, in its colour (V93)", async ({
  page,
}) => {
  const symbiote = await serve();
  // Done today shown (V91 folds Done by default, decision 859): this is about the rows' icons.
  await page.addInitScript(() => localStorage.setItem('symbiote.viewer.done', 'open'));
  // A merge in the queue, for the Merging group.
  // The list as this spec answers it: no stream (V94), the page polls.
  await noStream(page);
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
  await page.goto(`${symbiote.url}git`);
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
    // V88 (decision 813): the agent's turn amber, the person's violet, done green; not running a
    // faint mark (V93, decision 876).
    ['Merging', '--run'],
    ['Waiting for you', '--you'],
    ['To review', '--you'],
    ['Not running', '--faint'],
    ['Working', '--run'],
    ['Done today', '--ok'],
  ] as const;
  for (const [name, tone] of tones) {
    // No group icon (decision 877): its name and its count.
    await expect(group(page, name).locator('h3 svg.icon:not(.chevron)')).toHaveCount(0, POLL);
    await expect(group(page, name).locator('h3 .branches-count')).toBeVisible();
    // Each row its state's icon, in its tone.
    const icon = group(page, name).locator('.ws-row-icon').first();
    await expect(icon).toBeVisible(POLL);
    await expect(icon).toHaveCSS('color', await tokenColour(page, tone));
  }
  // The merges first, above Waiting for you, whatever waits (fix/merging-status).
  await expect(sidenav(page).locator('.workspace-group h3 .sidenav-label')).toHaveText(
    tones.map(([name]) => name),
  );
  // At work, its arc turns; a merge at work is its merge icon in amber (the proofs).
  await expect(group(page, 'Working').locator('.ws-row-icon .icon.spin')).toHaveCSS(
    'animation-name',
    'icon-spin',
  );

  // Folded to the rail: each row its icon, named in its tooltip; a group a hairline.
  await sidenav(page).getByRole('button', { name: 'Fold the sidenav' }).click();
  await expect(sidenav(page)).toHaveClass(/rail/);
  for (const [name] of tones) {
    await expect(group(page, name).locator('h3 .sidenav-label')).toBeHidden();
    await expect(group(page, name).locator('.ws-row-icon').first()).toBeVisible();
    await expect(group(page, name).locator('.ws-row-state')).toHaveCount(0);
  }
});

test('the terminal fills the main area, down to the status bar', async ({ page }) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}git`);
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
  await expect.poll(async () => (await size())[0], POLL).toBeGreaterThanOrEqual(118);
  const [, rows = 0] = await size();
  // Most of the window. In Geist Mono at 15 px (V61) a cell is 9 x 19 px: 58.9 % of the window
  // since V89's bar under the terminal (37 px); 119 x 38 since V79's 300 px sidenav, 59.7 %; 124 x 38 and 62 % since V72 (the page frame's
  // 16 px margins, its two-line head, the tabs' 48 px head); 127 x 40 and 67 % before; at 14 px (V32) 8 x 18, 148 x 44; 46 rows at 13 px
  // (V29b), 58 in the fallback font's 13 px lines (V29a), 41 on `main` then.
  expect(rows).toBeGreaterThanOrEqual(38);
  const box = await workspace(page, branch).locator('.xterm-screen').boundingBox();
  expect(((box?.width ?? 0) * (box?.height ?? 0)) / (1440 * 900)).toBeGreaterThan(0.585);
  // Down to the bar under it (V89), and that bar down to the status bar.
  const under = await workspace(page, branch)
    .getByRole('region', { name: 'Agent status' })
    .boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan((under?.y ?? 0) - 20);
  const bar = await statusBar(page).boundingBox();
  expect((under?.y ?? 0) + (under?.height ?? 0)).toBeGreaterThan((bar?.y ?? 0) - 40);
});

test('narrow: the sidenav is a drawer, closed once a workspace is picked', async ({ page }) => {
  const symbiote = await serve();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${symbiote.url}git`);
  await expect(sidenav(page)).toBeHidden();
  await page.getByRole('button', { name: 'Open the sidenav' }).click();
  await expect(sidenav(page)).toBeVisible();
  await start(page, 'Add a half function');
  const branch = 'feature/add-a-half-function';
  await expect(workspace(page, branch)).toBeVisible();
  await expect(sidenav(page)).toBeHidden();
  await page.getByRole('button', { name: 'Open the sidenav' }).click();
  await pages(page).getByRole('link', { name: 'Git' }).click();
  await expect(page).toHaveURL(`${symbiote.url}git`);
  await expect(sidenav(page)).toBeHidden();
});

test('narrow: a diff opens its sidenav from the strip at the top (V29b)', async ({ page }) => {
  const diff = await serveFixture('callers');
  running.push(diff);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(graphPage(diff.url));
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  await expect(sidenav(page)).toBeHidden();
  await page.getByRole('button', { name: 'Open the sidenav' }).click();
  await expect(sidenav(page)).toBeVisible();
  await expect(pages(page).getByRole('link', { name: 'Git' })).toBeVisible();
  // A click beside the drawer closes it.
  await page.locator('.shell-scrim').click({ position: { x: 370, y: 400 } });
  await expect(sidenav(page)).toBeHidden();
});

test('old addresses: a workspace to its address today, the rest to the Overview', async ({
  page,
}) => {
  const symbiote = await serve();
  await page.goto(`${symbiote.url}workspaces?branch=feature%2Fx`);
  await expect(page).toHaveURL(`${symbiote.url}?branch=feature%2Fx`);
  // A workspace that is not there: said in the main area.
  await expect(page.getByRole('main')).toContainText('No workspace feature/x');
  // The rest: the Overview, which the root opens (V91; Git before).
  await page.goto(`${symbiote.url}features`);
  await expect(page).toHaveURL(`${symbiote.url}overview`);
  await page.goto(`${symbiote.url}workspaces`);
  await expect(page).toHaveURL(`${symbiote.url}overview`);
  // History's address before V66: Git, its scope kept.
  await page.goto(`${symbiote.url}history?scope=current`);
  await expect(page).toHaveURL(`${symbiote.url}git?scope=current`);
  await expect(page.getByRole('button', { name: /^This branch/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('a diff of symbiote view: the sidenav as a rail beside its canvas, [ opens it', async ({
  page,
}) => {
  const diff = await serveFixture('callers');
  running.push(diff);
  // The whole change first (V109): this spec starts from it, not from the riskiest finding.
  await wholeFirst(page);
  await page.goto(graphPage(diff.url));
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  await expect(sidenav(page)).toHaveClass(/rail/);
  expect((await sidenav(page).boundingBox())?.width ?? 0).toBeLessThanOrEqual(56);
  // The canvas keeps nearly all of its width: 1,140 px at 1440 without the rail (V29 spike); the
  // cards' gutters take 24 (V61), 48 and the card's edge 2 since V72's 16 px margins (1,042).
  expect((await page.locator('.react-flow').boundingBox())?.width ?? 0).toBeGreaterThan(1030);
  await expect(statusBar(page)).toBeVisible();

  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('[');
  await expect(sidenav(page)).not.toHaveClass(/rail/);
  await page.reload();
  await expect(sidenav(page)).not.toHaveClass(/rail/);
  // A page picked here loads the shell.
  await pages(page).getByRole('link', { name: 'Git' }).click();
  await expect(page).toHaveURL(new URL('/git', diff.url).href);
  await expect(page.locator('.commit').first()).toBeVisible();
});
