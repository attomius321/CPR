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

// This PC's folders (NX2): a Symbiote opened in one, stopped and started again, with real
// `symbiote view`s started by the nexus, on a home and a cache of the spec's own. Since NX5 a
// folder is typed in the list's field (decision 910): its repositories (the end of the way down,
// decision 554) and folders are rows, the picked one's card opens it. Its keys and the address
// kept by a reload are list.spec.ts's.

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const tab = (page: Page, name: string | RegExp) =>
  page.locator('.nexus-tabs').getByRole('tab', { name });
const frameOf = (page: Page, name: string) =>
  page.frameLocator(`iframe.nexus-frame[title="${name}"]`);
const field = (page: Page) => page.getByRole('combobox', { name: 'Find a repository' });
const list = (page: Page) => page.getByRole('listbox', { name: 'Repositories' });
const rowNames = (page: Page) => list(page).locator('.nexus-row-name');
const row = (page: Page, name: string) =>
  list(page)
    .getByRole('option')
    .filter({ has: page.locator('.nexus-row-name', { hasText: new RegExp(`^${name}/?$`) }) });
const card = (page: Page) => page.locator('.nexus-detail');

/** Picks a repository listed, then opens its Symbiote from its card. */
async function openIn(page: Page, name: string): Promise<void> {
  await row(page, name).click();
  await expect(card(page).locator('h2')).toHaveText(name);
  await card(page).getByRole('button', { name: 'Open Symbiote' }).click();
}

test.describe('Symbiote nexus: folders', () => {
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

  test('lists a folder typed, the repositories marked, and opens a Symbiote in one', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache } = setUp();
    const served = await nexus(cache, home.dir);
    await page.goto(served.url);

    // No Symbiote runs, nothing known: home's folders.
    await expect(page.locator('.nexus-home h1')).toHaveText('Symbiotes');
    await expect(rowNames(page)).toHaveText(['projects/']);
    await field(page).fill('~/projects/');
    // The repositories marked, what they have checked out; the folders as rows too.
    await expect(rowNames(page)).toHaveText(['alpha', 'beta', 'notes/']);
    await expect(row(page, 'alpha')).toContainText('main');
    await expect(row(page, 'notes')).toContainText('folder');
    expect(new URL(page.url()).hash).toBe(`#folders:${encodeURIComponent(home.projects)}`);
    await expect(page).toHaveTitle('Symbiote nexus');

    // A repository is the end of the way down (decision 554): typing into one lists its holder.
    await field(page).fill('~/projects/alpha/');
    await expect(rowNames(page)).toHaveText(['alpha', 'beta', 'notes/']);
    await expect(card(page).locator('h2')).toHaveText('alpha');

    // Opened from its card: its tab, its frame; one Symbiote recorded.
    await card(page).getByRole('button', { name: 'Open Symbiote' }).click();
    await expect(tab(page, /^alpha/)).toHaveAttribute('aria-selected', 'true');
    await expect(frameOf(page, 'alpha').locator('.overview')).toBeVisible();
    expect(recorded(cache)).toHaveLength(1);

    // Back on Symbiotes: alpha runs; its card shows its tab.
    await tab(page, /^Symbiotes/).click();
    await expect(field(page)).toHaveValue('');
    await expect(card(page).locator('h2')).toHaveText('alpha');
    await expect(card(page).locator('.status-label')).toHaveText('Running');
    await card(page).getByRole('button', { name: 'Show alpha' }).click();
    await expect(tab(page, /^alpha/)).toHaveAttribute('aria-selected', 'true');
    expect(recorded(cache)).toHaveLength(1);

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

  test('says why a Symbiote did not open', async ({ page }) => {
    const errors = pageErrors(page);
    const { home, cache } = setUp();
    // Marked a repository (its `.git`), which git does not take for one.
    mkdirSync(join(home.projects, 'broken', '.git'), { recursive: true });
    const served = await nexus(cache, home.dir);
    await page.goto(`${served.url}#folders:${encodeURIComponent(home.projects)}`);
    await openIn(page, 'broken');
    await expect(card(page).locator('.status-label')).toHaveText('Did not open');
    await expect(card(page).locator('.nexus-notice.error')).toHaveText(
      `broken did not open: symbiote: not inside a git working tree: ${join(home.projects, 'broken')}`,
    );
    await expect(card(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(tab(page, /^Symbiotes/)).toHaveAttribute('aria-selected', 'true');
    expect(recorded(cache)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('stops a Symbiote after a question, and starts it again', async ({ page }) => {
    const errors = pageErrors(page);
    const { home, cache } = setUp();
    const served = await nexus(cache, home.dir);
    await page.goto(`${served.url}#folders:${encodeURIComponent(home.projects)}`);
    await openIn(page, 'alpha');
    await expect(frameOf(page, 'alpha').locator('.overview')).toBeVisible();

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
    await expect(page.locator('.nexus-home .page-line')).toHaveText(
      'None running · 2 repositories in home',
    );

    await tab(page, /^alpha/).click();
    await expect(page.locator('.nexus-stopped')).toContainText('alpha stopped');
    await page.getByRole('button', { name: 'Start again' }).click();
    await expect(tab(page, /^alpha/)).toHaveText('alphamain');
    await expect(frameOf(page, 'alpha').locator('.overview')).toBeVisible();
    expect(recorded(cache)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('frames a Symbiote once this browser reaches it, as WSL forwards a new port late', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const { home, cache } = setUp();
    const served = await nexus(cache, home.dir);
    // A browser on Windows reaches a WSL port only once WSL forwards it, 18–858 ms after the
    // Symbiote listens (fix/first-time-symbiote-from-nexus): each Symbiote's address is refused
    // here for a second from the first request to it.
    const own = new URL(served.url).origin;
    const firstAsked = new Map<string, number>();
    await page.route(/^http:\/\/127\.0\.0\.1:\d+\//, (route) => {
      const { origin } = new URL(route.request().url());
      if (origin === own) return route.continue();
      const since = firstAsked.get(origin) ?? Date.now();
      firstAsked.set(origin, since);
      return Date.now() - since < 1000 ? route.abort('connectionrefused') : route.continue();
    });
    await page.goto(`${served.url}#folders:${encodeURIComponent(home.projects)}`);
    await openIn(page, 'alpha');
    await expect(frameOf(page, 'alpha').locator('.overview')).toBeVisible();

    // Started again, on another port: framed once that one answers too.
    await tab(page, /^Symbiotes/).click();
    await page.getByRole('button', { name: 'Stop alpha' }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await tab(page, /^alpha/).click();
    await page.getByRole('button', { name: 'Start again' }).click();
    await expect(frameOf(page, 'alpha').locator('.overview')).toBeVisible();
    expect(firstAsked.size).toBe(2);
    expect(errors).toEqual([]);
  });

  test('a Symbiote started from the nexus serves on after the nexus stops', async ({ page }) => {
    const { home, cache } = setUp();
    const first = await startNexus(cache, home.dir);
    await page.goto(`${first.url}#folders:${encodeURIComponent(home.projects)}`);
    await openIn(page, 'beta');
    await expect(frameOf(page, 'beta').locator('.overview')).toBeVisible();
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
