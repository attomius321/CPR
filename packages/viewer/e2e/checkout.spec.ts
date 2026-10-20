import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './cpr.js';

// Checking out from the commits page (V11). Each test gets its own repository: checkouts change
// its working tree.
let cpr: RunningCommits;
const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  cpr = await serveCommits();
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  cpr.stop();
  expect(errors).toEqual([]);
});

const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);
const row = (page: Page, subject: string) =>
  page.locator('.commit', {
    has: page.locator('.commit-subject').getByText(new RegExp(`^${subject}(,|$)`)),
  });
const head = () =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: cpr.repo, encoding: 'utf8' }).trim();
/** The row menu's "Check out" entry, and the submenu it opens (V14). */
const checkOut = (page: Page) => page.getByRole('menuitem', { name: 'Check out', exact: true });
const targets = (page: Page) => page.getByRole('menu', { name: 'Check out' }).getByRole('menuitem');
const menuOf = async (page: Page, subject: string) => {
  await row(page, subject).click({ button: 'right' });
  await checkOut(page).hover();
  return targets(page);
};
const choose = async (page: Page, subject: string, name: string) => {
  await menuOf(page, subject);
  await page.getByRole('menuitem', { name, exact: true }).click();
};
/** Each target's accessible name: the whole sentence, as V11 labelled it. */
const names = (entries: Locator) =>
  entries.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));

test('offers what each row can check out, in a submenu', async ({ page }) => {
  await page.goto(`${cpr.url}history`);
  // The menu holds "Check out" (and "Review", V15: the row has a branch); targets open on hover.
  // Near the row's left end, with room on the right for the submenu.
  await row(page, 'Try a wobble').click({ button: 'right', position: { x: 120, y: 10 } });
  await expect(page.getByRole('menuitem')).toHaveText([
    'Check out',
    'Review',
    'Start a workspace here',
  ]);
  await expect(checkOut(page)).toHaveAttribute('aria-expanded', 'false');
  await checkOut(page).hover();
  await expect(checkOut(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(targets(page)).toHaveCount(2);
  const menu = await page.locator('.checkout-menu').first().boundingBox();
  const submenu = await page.locator('.submenu').boundingBox();
  expect(submenu!.x).toBeGreaterThanOrEqual(menu!.x + menu!.width - 8);
  // "Check out" fills the menu's width (its padding and border aside), its arrow at the edge.
  const item = await checkOut(page).boundingBox();
  expect(item!.width).toBeCloseTo(menu!.width - 10, 0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  const detached = 'Check out this commit (detached HEAD)';
  const commit = /^[0-9a-f]{7} this commit · detached HEAD$/;
  const cases: [string, string[], (string | RegExp)[]][] = [
    ['Add half', ['Check out branch main', detached], ['main branchchecked out', commit]],
    ['Try a wobble', ['Check out branch wip', detached], ['wip branch', commit]],
    [
      'Sketch a topic',
      ['Check out origin/topic as topic', detached],
      ['origin/topic remote · creates branch topic', commit],
    ],
    [
      'Add cube',
      ['Check out tag v1 (detached HEAD)', detached],
      ['v1 tag · detached HEAD', commit],
    ],
  ];
  for (const [subject, sentences, texts] of cases) {
    const entries = await menuOf(page, subject);
    await expect(entries).toHaveText(texts);
    expect(await names(entries)).toEqual(sentences);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  // Each name is drawn as the row draws it.
  await menuOf(page, 'Add cube');
  await expect(page.locator('.submenu .ref')).toHaveText(['v1', /^[0-9a-f]{7}$/]);
  await expect(page.locator('.submenu .ref').first()).toHaveClass(/ref-tag/);
  await expect(page.locator('.submenu .ref').last()).toHaveClass(/ref-commit/);
});

test('the submenu from the keyboard: c opens it, ← and → move between the menus', async ({
  page,
}) => {
  await page.goto(`${cpr.url}history`);
  await row(page, 'Try a wobble').click();
  await page.keyboard.press('c');
  // Straight into the targets, the first one active.
  await expect(targets(page)).toHaveCount(2);
  await expect(targets(page).first()).toHaveClass(/active/);
  await page.keyboard.press('ArrowDown');
  await expect(targets(page).last()).toHaveClass(/active/);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('menu', { name: 'Check out' })).toHaveCount(0);
  await expect(checkOut(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(checkOut(page)).toHaveClass(/active/);
  await page.keyboard.press('ArrowRight');
  await expect(targets(page).first()).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  // From "⋯": the menu, then Enter opens the targets.
  await row(page, 'Try a wobble').locator('.commit-menu').click();
  await expect(checkOut(page)).toHaveClass(/active/);
  await expect(page.getByRole('menu', { name: 'Check out' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(targets(page).first()).toHaveClass(/active/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('Check out branch wip?');
});

test('keeps the submenu in the window: on the left near the right edge, up near the bottom', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 300 });
  await page.goto(`${cpr.url}history`);
  const inWindow = async () => {
    const box = (await page.locator('.submenu').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.y).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(900 - 8 + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(300 - 8 + 0.5);
    return box;
  };
  // "⋯" sits at the row's right end: the menu meets the right edge, the submenu goes left.
  await row(page, 'Try a wobble').click();
  await row(page, 'Try a wobble').locator('.commit-menu').click();
  await checkOut(page).hover();
  const menu = (await page.locator('.checkout-menu').first().boundingBox())!;
  expect((await inWindow()).x).toBeLessThan(menu.x);
  await page.keyboard.press('Escape');
  // Near the bottom the menu opens above the pointer; the submenu, level with its entry or moved
  // up when it is the taller (since V18 the menu has a third entry), stays in the window.
  // Above the status bar (V29a), on the rows.
  const rows = (await page.locator('.commit-list').boundingBox())!;
  await page.mouse.click(rows.x + 120, 300 - 24 - 20, { button: 'right' });
  await checkOut(page).hover();
  const low = (await page.locator('.checkout-menu').first().boundingBox())!;
  expect((await inWindow()).y).toBeLessThanOrEqual(low.y);
});

test('checks out a branch: HEAD, lane 0 and the cursor follow', async ({ page }) => {
  const [, , square] = cpr.shas;
  await page.goto(`${cpr.url}history`);
  await choose(page, 'Try a wobble', 'Check out branch wip');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Check out branch wip?');
  // The name stands out: the row's badge, at the heading's size.
  await expect(dialog.getByRole('heading').locator('.ref-branch')).toHaveText('wip');
  await expect(dialog).toContainText(/Checks out the branch wip, at [0-9a-f]{7}\./);
  await dialog.getByRole('button', { name: 'Check out' }).click();

  await expect(page.getByRole('status')).toHaveText('Switched to branch wip');
  await expect(row(page, 'Try a wobble').locator('.ref')).toHaveText(['HEAD → wip']);
  await expect(row(page, 'Try a wobble').locator('.commit-dot')).toHaveClass(/lane-0/);
  await expect(row(page, 'Add half').locator('.commit-dot')).not.toHaveClass(/lane-0/);
  await expect(page.locator('.commit.cursor .commit-subject')).toHaveText('Try a wobble');
  await expect(page.getByRole('button', { name: 'This branch (wip)' })).toBeVisible();
  expect(
    execFileSync('git', ['branch', '--show-current'], { cwd: cpr.repo, encoding: 'utf8' }),
  ).toBe('wip\n');
  expect(
    execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: cpr.repo, encoding: 'utf8' }).trim(),
  ).toBe(square);
});

test('checks out a remote branch as a local one from the keyboard, and a tag detached', async ({
  page,
}) => {
  const [, , , cube] = cpr.shas;
  await page.goto(`${cpr.url}history`);
  // The cursor starts on HEAD, row 2; row 0 is origin/topic's.
  await expect(page.locator('.commit.cursor .commit-subject')).toHaveText(/^Add half/);
  await page.keyboard.press('k');
  await page.keyboard.press('k');
  await page.keyboard.press('c');
  await expect(targets(page).first()).toHaveAccessibleName('Check out origin/topic as topic');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText(
    /Creates the branch topic at [0-9a-f]{7}, tracking origin\/topic, and checks it out\./,
  );
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText(
    'Created the branch topic, tracking origin/topic, and switched to it',
  );
  await expect(row(page, 'Sketch a topic').locator('.ref')).toHaveText([
    'HEAD → topic',
    'origin/topic',
  ]);

  await choose(page, 'Add cube', 'Check out tag v1 (detached HEAD)');
  await expect(page.getByRole('dialog')).toContainText(
    `Detaches HEAD at ${short(cube)} (tag v1): commits made there belong to no branch`,
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Check out' }).click();
  await expect(page.getByRole('status')).toHaveText(`HEAD is now at ${short(cube)} (detached)`);
  await expect(page.getByRole('button', { name: 'This branch', exact: true })).toBeVisible();
  // Detached: HEAD's badge alone, and the title says where it is.
  await expect(row(page, 'Add cube').locator('.ref')).toHaveText(['HEAD', 'v1']);
  await expect(row(page, 'Add cube').locator('.ref-head')).toHaveAttribute(
    'title',
    'HEAD, detached: no branch is checked out',
  );
  await expect(
    page.getByRole('button', { name: `HEAD → ${short(cube)} (detached)` }),
  ).toBeVisible();
  expect(head()).toBe(cube);
});

test("shows git's refusal and changes nothing", async ({ page }) => {
  const half = cpr.shas[4];
  appendFileSync(join(cpr.repo, 'src/math.ts'), '// a local change\n');
  await page.goto(`${cpr.url}history`);
  await choose(page, 'base', 'Check out this commit (detached HEAD)');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(
    '1 file has uncommitted changes: it comes along, unless the target changes it too',
  );
  await dialog.getByRole('button', { name: 'Check out' }).click();
  await expect(dialog.locator('pre.error')).toContainText(
    'Your local changes to the following files would be overwritten by checkout',
  );
  await expect(dialog.locator('pre.error')).toContainText('src/math.ts');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(head()).toBe(half);
  await expect(row(page, 'Add half').locator('.ref').first()).toHaveText('HEAD → main');
});

test('shows a checkout made elsewhere when the page is back', async ({ page }) => {
  await page.goto(`${cpr.url}history`);
  await expect(row(page, 'Add half').locator('.ref').first()).toHaveText('HEAD → main');
  execFileSync('git', ['switch', '-q', 'wip'], { cwd: cpr.repo });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(row(page, 'Try a wobble').locator('.ref')).toHaveText(['HEAD → wip']);
  await expect(page.locator('.commit.cursor .commit-subject')).toHaveText('Try a wobble');
});
