import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  cacheFolder,
  homeFolder,
  recorded,
  startNexus,
  stopRecorded,
  type Served,
} from './nexus.js';

// Pinned folders (NX4, decisions 617–620): pinned in Folders from the folder's head or a
// repository's card, kept in the settings folder from one nexus to the next, shown under the
// places; a pin's click shows it and starts nothing. Real `symbiote view`s, on a home, a cache and
// a settings folder of the spec's own.

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const tab = (page: Page, name: string | RegExp) =>
  page.locator('.nexus-tabs').getByRole('tab', { name });
const frameOf = (page: Page, name: string) =>
  page.frameLocator(`iframe.nexus-frame[title="${name}"]`);
const shown = (page: Page) => page.locator('.nexus-crumbs [aria-current="page"]');
const card = (page: Page, name: string) =>
  page
    .locator('.nexus-folders .nexus-repo')
    .filter({ has: page.locator('.nexus-repo-name', { hasText: name }) });
/** The pins' rows, and the places the nexus found. */
const pinRows = (page: Page) => page.locator('.nexus-pins .nexus-place');
const pinRow = (page: Page, name: string) => pinRows(page).filter({ hasText: name });
const placeRows = (page: Page) =>
  page.getByRole('group', { name: 'Places' }).locator('.nexus-place');

test.describe('Symbiote nexus: pinned folders', () => {
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

  test('pins a folder from its head, keeps it from one nexus to the next, and unpins it', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache, config, pinsFile } = setUp();
    const first = await startNexus(cache, home.dir, config);
    cleanup.push(() => first.stop());
    await page.goto(`${first.url}#folders:${encodeURIComponent(home.projects)}`);
    await expect(shown(page)).toHaveText('projects');
    await expect(page.locator('.nexus-pins')).toHaveText(
      'PinnedPin a folder from its head, a repository from its card.',
    );

    await page.getByRole('button', { name: 'Pin projects' }).click();
    await expect(pinRows(page)).toHaveText(['projects']);
    await expect(page.locator('.nexus-pins .nexus-group-head')).toHaveText('Pinned1');
    await expect(page.getByRole('button', { name: 'Unpin projects' }).first()).toHaveClass(
      /\bnexus-pinned\b/,
    );
    await expect(pinRow(page, 'projects')).toHaveAttribute('aria-current', 'true');
    expect(pinsIn(pinsFile)).toEqual([home.projects]);

    // Home, the top and the drives are always places: no pin in their head.
    await placeRows(page).filter({ hasText: 'Home' }).click();
    await expect(shown(page)).toHaveText('Home');
    await expect(page.locator('.nexus-head-pin')).toHaveCount(0);
    await expect(pinRow(page, 'projects')).not.toHaveAttribute('aria-current', 'true');
    // A pin's click lists it.
    await pinRow(page, 'projects').click();
    await expect(shown(page)).toHaveText('projects');

    // Another nexus, the same settings: the pin is there.
    await first.stop();
    const second = await nexus(cache, home.dir, config);
    await page.goto(`${second.url}#folders`);
    await expect(shown(page)).toHaveText('Home');
    await expect(pinRows(page)).toHaveText(['projects']);

    // Unpinned from its row: its unpin shows on hover.
    const unpin = page.locator('.nexus-pins').getByRole('button', { name: 'Unpin projects' });
    await expect(unpin).toHaveCSS('opacity', '0');
    await pinRow(page, 'projects').hover();
    await expect(unpin).toHaveCSS('opacity', '1');
    await unpin.click();
    await expect(pinRows(page)).toHaveCount(0);
    await expect(page.locator('.nexus-pins-none')).toBeVisible();
    // The focus stays in the places.
    await expect(placeRows(page).first()).toBeFocused();
    expect(pinsIn(pinsFile)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('pins a repository from its card: its pin shows it, starts nothing, and says it runs once it does', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache, config, pinsFile } = setUp();
    const served = await nexus(cache, home.dir, config);
    await page.goto(`${served.url}#folders:${encodeURIComponent(home.projects)}`);
    await expect(shown(page)).toHaveText('projects');

    // A card's pin shows on its hover, and stays once pinned.
    const pinAlpha = page.getByRole('button', { name: 'Pin alpha' });
    await expect(pinAlpha).toHaveCSS('opacity', '0');
    await card(page, 'alpha').hover();
    await expect(pinAlpha).toHaveCSS('opacity', '1');
    await pinAlpha.click();
    await expect(pinRows(page)).toHaveText(['alpha']);
    await page.mouse.move(0, 0);
    await expect(
      page.locator('.nexus-folders-card').getByRole('button', { name: 'Unpin alpha' }),
    ).toHaveCSS('opacity', '1');
    await expect(page.getByRole('button', { name: 'Pin beta' })).toHaveCSS('opacity', '0');
    // The card is one button still, and opens nothing by its pin.
    expect(recorded(cache)).toEqual([]);

    // Its pin's click shows it in the folder holding it, picked; nothing starts (decision 619).
    await placeRows(page).filter({ hasText: 'Home' }).click();
    await expect(shown(page)).toHaveText('Home');
    await pinRow(page, 'alpha').click();
    await expect(shown(page)).toHaveText('projects');
    await expect(card(page, 'alpha')).toHaveClass(/\bpicked\b/);
    await expect(card(page, 'alpha')).toBeFocused();
    await expect(pinRow(page, 'alpha')).toHaveAttribute('aria-current', 'true');
    await page.waitForTimeout(500);
    expect(recorded(cache)).toEqual([]);

    // The person's start: Enter on the picked card. Its pin then has the running dot.
    await page.keyboard.press('Enter');
    await expect(tab(page, /^alpha/)).toHaveAttribute('aria-selected', 'true');
    await expect(frameOf(page, 'alpha').locator('.commit').first()).toBeVisible();
    expect(recorded(cache)).toHaveLength(1);
    await tab(page, 'Folders').click();
    await expect(pinRow(page, 'alpha').getByRole('img', { name: 'running' })).toBeVisible();

    // alpha runs: projects is a place (read with the next listing); pinned, it is drawn once, as
    // the pin.
    const projectsPlace = placeRows(page).filter({ hasText: /^projects$/ });
    await pinRow(page, 'alpha').click();
    await expect(projectsPlace).toHaveCount(1);
    await page.getByRole('button', { name: 'Pin projects' }).click();
    await expect(pinRows(page)).toHaveText(['alpha', 'projects']);
    await expect(projectsPlace).toHaveCount(0);
    expect(pinsIn(pinsFile)).toEqual([join(home.projects, 'alpha'), home.projects]);
    expect(errors).toEqual([]);
  });

  test('keeps a pin whose folder is gone, says so, and unpins it', async ({ page }) => {
    const errors = pageErrors(page);
    const { home, cache, config, pinsFile } = setUp();
    const gone = join(home.projects, 'gone');
    mkdirSync(join(config, 'symbiote'), { recursive: true });
    writeFileSync(pinsFile, JSON.stringify({ pinned: [join(home.projects, 'notes'), gone] }));
    const served = await nexus(cache, home.dir, config);
    await page.goto(`${served.url}#folders`);
    await expect(pinRows(page)).toHaveText(['notes', 'gonenot found']);

    await pinRow(page, 'gone').click();
    await expect(page.locator('.nexus-folders-error')).toHaveText(`No such folder: ${gone}`);
    await expect(shown(page)).toHaveText('Home');
    await pinRow(page, 'gone').hover();
    await page.locator('.nexus-pins').getByRole('button', { name: 'Unpin gone' }).click();
    await expect(pinRows(page)).toHaveText(['notes']);
    // The focus moves to the next pin's row: here the one before it, the last.
    await expect(pinRow(page, 'notes')).toBeFocused();
    expect(pinsIn(pinsFile)).toEqual([join(home.projects, 'notes')]);
    expect(errors).toEqual([]);
  });
});
