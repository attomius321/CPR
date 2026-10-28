import { expect, test, type Page } from '@playwright/test';
import { cacheFolder, repository, startNexus, startView, type Served } from './nexus.js';

// Symbiote nexus (NX1b): real `symbiote view` servers found through their records, as tabs.

/** Every uncaught error of the page, its frames' too (they share its process: one site). */
function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const tabs = (page: Page) => page.locator('.nexus-tabs');
const tab = (page: Page, name: string | RegExp) => tabs(page).getByRole('tab', { name });
const frameOf = (page: Page, name: string) =>
  page.frameLocator(`iframe.nexus-frame[title="${name}"]`);

test.describe('Symbiote nexus', () => {
  const cleanup: (() => unknown)[] = [];
  test.afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  /** A repository served by `symbiote view` on the spec's cache, stopped and removed after. */
  async function symbiote(name: string, cache: string): Promise<Served & { dir: string }> {
    const repo = repository(name);
    cleanup.push(() => repo.remove());
    const served = await startView(repo.dir, cache);
    cleanup.push(() => served.stop());
    return { ...served, dir: repo.dir };
  }

  async function nexus(cache: string): Promise<Served> {
    const served = await startNexus(cache);
    cleanup.push(() => served.stop());
    return served;
  }

  function cacheDir(): string {
    const cache = cacheFolder();
    cleanup.push(() => cache.remove());
    return cache.dir;
  }

  test('lists the running Symbiotes, as tabs; a tab shows its Symbiote in a frame', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const cache = cacheDir();
    const alpha = await symbiote('alpha', cache);
    await symbiote('beta', cache);
    const served = await nexus(cache);
    await page.goto(served.url);

    // Symbiotes: the list, first.
    await expect(page.locator('.nexus-home h1')).toHaveText('Symbiotes');
    await expect(page.locator('.nexus-home .page-line')).toHaveText('2 running on this machine');
    const rows = page.locator('.nexus-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('alpha');
    await expect(rows.nth(0)).toContainText(alpha.dir);
    await expect(rows.nth(0)).toContainText('main');
    await expect(rows.nth(0)).toContainText('no changes');
    await expect(rows.nth(1)).toContainText('beta');
    await expect(tab(page, /^Symbiotes/)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs(page).getByRole('tab')).toHaveText([
      'Symbiotes2',
      'Folders',
      'alphamain',
      'betamain',
    ]);
    await expect(page).toHaveTitle('Symbiote nexus');

    // A Symbiote's tab: its Git page, in a frame of its own.
    await tab(page, /^alpha/).click();
    await expect(frameOf(page, 'alpha').getByText('second', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.nexus-home')).toBeHidden();
    await expect(page).toHaveTitle('alpha · main — Symbiote nexus');
    expect(new URL(page.url()).hash).toBe(`#${encodeURIComponent(alpha.dir)}`);

    // A reload comes back to it.
    await page.reload();
    await expect(tab(page, /^alpha/)).toHaveAttribute('aria-selected', 'true');
    await expect(frameOf(page, 'alpha').getByText('second', { exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('keeps a Symbiote loaded while another is shown, and adds no history of its own', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const cache = cacheDir();
    const alpha = await symbiote('alpha', cache);
    const beta = await symbiote('beta', cache);
    const served = await nexus(cache);
    await page.goto(served.url);
    const length = await page.evaluate(() => history.length);

    await tab(page, /^alpha/).click();
    const alphaFrame = frameOf(page, 'alpha');
    await alphaFrame.getByRole('link', { name: 'Settings' }).click();
    await expect(alphaFrame.locator('h1').first()).toHaveText('Settings');
    const frame = page.frame({ url: (url) => url.href.startsWith(alpha.url) });
    await frame?.evaluate(() => ((window as unknown as { kept: number }).kept = 1));

    await tab(page, /^beta/).click();
    await expect(frameOf(page, 'beta').getByText('second', { exact: true }).first()).toBeVisible();
    await expect(page.locator(`iframe[title="alpha"]`)).toBeHidden();

    await tab(page, /^alpha/).click();
    // The same page, never loaded again: on Settings, with what was left in it.
    await expect(alphaFrame.locator('h1').first()).toHaveText('Settings');
    expect(await frame?.evaluate(() => (window as unknown as { kept?: number }).kept)).toBe(1);
    expect(page.frames().filter((f) => f.url().startsWith(beta.url))).toHaveLength(1);

    // Switching tabs added no entry; Settings, in alpha's frame, added its own.
    expect(await page.evaluate(() => history.length)).toBe(length + 1);
    expect(errors).toEqual([]);
  });

  test('gives a new Symbiote its tab; one that stops is marked, and comes back', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const cache = cacheDir();
    const alpha = await symbiote('alpha', cache);
    const served = await nexus(cache);
    await page.goto(served.url);
    await expect(page.locator('.nexus-row')).toHaveCount(1);

    // Within the 2 s between reads.
    const gamma = await symbiote('gamma', cache);
    await expect(tab(page, /^gamma/)).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.nexus-row')).toHaveCount(2);
    await tab(page, /^gamma/).click();
    await expect(frameOf(page, 'gamma').getByText('second', { exact: true }).first()).toBeVisible();

    // gamma stops: its tab stays, marked, its frame unloaded.
    await gamma.stop();
    await expect(tab(page, /^gamma/)).toHaveText('gammastopped', { timeout: 4000 });
    await expect(page.locator('.nexus-stopped')).toContainText('gamma stopped');
    await expect(page.locator('iframe[title="gamma"]')).toHaveCount(0);
    await expect(page).toHaveTitle('gamma, stopped — Symbiote nexus');

    // Served again (another port): the same tab takes it back.
    const again = await startView(gamma.dir, cache);
    cleanup.push(() => again.stop());
    await expect(tab(page, /^gamma/)).toHaveText('gammamain', { timeout: 4000 });
    await expect(frameOf(page, 'gamma').getByText('second', { exact: true }).first()).toBeVisible();
    await expect(page.locator('iframe[title="gamma"]')).toHaveAttribute('src', again.url);

    // alpha, never opened, stops: its tab just leaves.
    await alpha.stop();
    await expect(tab(page, /^alpha/)).toHaveCount(0, { timeout: 4000 });

    // A stopped tab closes.
    await again.stop();
    await expect(tab(page, /^gamma/)).toHaveText('gammastopped', { timeout: 4000 });
    await page.locator('.nexus-stopped').getByRole('button', { name: 'Close tab' }).click();
    await expect(tab(page, /^gamma/)).toHaveCount(0);
    await expect(page.locator('.nexus-home .page-line')).toHaveText('None running on this machine');
    await expect(page.locator('.nexus-empty-title')).toHaveText('No Symbiote is running');
    expect(new URL(page.url()).hash).toBe('');
    expect(errors).toEqual([]);
  });

  test('says when none is running, and how to start one', async ({ page }) => {
    const served = await nexus(cacheDir());
    await page.goto(served.url);
    await expect(page.locator('.nexus-home .page-line')).toHaveText('None running on this machine');
    await expect(page.locator('.nexus-empty')).toContainText(
      'Open one on a repository in Folders, or start one with symbiote view in a repository: ' +
        'it shows here within 2 seconds.',
    );
    await expect(tabs(page).getByRole('tab')).toHaveText(['Symbiotes0', 'Folders']);
    await page.getByRole('button', { name: 'Open a folder' }).click();
    await expect(tab(page, 'Folders')).toHaveAttribute('aria-selected', 'true');
  });

  test('a framed Symbiote writes, and uses the clipboard, as in a tab of its own', async ({
    page,
    context,
  }) => {
    const errors = pageErrors(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const cache = cacheDir();
    await symbiote('alpha', cache);
    const served = await nexus(cache);
    await page.goto(served.url);
    await tab(page, /^alpha/).click();
    const alpha = frameOf(page, 'alpha');

    // Copy SHA: the frame may write the clipboard (its `allow`).
    await alpha.getByText('second', { exact: true }).first().click();
    await alpha.getByRole('button', { name: 'Copy SHA' }).click();
    await expect(alpha.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^[0-9a-f]{40}$/);

    // Review this commit: a POST from the frame, past the server's own-origin check.
    await alpha.getByRole('button', { name: 'Review this commit' }).click();
    await expect(alpha.getByText('src/a.ts').first()).toBeVisible({ timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test('moves between tabs with the arrow keys', async ({ page }) => {
    const cache = cacheDir();
    await symbiote('alpha', cache);
    await symbiote('beta', cache);
    const served = await nexus(cache);
    await page.goto(served.url);
    await expect(tabs(page).getByRole('tab')).toHaveCount(4);
    await tab(page, /^Symbiotes/).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Folders')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, /^alpha/)).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, /^alpha/)).toBeFocused();
    await page.keyboard.press('End');
    await expect(tab(page, /^beta/)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, /^Symbiotes/)).toHaveAttribute('aria-selected', 'true');
  });
});
