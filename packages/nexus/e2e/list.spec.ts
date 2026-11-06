import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  cacheFolder,
  homeFolder,
  settingsFolder,
  startNexus,
  stopRecorded,
  worktree,
  type Served,
} from './nexus.js';

// NX5 (decisions 908–916): one field over the repositories the nexus knows, paths completing in
// it, the list in its groups and the picked repository's card beside it. NX6 (decisions 925, 926):
// home scanned at the start and on ⟳, its folders a tree under the groups. Real `symbiote view`s
// started by the nexus, on a home, a cache and a settings folder of the spec's own.

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const field = (page: Page) => page.getByRole('combobox', { name: 'Find a repository' });
const list = (page: Page) => page.getByRole('listbox', { name: 'Repositories' });
const rows = (page: Page) => list(page).getByRole('option');
const rowNames = (page: Page) => list(page).locator('.nexus-row-name');
const picked = (page: Page) => list(page).locator('[role="option"][aria-selected="true"]');
const groups = (page: Page) => list(page).locator('.nexus-group-name');
const card = (page: Page) => page.locator('.nexus-detail');
const foot = (page: Page) => page.locator('.nexus-foot');
const tab = (page: Page, name: string | RegExp) =>
  page.locator('.nexus-tabs').getByRole('tab', { name });

test.describe('Symbiote nexus: the list and the card (NX5)', () => {
  const cleanup: (() => unknown)[] = [];
  test.afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  /** A home with `projects/` (alpha and beta, repositories; notes, a folder), a cache, settings. */
  function setUp() {
    const home = homeFolder(['alpha', 'beta'], ['notes']);
    const cache = cacheFolder();
    const settings = settingsFolder();
    cleanup.push(
      () => home.remove(),
      () => cache.remove(),
      () => settings.remove(),
      () => stopRecorded(cache.dir),
    );
    return { home, cache: cache.dir, settings };
  }

  async function nexus(cache: string, home: string, config: string): Promise<Served> {
    const served = await startNexus(cache, home, config);
    cleanup.push(() => served.stop());
    return served;
  }

  test('finds a repository by part of its path, the match marked; the card follows the pick', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache, settings } = setUp();
    const served = await nexus(cache, home.dir, settings.dir);
    await page.goto(served.url);

    await expect(page.locator('.page-head h1')).toHaveText('Symbiotes');
    // Home as a tree (decision 926): its first level, scanned at the start.
    await expect(groups(page)).toHaveText(['Home']);
    await expect(rowNames(page)).toHaveText(['projects/']);
    await expect(foot(page)).toContainText('Home: 2 repositories in');
    // There is always a pick: the first row, its card beside the list.
    await expect(picked(page)).toHaveCount(1);
    await expect(card(page).locator('h2')).toHaveText('projects/');
    await expect(card(page).locator('.status-label')).toHaveText('Folder');

    // Any part of the path, folders too: every folder of home's scan, flat, by path.
    await field(page).fill('proj');
    await expect(rowNames(page)).toHaveText(['projects/', 'alpha', 'beta', 'notes/']);
    await expect(list(page).locator('mark').first()).toHaveText('proj');
    await field(page).fill('ET');
    await expect(rowNames(page)).toHaveText(['beta']);
    await expect(list(page).locator('.nexus-row-name mark')).toHaveText('et');
    await expect(card(page).locator('h2')).toHaveText('beta');
    await expect(card(page).locator('.status-label')).toHaveText('Not running');
    await expect(card(page).getByRole('button', { name: 'Open Symbiote' })).toBeVisible();
    await field(page).fill('nothing such');
    await expect(rows(page)).toHaveCount(0);
    await expect(list(page)).toContainText(
      'Nothing in home or the lists above has “nothing such” in its path',
    );

    // Esc clears; → opens the picked folder, ↑↓ move the pick, the focus staying in the field.
    await field(page).press('Escape');
    await expect(field(page)).toHaveValue('');
    await expect(rowNames(page)).toHaveText(['projects/']);
    await field(page).press('ArrowRight');
    await expect(rowNames(page)).toHaveText(['projects/', 'alpha', 'beta', 'notes/']);
    await expect(rows(page).first()).toHaveAttribute('aria-expanded', 'true');
    await field(page).press('ArrowRight');
    await expect(picked(page).locator('.nexus-row-name')).toHaveText('alpha');
    await field(page).press('ArrowDown');
    await expect(picked(page).locator('.nexus-row-name')).toHaveText('beta');
    await expect(card(page).locator('h2')).toHaveText('beta');
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute('aria-activedescendant', /.+/);
    // ← goes to the folder holding it, then closes it.
    await field(page).press('ArrowLeft');
    await expect(card(page).locator('h2')).toHaveText('projects/');
    await field(page).press('ArrowLeft');
    await expect(rowNames(page)).toHaveText(['projects/']);
    // The chevron opens it too; a click picks, and opens nothing.
    await rows(page).first().locator('[data-toggle]').click();
    await expect(rowNames(page)).toHaveText(['projects/', 'alpha', 'beta', 'notes/']);
    await rows(page).nth(2).click();
    await expect(card(page).locator('h2')).toHaveText('beta');
    await expect(page.locator('.nexus-tabs [role="tab"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('opens a repository with Enter, shows it running, and keeps it under Opened before once stopped', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache, settings } = setUp();
    const served = await nexus(cache, home.dir, settings.dir);
    await page.goto(served.url);

    await field(page).fill('beta');
    await field(page).press('Enter');
    await expect(tab(page, /^beta/)).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
    await tab(page, /^Symbiotes/).click();
    await expect(groups(page)).toHaveText(['Running', 'Home']);
    await field(page).fill('');
    await expect(picked(page).locator('.nexus-row-name')).toHaveText('beta');
    await expect(card(page).locator('.status-label')).toHaveText('Running');
    await expect(card(page)).toContainText('no changes');
    // Enter on a running one shows its tab.
    await field(page).press('Enter');
    await expect(tab(page, /^beta/)).toHaveAttribute('aria-selected', 'true');
    await tab(page, /^Symbiotes/).click();

    // Stop, after the question; then beta is one opened before.
    await card(page).getByRole('button', { name: 'Stop beta' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(groups(page)).toHaveText(['Opened before', 'Home'], {
      timeout: 15_000,
    });
    await expect(rowNames(page)).toHaveText(['beta', 'projects/']);
    expect(errors).toEqual([]);
  });

  test('completes a path: Tab, → into a folder, Backspace after a / up one', async ({ page }) => {
    const { home, cache, settings } = setUp();
    const served = await nexus(cache, home.dir, settings.dir);
    await page.goto(served.url);

    await field(page).fill('~/pro');
    await expect(groups(page)).toHaveText(['~/']);
    await expect(rowNames(page)).toHaveText(['projects/']);
    await expect(page.locator('.nexus-ghost-rest')).toHaveText('jects/');
    await field(page).press('Tab');
    await expect(field(page)).toHaveValue('~/projects/');
    await expect(field(page)).toBeFocused();
    await expect(rowNames(page)).toHaveText(['alpha', 'beta', 'notes/']);
    await field(page).press('n');
    await expect(groups(page)).toHaveText(['~/projects/', 'Also in ~/projects/']);
    await expect(rowNames(page)).toHaveText(['notes/', 'alpha', 'beta']);
    await expect(card(page).locator('h2')).toHaveText('notes/');
    await field(page).press('ArrowRight');
    await expect(field(page)).toHaveValue('~/projects/notes/');
    await field(page).press('Backspace');
    await expect(field(page)).toHaveValue('~/projects/');
    await field(page).press('Backspace');
    await expect(field(page)).toHaveValue('~/');
    // Browse… types ~/ into the field.
    await field(page).fill('alpha');
    await page.getByRole('button', { name: 'Browse…' }).click();
    await expect(field(page)).toHaveValue('~/');
    await expect(field(page)).toBeFocused();
    // The address names the folder typed: a reload keeps it.
    await field(page).fill('~/projects/');
    await expect(page).toHaveURL(new RegExp(`#folders:${encodeURIComponent(home.projects)}$`));
    await page.reload();
    await expect(field(page)).toHaveValue('~/projects/');
    await expect(rowNames(page)).toHaveText(['alpha', 'beta', 'notes/']);
  });

  test('scans home at the start and on ⟳ only: a folder made meanwhile shows after ⟳', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache, settings } = setUp();
    let served = await nexus(cache, home.dir, settings.dir);
    await page.goto(served.url);

    await expect(page.locator('.nexus-welcome')).toContainText('No Symbiote runs yet');
    await expect(foot(page)).toContainText('Home: 2 repositories in');
    const scanned = () =>
      (JSON.parse(readFileSync(join(cache, 'nexus', 'scan.json'), 'utf8')) as { at: string }).at;
    const at = scanned();
    // A repository made after the start: not listed, the list read again every 2 s meanwhile.
    const gamma = join(home.projects, 'gamma');
    mkdirSync(gamma);
    execFileSync('git', ['init', '-q'], { cwd: gamma });
    await field(page).press('ArrowRight');
    await expect(rowNames(page)).toHaveText(['projects/', 'alpha', 'beta', 'notes/']);
    await page.waitForTimeout(4500);
    await expect(rowNames(page)).toHaveText(['projects/', 'alpha', 'beta', 'notes/']);
    expect(scanned()).toBe(at);

    await foot(page).getByRole('button', { name: 'Scan home again' }).click();
    await expect(rowNames(page)).toHaveText(['projects/', 'alpha', 'beta', 'gamma', 'notes/']);
    await expect(foot(page)).toContainText('Home: 3 repositories in');
    expect(scanned()).not.toBe(at);

    // The next nexus scans at its start.
    await served.stop();
    served = await nexus(cache, home.dir, settings.dir);
    await page.goto(served.url);
    await expect(foot(page)).toContainText('Home: 3 repositories in');
    expect(errors).toEqual([]);
  });

  test("shows a repository's worktrees in its card, and the folder it is in", async ({ page }) => {
    const { home, cache, settings } = setUp();
    worktree(
      join(home.projects, 'alpha'),
      join(home.projects, 'alpha.worktrees', 'feature'),
      'feature/x',
    );
    const served = await nexus(cache, home.dir, settings.dir);
    await page.goto(served.url);

    await field(page).fill('alpha');
    await expect(rowNames(page)).toHaveText(['alpha', 'alpha.worktrees/', 'feature']);
    await expect(card(page).locator('h2')).toHaveText('alpha');
    const checkouts = card(page).getByRole('group', { name: 'Checkouts of this repository' });
    await expect(checkouts.locator('.nexus-row-name')).toHaveText(['alpha', 'feature']);
    await expect(checkouts).toContainText('feature/x');
    const folder = card(page).getByRole('group', { name: 'The folder it is in' });
    await expect(folder.locator('.nexus-row-name')).toHaveText([
      'alpha.worktrees/',
      'beta',
      'notes/',
    ]);
    // A crumb lists its folder in the field.
    await card(page).locator('.nexus-crumbs').getByRole('button', { name: 'projects' }).click();
    await expect(field(page)).toHaveValue('~/projects/');
  });

  test('/ and Ctrl K put the focus in the field', async ({ page }) => {
    const { home, cache, settings } = setUp();
    const served = await nexus(cache, home.dir, settings.dir);
    await page.goto(served.url);
    await expect(rowNames(page)).toHaveText(['projects/']);
    await page.locator('.page-head h1').click();
    await expect(field(page)).not.toBeFocused();
    await page.keyboard.press('/');
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveValue('');
    await page.locator('.page-head h1').click();
    await page.keyboard.press('Control+k');
    await expect(field(page)).toBeFocused();
  });

  test('stands the list over the card in a narrow window', async ({ page }) => {
    const { home, cache, settings } = setUp();
    const served = await nexus(cache, home.dir, settings.dir);
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(served.url);
    await expect(card(page).locator('h2')).toHaveText('projects/');
    const listBox = await page.locator('.nexus-list').boundingBox();
    const cardBox = await card(page).boundingBox();
    expect(cardBox && listBox && cardBox.y >= listBox.y + listBox.height).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      900,
    );
  });
});
