import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  cacheFolder,
  homeFolder,
  recorded,
  startNexus,
  startView,
  stopRecorded,
  type Served,
} from './nexus.js';

// Pins (NX4, decisions 617–620), in the list since NX5 (decisions 908, 909): a pinned repository
// not running is under Pinned, a running one under Running with its pin's mark; a pinned folder and
// a pin whose folder is gone are under Pinned too. Kept in the settings folder from one nexus to the
// next; nothing starts but by the person. Real `symbiote view`s, on a home, a cache and a settings
// folder of the spec's own.

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const tab = (page: Page, name: string | RegExp) =>
  page.locator('.nexus-tabs').getByRole('tab', { name });
const frameOf = (page: Page, name: string) =>
  page.frameLocator(`iframe.nexus-frame[title="${name}"]`);
const list = (page: Page) => page.getByRole('listbox', { name: 'Repositories' });
const rowNames = (page: Page) => list(page).locator('.nexus-row-name');
const groups = (page: Page) => list(page).locator('.nexus-group-name');
/** A group's row names. */
const namesIn = (page: Page, group: string) =>
  list(page)
    .getByRole('group', { name: new RegExp(`^${group}`) })
    .locator('.nexus-row-name');
/** A row by its name: the first, in a group above home's tree (which lists it again). */
const row = (page: Page, name: string) =>
  list(page)
    .getByRole('option')
    .filter({ has: page.locator('.nexus-row-name', { hasText: new RegExp(`^${name}/?$`) }) })
    .first();
const card = (page: Page) => page.locator('.nexus-detail');

test.describe('Symbiote nexus: pins', () => {
  const cleanup: (() => unknown)[] = [];
  test.afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  /** A home with `projects/` (alpha and beta, repositories; notes, a folder), a cache, settings. */
  function setUp() {
    const home = homeFolder(['alpha', 'beta'], ['notes']);
    const cache = cacheFolder();
    const config = mkdtempSync(join(tmpdir(), 'symbiote-e2e-nexus-config-'));
    cleanup.push(
      () => home.remove(),
      () => cache.remove(),
      () => rmSync(config, { recursive: true, force: true }),
      () => stopRecorded(cache.dir),
    );
    return { home, cache: cache.dir, config, pinsFile: join(config, 'symbiote', 'nexus.json') };
  }

  async function nexus(cache: string, home: string, config: string): Promise<Served> {
    const served = await startNexus(cache, home, config);
    cleanup.push(() => served.stop());
    return served;
  }

  const pinsIn = (file: string) =>
    (JSON.parse(readFileSync(file, 'utf8')) as { pinned: string[] }).pinned;

  test('keeps a pinned repository under Pinned from one nexus to the next, started only by the person', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache, config, pinsFile } = setUp();
    const first = await startNexus(cache, home.dir, config);
    cleanup.push(() => first.stop());
    // An old Folders address: the folder typed in the field (decision 910).
    await page.goto(`${first.url}#folders:${encodeURIComponent(home.projects)}`);
    await expect(page.getByRole('combobox', { name: 'Find a repository' })).toHaveValue(
      '~/projects/',
    );
    await expect(tab(page, /^Symbiotes/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.nexus-tabs').getByRole('tab')).toHaveText(['Symbiotes0']);

    // Pinned from its card: under Pinned once the field is cleared, not running.
    await row(page, 'alpha').click();
    await card(page).getByRole('button', { name: 'Pin alpha' }).click();
    await expect(card(page).getByRole('button', { name: 'Unpin alpha' })).toHaveClass(
      /\bnexus-pinned\b/,
    );
    await page.getByRole('combobox', { name: 'Find a repository' }).fill('');
    await expect(groups(page)).toHaveText(['Pinned', 'Home']);
    await expect(namesIn(page, 'Pinned')).toHaveText(['alpha']);
    await expect(row(page, 'alpha')).toContainText(
      join(home.projects, 'alpha').replace(home.dir, '~'),
    );
    await expect(row(page, 'alpha').locator('.state-dot.tone-idle')).toBeVisible();
    await expect(page.locator('.nexus-home .page-line')).toHaveText(
      'None running · 1 pinned · 2 repositories in home',
    );
    expect(pinsIn(pinsFile)).toEqual([join(home.projects, 'alpha')]);
    await page.waitForTimeout(500);
    expect(recorded(cache)).toEqual([]);

    // Another nexus, the same settings: still pinned, and still nothing runs.
    await first.stop();
    const second = await nexus(cache, home.dir, config);
    await page.goto(second.url);
    await expect(namesIn(page, 'Pinned')).toHaveText(['alpha']);
    await page.waitForTimeout(500);
    expect(recorded(cache)).toEqual([]);

    // The person's start: its card. Its tab, then back on Symbiotes under Running, pinned.
    await card(page).getByRole('button', { name: 'Open Symbiote' }).click();
    await expect(tab(page, /^alpha/)).toHaveAttribute('aria-selected', 'true');
    await expect(frameOf(page, 'alpha').locator('.overview')).toBeVisible();
    expect(recorded(cache)).toHaveLength(1);
    await tab(page, /^Symbiotes/).click();
    await expect(groups(page)).toHaveText(['Running', 'Home']);
    await expect(row(page, 'alpha').locator('.state-dot.nexus-live')).toBeVisible();
    await expect(row(page, 'alpha').locator('.nexus-row-pin')).toBeVisible();
    await expect(row(page, 'alpha')).toContainText('no changes');

    // Stopped: under Pinned again, not running.
    await card(page).getByRole('button', { name: 'Stop alpha' }).click();
    await page
      .getByRole('alertdialog', { name: 'Stop alpha?' })
      .getByRole('button', { name: 'Stop', exact: true })
      .click();
    await expect(groups(page)).toHaveText(['Pinned', 'Home']);
    expect(recorded(cache)).toEqual([]);

    // Unpinned from its card: it has run here, so it is one opened before.
    await card(page).getByRole('button', { name: 'Unpin alpha' }).click();
    await expect(groups(page)).toHaveText(['Opened before', 'Home']);
    expect(pinsIn(pinsFile)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('pins a running Symbiote from its card: it stays under Running, by name, marked', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache, config, pinsFile } = setUp();
    for (const name of ['alpha', 'beta']) {
      const view = await startView(join(home.projects, name), cache);
      cleanup.push(() => view.stop());
    }
    const served = await nexus(cache, home.dir, config);
    await page.goto(served.url);
    await expect(namesIn(page, 'Running')).toHaveText(['alpha', 'beta']);

    await row(page, 'beta').click();
    await card(page).getByRole('button', { name: 'Pin beta' }).click();
    await expect(card(page).getByRole('button', { name: 'Unpin beta' })).toBeFocused();
    await expect(namesIn(page, 'Running')).toHaveText(['alpha', 'beta']);
    await expect(row(page, 'beta').locator('.nexus-row-pin')).toBeVisible();
    await expect(row(page, 'alpha').locator('.nexus-row-pin')).toHaveCount(0);
    expect(pinsIn(pinsFile)).toEqual([join(home.projects, 'beta')]);
    expect(errors).toEqual([]);
  });

  test('keeps a pinned folder under Pinned, from one nexus to the next; its card lists it', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache, config, pinsFile } = setUp();
    const first = await startNexus(cache, home.dir, config);
    cleanup.push(() => first.stop());
    await page.goto(`${first.url}#folders:${encodeURIComponent(home.dir)}`);
    await row(page, 'projects').click();
    await expect(card(page).locator('h2')).toHaveText('projects/');
    await card(page).getByRole('button', { name: 'Pin projects' }).click();
    await expect(card(page).getByRole('button', { name: 'Unpin projects' })).toBeVisible();
    expect(pinsIn(pinsFile)).toEqual([home.projects]);

    // Another nexus, the same settings: the pin is there, a folder.
    await first.stop();
    const second = await nexus(cache, home.dir, config);
    await page.goto(second.url);
    await expect(namesIn(page, 'Pinned')).toHaveText(['projects/']);
    await expect(row(page, 'projects')).toContainText('pinned folder');
    await expect(card(page).locator('.status-label')).toHaveText('Pinned folder');
    await expect(card(page).getByRole('group', { name: 'In ~/projects' })).toContainText('alpha');
    // Go in shows its folders in home's tree (decision 929).
    await card(page).getByRole('button', { name: 'Go into projects' }).click();
    await expect(page.getByRole('combobox', { name: 'Find a repository' })).toHaveValue('');
    await expect(namesIn(page, 'Home')).toHaveText(['projects/', 'alpha', 'beta', 'notes/']);
    await expect(card(page).locator('h2')).toHaveText('projects/');

    // Unpinned from its card.
    await page.getByRole('combobox', { name: 'Find a repository' }).fill('');
    await card(page).getByRole('button', { name: 'Unpin projects' }).click();
    // Nothing pinned or known any more: a first run's list, home's tree.
    await expect(page.locator('.nexus-welcome')).toBeVisible();
    await expect(rowNames(page)).toHaveText(['projects/', 'alpha', 'beta', 'notes/']);
    expect(pinsIn(pinsFile)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('keeps a pin whose folder is gone, says so, and unpins it', async ({ page }) => {
    const errors = pageErrors(page);
    const { home, cache, config, pinsFile } = setUp();
    const gone = join(home.projects, 'gone');
    mkdirSync(join(config, 'symbiote'), { recursive: true });
    writeFileSync(
      pinsFile,
      JSON.stringify({ pinned: [join(home.projects, 'notes'), gone, join(home.projects, 'beta')] }),
    );
    const served = await nexus(cache, home.dir, config);
    await page.goto(served.url);
    await expect(namesIn(page, 'Pinned')).toHaveText(['beta', 'gone', 'notes/']);
    await expect(row(page, 'gone')).toContainText('folder gone');

    await row(page, 'gone').click();
    await expect(card(page).locator('.status-label')).toHaveText('Folder gone');
    await expect(card(page)).toContainText('is no longer there');
    await card(page).getByRole('button', { name: 'Unpin gone' }).click();
    await expect(namesIn(page, 'Pinned')).toHaveText(['beta', 'notes/']);
    expect(pinsIn(pinsFile)).toEqual([join(home.projects, 'notes'), join(home.projects, 'beta')]);
    expect(errors).toEqual([]);
  });
});
