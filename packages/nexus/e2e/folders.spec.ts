import { mkdirSync } from 'node:fs';
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

// The Folders tab (NX2): this PC's folders, a Symbiote opened in one, stopped and started again,
// with real `symbiote view`s started by the nexus, on a home and a cache of the spec's own.

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const tab = (page: Page, name: string | RegExp) =>
  page.locator('.nexus-tabs').getByRole('tab', { name });
const frameOf = (page: Page, name: string) =>
  page.frameLocator(`iframe.nexus-frame[title="${name}"]`);
const rows = (page: Page) => page.locator('.nexus-folder');
const row = (page: Page, name: string) =>
  page.locator('.nexus-folder', { has: page.locator('.nexus-folder-name', { hasText: name }) });
const shown = (page: Page) => page.locator('.nexus-crumbs [aria-current="page"]');

test.describe('Symbiote nexus: Folders', () => {
  const cleanup: (() => unknown)[] = [];
  test.afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  /** A home with `projects/` (alpha and beta, repositories; notes, a folder) and a cache. */
  function setUp() {
    const home = homeFolder(['alpha', 'beta'], ['notes']);
    const cache = cacheFolder();
    cleanup.push(
      () => home.remove(),
      () => cache.remove(),
      () => stopRecorded(cache.dir),
    );
    return { home, cache: cache.dir };
  }

  async function nexus(cache: string, home: string): Promise<Served> {
    const served = await startNexus(cache, home);
    cleanup.push(() => served.stop());
    return served;
  }

  test("lists this PC's folders, the repositories marked, and opens a Symbiote in one", async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache } = setUp();
    const served = await nexus(cache, home.dir);
    await page.goto(served.url);
    await tab(page, 'Folders').click();

    // No Symbiote runs: home.
    await expect(page.locator('.nexus-folders h1')).toHaveText('Folders');
    await expect(shown(page)).toHaveText('Home');
    await expect(rows(page)).toHaveText(['projects']);
    await expect(page.locator('.nexus-place').first()).toHaveText('Home');
    await expect(page.locator('.nexus-place', { hasText: /^\/$/ })).toHaveCount(1);

    await row(page, 'projects').locator('.nexus-folder-open').click();
    await expect(shown(page)).toHaveText('projects');
    await expect(page.locator('.nexus-crumbs')).toHaveText('Home/projects');
    await expect(rows(page)).toHaveText([
      'alpharepositoryOpen Symbiote',
      'betarepositoryOpen Symbiote',
      'notes',
    ]);
    expect(new URL(page.url()).hash).toBe(`#folders:${encodeURIComponent(home.projects)}`);
    await expect(page).toHaveTitle('Folders — Symbiote nexus');

    // Open Symbiote: its tab, its Git page in a frame.
    await page.getByRole('button', { name: 'Open Symbiote in alpha' }).click();
    await expect(tab(page, /^alpha/)).toHaveAttribute('aria-selected', 'true');
    await expect(frameOf(page, 'alpha').locator('.commit').first()).toBeVisible();
    expect(recorded(cache)).toHaveLength(1);

    // Back in Folders, where it was: alpha runs; Show opens its tab.
    await tab(page, 'Folders').click();
    await expect(shown(page)).toHaveText('projects');
    await expect(row(page, 'alpha')).toHaveText('alpharepositoryrunningShow');
    await row(page, 'alpha').getByRole('button', { name: 'Show' }).click();
    await expect(tab(page, /^alpha/)).toHaveAttribute('aria-selected', 'true');

    // Opened again (a folder inside it, as a second click or another window would): no second one.
    const again = await page.evaluate(
      async (folder) => {
        const res = await fetch('/api/symbiotes', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
          body: JSON.stringify({ folder }),
        });
        return (await res.json()) as { symbiote: { root: string } };
      },
      join(home.projects, 'alpha', 'src'),
    );
    expect(again.symbiote.root).toBe(join(home.projects, 'alpha'));
    expect(recorded(cache)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('moves by the keys, the places and the field; a reload keeps the folder', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache } = setUp();
    const served = await nexus(cache, home.dir);
    await page.goto(`${served.url}#folders:${encodeURIComponent(home.projects)}`);
    await expect(shown(page)).toHaveText('projects');

    // ↓ and ↑ between rows, Enter opens a folder, Backspace goes up.
    await row(page, 'alpha').locator('.nexus-folder-open').focus();
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'beta').locator('.nexus-folder-open')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(shown(page)).toHaveText('beta');
    await expect(rows(page)).toHaveText(['src']);
    // Inside a repository: its Symbiote from the card's head.
    await page.keyboard.press('Enter');
    await expect(shown(page)).toHaveText('src');
    await expect(page.locator('.nexus-folders-actions')).toHaveText('In betaOpen Symbiote');
    await expect(page.locator('.nexus-folders-none')).toHaveText('No folders here');
    await page.keyboard.press('Backspace');
    await expect(shown(page)).toHaveText('beta');
    await page.getByRole('button', { name: 'Up a folder' }).click();
    await expect(shown(page)).toHaveText('projects');

    // The places, and a typed folder.
    await page.locator('.nexus-place', { hasText: 'Home' }).click();
    await expect(shown(page)).toHaveText('Home');
    const field = page.getByRole('textbox', { name: 'Go to folder' });
    await field.fill('~/projects/notes');
    await field.press('Enter');
    await expect(shown(page)).toHaveText('notes');
    await field.fill('~/nowhere');
    await field.press('Enter');
    await expect(page.locator('.nexus-folders-error')).toHaveText(
      `No such folder: ${join(home.dir, 'nowhere')}`,
    );
    await expect(shown(page)).toHaveText('notes');
    await field.fill('projects');
    await field.press('Enter');
    await expect(page.locator('.nexus-folders-error')).toHaveText('Type a full path: /… or ~/…');

    await page.reload();
    await expect(tab(page, 'Folders')).toHaveAttribute('aria-selected', 'true');
    await expect(shown(page)).toHaveText('notes');
    expect(errors).toEqual([]);
  });

  test('says why a Symbiote did not open', async ({ page }) => {
    const errors = pageErrors(page);
    const { home, cache } = setUp();
    // Marked a repository (its `.git`), which git does not take for one.
    mkdirSync(join(home.projects, 'broken', '.git'), { recursive: true });
    const served = await nexus(cache, home.dir);
    await page.goto(`${served.url}#folders:${encodeURIComponent(home.projects)}`);
    await page.getByRole('button', { name: 'Open Symbiote in broken' }).click();
    await expect(page.locator('.nexus-folders-error')).toHaveText(
      `broken did not open: symbiote: not inside a git working tree: ${join(home.projects, 'broken')}`,
    );
    await expect(tab(page, 'Folders')).toHaveAttribute('aria-selected', 'true');
    expect(recorded(cache)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('stops a Symbiote after a question, and starts it again', async ({ page }) => {
    const errors = pageErrors(page);
    const { home, cache } = setUp();
    const served = await nexus(cache, home.dir);
    await page.goto(`${served.url}#folders:${encodeURIComponent(home.projects)}`);
    await page.getByRole('button', { name: 'Open Symbiote in alpha' }).click();
    await expect(frameOf(page, 'alpha').locator('.commit').first()).toBeVisible();

    await tab(page, /^Symbiotes/).click();
    const stop = page.getByRole('button', { name: 'Stop alpha' });
    await stop.click();
    const question = page.getByRole('alertdialog', { name: 'Stop alpha?' });
    await expect(question).toBeVisible();
    // Staying is the default: Escape keeps it.
    await expect(question.getByRole('button', { name: 'Keep it running' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(question).toHaveCount(0);
    await expect(stop).toBeFocused();
    expect(recorded(cache)).toHaveLength(1);

    await stop.click();
    await question.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(tab(page, /^alpha/)).toHaveText('alphastopped');
    expect(recorded(cache)).toEqual([]);
    await expect(page.locator('.nexus-home .page-line')).toHaveText('None running on this machine');

    await tab(page, /^alpha/).click();
    await expect(page.locator('.nexus-stopped')).toContainText('alpha stopped');
    await page.getByRole('button', { name: 'Start again' }).click();
    await expect(tab(page, /^alpha/)).toHaveText('alphamain');
    await expect(frameOf(page, 'alpha').locator('.commit').first()).toBeVisible();
    expect(recorded(cache)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('a Symbiote started from the nexus serves on after the nexus stops', async ({ page }) => {
    const { home, cache } = setUp();
    const first = await startNexus(cache, home.dir);
    await page.goto(`${first.url}#folders:${encodeURIComponent(home.projects)}`);
    await page.getByRole('button', { name: 'Open Symbiote in beta' }).click();
    await expect(frameOf(page, 'beta').locator('.commit').first()).toBeVisible();
    const url = await page.locator('iframe[title="beta"]').getAttribute('src');
    await first.stop();

    const status = await fetch(new URL('api/status', url ?? ''));
    expect(status.status).toBe(200);
    // A nexus opened later finds it.
    const second = await nexus(cache, home.dir);
    await page.goto(second.url);
    await expect(tab(page, /^beta/)).toHaveText('betamain');
  });
});
