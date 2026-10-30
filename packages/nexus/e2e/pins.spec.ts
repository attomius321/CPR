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

// Pins (NX4, decisions 617–620), on one page since fix/nexus-pinned-symbiotes (626–628): a pinned
// repository is a card among the Symbiotes, first, running or not; a pinned folder is a place. Kept
// in the settings folder from one nexus to the next; nothing starts but by the person. Real
// `symbiote view`s, on a home, a cache and a settings folder of the spec's own.

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
/** The Symbiotes' cards, and their names in order. */
const symbiotes = (page: Page) => page.locator('.nexus-symbiotes .nexus-symbiote');
const symbioteNames = (page: Page) => symbiotes(page).locator('.nexus-symbiote-name');
const symbiote = (page: Page, name: string) =>
  symbiotes(page).filter({
    has: page.locator('.nexus-symbiote-name', { hasText: new RegExp(`^${name}$`) }),
  });
/** A repository's card in the folder listed. */
const card = (page: Page, name: string) =>
  page
    .locator('.nexus-folders .nexus-repo')
    .filter({ has: page.locator('.nexus-repo-name', { hasText: name }) });
/** The pins' rows under the places, and the places the nexus found. */
const pinRows = (page: Page) => page.locator('.nexus-pins .nexus-place');
const pinRow = (page: Page, name: string) => pinRows(page).filter({ hasText: name });
const placeRows = (page: Page) =>
  page.getByRole('group', { name: 'Places' }).locator('.nexus-place');

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

  test('shows a pinned repository among the Symbiotes, kept from one nexus to the next, started only by the person', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache, config, pinsFile } = setUp();
    const first = await startNexus(cache, home.dir, config);
    cleanup.push(() => first.stop());
    // An old Folders address: Symbiotes, that folder listed under them (decision 626).
    await page.goto(`${first.url}#folders:${encodeURIComponent(home.projects)}`);
    await expect(shown(page)).toHaveText('projects');
    await expect(tab(page, /^Symbiotes/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.nexus-tabs').getByRole('tab')).toHaveText(['Symbiotes0']);
    await expect(page.locator('.nexus-pins')).toHaveText(
      'PinnedPin a folder from its head, a repository from its card.',
    );

    // Pinned from its card in the folder listed: a card among the Symbiotes, not running.
    const pinAlpha = page.locator('.nexus-folders').getByRole('button', { name: 'Pin alpha' });
    await expect(pinAlpha).toHaveCSS('opacity', '0');
    await card(page, 'alpha').hover();
    await expect(pinAlpha).toHaveCSS('opacity', '1');
    await pinAlpha.click();
    await expect(symbioteNames(page)).toHaveText(['alpha']);
    await expect(symbiote(page, 'alpha')).toContainText(join(home.projects, 'alpha'));
    await expect(symbiote(page, 'alpha').locator('.nexus-symbiote-meta')).toHaveText(
      'mainOpen Symbiote',
    );
    await expect(symbiote(page, 'alpha').locator('.state-dot.tone-idle')).toBeVisible();
    await expect(page.locator('.nexus-home .page-line')).toHaveText('None running on this machine');
    await expect(page.locator('.nexus-empty')).toHaveCount(0);
    // A repository pinned is a Symbiote, not a place (decision 628).
    await expect(page.locator('.nexus-pins')).toBeHidden();
    expect(pinsIn(pinsFile)).toEqual([join(home.projects, 'alpha')]);
    await page.waitForTimeout(500);
    expect(recorded(cache)).toEqual([]);

    // Another nexus, the same settings: the card is there, and still nothing runs.
    await first.stop();
    const second = await nexus(cache, home.dir, config);
    await page.goto(second.url);
    await expect(symbioteNames(page)).toHaveText(['alpha']);
    await page.waitForTimeout(500);
    expect(recorded(cache)).toEqual([]);

    // The person's start: its card. Its tab, then back on Symbiotes the running card, pinned.
    await symbiote(page, 'alpha').getByRole('button', { name: 'Open Symbiote in alpha' }).click();
    await expect(tab(page, /^alpha/)).toHaveAttribute('aria-selected', 'true');
    await expect(frameOf(page, 'alpha').locator('.commit').first()).toBeVisible();
    expect(recorded(cache)).toHaveLength(1);
    await tab(page, /^Symbiotes/).click();
    await expect(symbioteNames(page)).toHaveText(['alpha']);
    await expect(symbiote(page, 'alpha').locator('.state-dot.nexus-live')).toBeVisible();
    await expect(symbiote(page, 'alpha')).toContainText('no changes');
    const unpinAlpha = symbiote(page, 'alpha').getByRole('button', { name: 'Unpin alpha' });
    await page.mouse.move(0, 0);
    await expect(unpinAlpha).toHaveClass(/\bnexus-pinned\b/);
    await expect(unpinAlpha).toHaveCSS('opacity', '1');

    // Stopped: a pinned card again, not running.
    await symbiote(page, 'alpha').getByRole('button', { name: 'Stop alpha' }).click();
    await page
      .getByRole('alertdialog', { name: 'Stop alpha?' })
      .getByRole('button', { name: 'Stop', exact: true })
      .click();
    await expect(symbiote(page, 'alpha').locator('.nexus-symbiote-meta')).toHaveText(
      'mainOpen Symbiote',
    );
    expect(recorded(cache)).toEqual([]);

    // Unpinned from its corner: it leaves the Symbiotes.
    await symbiote(page, 'alpha').getByRole('button', { name: 'Unpin alpha' }).click();
    await expect(symbiotes(page)).toHaveCount(0);
    await expect(page.locator('.nexus-empty-title')).toHaveText('No Symbiote is running');
    expect(pinsIn(pinsFile)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('pins a running Symbiote from its card: it goes first, the others by name', async ({
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
    await expect(symbioteNames(page)).toHaveText(['alpha', 'beta']);

    // Its pin shows on the card's hover, and stays once pinned.
    const pinBeta = symbiote(page, 'beta').getByRole('button', { name: 'Pin beta' });
    await expect(pinBeta).toHaveCSS('opacity', '0');
    await symbiote(page, 'beta').hover();
    await expect(pinBeta).toHaveCSS('opacity', '1');
    await pinBeta.click();
    await expect(symbioteNames(page)).toHaveText(['beta', 'alpha']);
    await expect(symbiote(page, 'beta').getByRole('button', { name: 'Unpin beta' })).toBeFocused();
    expect(pinsIn(pinsFile)).toEqual([join(home.projects, 'beta')]);
    // The folder listed, the one they are in, has it pinned too.
    await expect(shown(page)).toHaveText('projects');
    await expect(
      page.locator('.nexus-folders').getByRole('button', { name: 'Unpin beta' }),
    ).toHaveClass(/\bnexus-pinned\b/);
    expect(errors).toEqual([]);
  });

  test('keeps a pinned folder under the places, from one nexus to the next, and unpins it', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache, config, pinsFile } = setUp();
    const first = await startNexus(cache, home.dir, config);
    cleanup.push(() => first.stop());
    await page.goto(`${first.url}#folders:${encodeURIComponent(home.projects)}`);
    await expect(shown(page)).toHaveText('projects');

    await page.getByRole('button', { name: 'Pin projects' }).click();
    await expect(pinRows(page)).toHaveText(['projects']);
    await expect(page.locator('.nexus-pins .nexus-group-head')).toHaveText('Pinned1');
    await expect(pinRow(page, 'projects')).toHaveAttribute('aria-current', 'true');
    // A folder is no Symbiote: none among them.
    await expect(symbiotes(page)).toHaveCount(0);
    expect(pinsIn(pinsFile)).toEqual([home.projects]);

    // Home, the top and the drives are always places: no pin in their head.
    await placeRows(page).filter({ hasText: 'Home' }).click();
    await expect(shown(page)).toHaveText('Home');
    await expect(page.locator('.nexus-head-pin')).toHaveCount(0);
    // A pin's click lists it.
    await pinRow(page, 'projects').click();
    await expect(shown(page)).toHaveText('projects');

    // Another nexus, the same settings: the pin is there.
    await first.stop();
    const second = await nexus(cache, home.dir, config);
    await page.goto(second.url);
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

  test('keeps a pin whose folder is gone, says so under the places, and unpins it', async ({
    page,
  }) => {
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
    await expect(pinRows(page)).toHaveText(['notes', 'gonenot found']);
    await expect(symbioteNames(page)).toHaveText(['beta']);

    await pinRow(page, 'gone').click();
    await expect(page.locator('.nexus-folders-error')).toHaveText(`No such folder: ${gone}`);
    await expect(shown(page)).toHaveText('Home');
    await pinRow(page, 'gone').hover();
    await page.locator('.nexus-pins').getByRole('button', { name: 'Unpin gone' }).click();
    await expect(pinRows(page)).toHaveText(['notes']);
    // The focus moves to the next pin's row: here the one before it, the last.
    await expect(pinRow(page, 'notes')).toBeFocused();
    expect(pinsIn(pinsFile)).toEqual([join(home.projects, 'notes'), join(home.projects, 'beta')]);
    expect(errors).toEqual([]);
  });
});
