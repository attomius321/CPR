import { expect, test, type Page } from '@playwright/test';
import { serveBranches, type Running } from './symbiote.js';

// V10b: the branches panel left of the commits; a click goes to a branch's tip row, wherever it
// is in the history.
let symbiote: Running;
const errors: string[] = [];

test.beforeAll(async () => {
  symbiote = await serveBranches();
});

test.afterAll(() => symbiote.stop());

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => expect(errors).toEqual([]));

const panel = (page: Page) => page.getByRole('complementary', { name: 'Branches' });
const entry = (page: Page, label: string) =>
  panel(page).locator('.branches-branch', {
    has: page.locator('.branches-name', { hasText: new RegExp(`^${label}$`) }),
  });
const folder = (page: Page, label: string) =>
  panel(page).locator('.branches-folder', {
    has: page.locator('.branches-name', { hasText: `${label}/` }),
  });
const cursorSubject = (page: Page) => page.locator('.commit.cursor .commit-subject');

async function open(page: Page, url = `${symbiote.url}history`) {
  await page.goto(url);
  await expect(panel(page).locator('.branches-branch').first()).toBeVisible();
}

test('lists local branches and remote ones by folder, folders closed', async ({ page }) => {
  await open(page);
  await expect(panel(page).locator('.branches-section')).toHaveText(['Local 4', 'Remotes 6']);
  await expect(panel(page).locator('.branches-folder, .branches-branch')).toHaveText([
    '●main',
    'a-branch-whose-name-runs-on-long-enough-to-crowd-its-row',
    'oldgone',
    'wip↑2 ↓1',
    'origin/6',
    'feature/1',
    'fix/2',
    'a-branch-whose-name-runs-on-long-enough-to-crowd-its-row',
    'topic',
    'wip',
  ]);
  // Folded but origin/ (V29b: chevrons, not ▸ and ▾).
  await expect(panel(page).locator('.branches-folder[aria-expanded="true"]')).toHaveText([
    'origin/6',
  ]);
  await expect(entry(page, 'wip').first().locator('.branches-track')).toHaveAttribute(
    'data-tip',
    '2 commits not pushed to origin/wip, 1 not pulled',
  );
  await expect(entry(page, 'old').locator('.branches-track')).toHaveAttribute(
    'data-tip',
    'origin/old was deleted',
  );
  await expect(entry(page, 'topic')).toHaveAttribute('data-tip', 'origin/topic');
  // The rows keep their width's end in view: no sideways scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.locator('.commit .commit-date').first()).toBeInViewport();
});

test('opens folders, and filters on the whole name', async ({ page }) => {
  await open(page);
  await folder(page, 'fix').click();
  await expect(folder(page, 'fix')).toHaveAttribute('aria-expanded', 'true');
  await expect(entry(page, 'one')).toBeVisible();
  await expect(entry(page, 'two')).toBeVisible();

  const filter = panel(page).getByRole('textbox', { name: 'Filter branches' });
  await filter.fill('DEEP');
  await expect(panel(page).locator('.branches-section')).toHaveText(['Remotes 1']);
  await expect(panel(page).locator('.branches-folder, .branches-branch')).toHaveText([
    'origin/1',
    'feature/1',
    'deep',
  ]);
  // Open folders, their chevrons down (V29b).
  await expect(panel(page).locator('.branches-folder[aria-expanded="true"]')).toHaveText([
    'origin/1',
    'feature/1',
  ]);
  await filter.fill('zzz');
  await expect(panel(page)).toContainText('No branch matches');
  // Escape leaves the field and keeps the filter, as the change list's search does.
  await filter.press('Escape');
  await expect(filter).not.toBeFocused();
  await expect(filter).toHaveValue('zzz');
  // Cleared, the folder opened before is still open.
  await filter.fill('');
  await expect(entry(page, 'one')).toBeVisible();
});

test("goes to a branch's tip anywhere in the history, and flashes it", async ({ page }) => {
  await open(page);
  await folder(page, 'feature').click();
  await entry(page, 'deep').click();
  await expect(cursorSubject(page)).toHaveText('Deep feature');
  await expect(page.locator('.commit.cursor')).toBeInViewport();
  await expect(page.locator('.commit.cursor')).toHaveClass(/flash/);
  // Its row is far below the first block of rows the page had.
  const top = await page.locator('.commit.cursor').evaluate((row) => parseInt(row.style.top));
  expect(top / 32).toBeGreaterThan(200);
  // c and r work on it as on any row.
  await page.keyboard.press('c');
  await expect(page.getByRole('menuitem', { name: /origin\/feature\/deep/ })).toBeVisible();
});

test('from "This branch", a branch it does not list: every branch, then its tip', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'This branch (main)' }).click();
  await expect(page).toHaveURL(`${symbiote.url}history?scope=current`);
  await entry(page, 'topic').click();
  await expect(page).toHaveURL(`${symbiote.url}history`);
  await expect(cursorSubject(page)).toHaveText('Topic work');
  await expect(page.getByRole('button', { name: 'All branches' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('/ finds a branch', async ({ page }) => {
  await open(page);
  await page.keyboard.press('/');
  const filter = panel(page).getByRole('textbox', { name: 'Filter branches' });
  await expect(filter).toBeFocused();
  await page.keyboard.type('topic');
  await expect(panel(page).locator('.branches-branch')).toHaveText(['topic']);
  // Enter goes to the first branch listed.
  await page.keyboard.press('Enter');
  await expect(cursorSubject(page)).toHaveText('Topic work');
});

test('rows keep their date in view beside the panel: long badges shrink first', async ({
  page,
}) => {
  for (const width of [1000, 820]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${symbiote.url}history`);
    await expect(page.locator('.commit:not(.loading)').first()).toBeVisible();
    const clipped = await page.evaluate(() => {
      const list = document.querySelector('.commit-list')?.getBoundingClientRect();
      return [...document.querySelectorAll('.commit:not(.loading) .commit-date')].filter(
        (date) => !list || date.getBoundingClientRect().right > list.right + 0.5,
      ).length;
    });
    expect(clipped, `at ${width} px`).toBe(0);
    // The long badge is cut, and named in full on hover.
    const badge = page.locator('.ref', { hasText: 'origin/a-branch-whose' });
    await expect(badge).toHaveAttribute(
      'data-tip',
      'origin/a-branch-whose-name-runs-on-long-enough-to-crowd-its-row',
    );
  }
});

test('under 900 px, a button opens the panel over the rows', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await page.goto(`${symbiote.url}history`);
  await expect(page.locator('.commit').first()).toBeVisible();
  await expect(panel(page)).toBeHidden();
  const toggle = page.getByRole('button', { name: 'Branches', exact: true });
  await toggle.click();
  await expect(panel(page)).toBeVisible();
  await entry(page, 'topic').click();
  await expect(panel(page)).toBeHidden();
  await expect(cursorSubject(page)).toHaveText('Topic work');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
