import { expect, test, type Page } from '@playwright/test';
import {
  cacheFolder,
  homeFolder,
  repository,
  startNexus,
  startView,
  stopRecorded,
  type Served,
} from './nexus.js';

// Symbiote nexus (NX1b): real `symbiote view` servers found through their records, as tabs. Since
// NX3 the row's two groups and Symbiotes' cards; since fix/nexus-pinned-symbiotes (decision 626)
// the folders under them, on the one page of the nexus's own.

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

  async function nexus(cache: string, home?: string): Promise<Served> {
    const served = await startNexus(cache, home);
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
    await expect(page.locator('.nexus-home .page-line')).toHaveText(
      '2 running · 0 repositories in home',
    );
    const rows = page.getByRole('listbox', { name: 'Repositories' }).getByRole('option');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('alpha');
    await expect(rows.nth(0)).toContainText(alpha.dir);
    await expect(rows.nth(0)).toContainText('main');
    await expect(rows.nth(0)).toContainText('no changes');
    await expect(rows.nth(1)).toContainText('beta');
    await expect(tab(page, /^Symbiotes/)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs(page).getByRole('tab')).toHaveText(['Symbiotes2', 'alphamain', 'betamain']);
    // The nexus's own page, with its icon, then a line, then the Symbiotes with their dots (NX3).
    await expect(page.locator('.nexus-own').getByRole('tab')).toHaveText(['Symbiotes2']);
    await expect(page.locator('.nexus-own > .views-divider')).toBeVisible();
    await expect(page.locator('.nexus-own .icon')).toHaveCount(1);
    await expect(tab(page, /^alpha/).locator('.state-dot.nexus-live')).toBeVisible();
    await expect(page).toHaveTitle('Symbiote nexus');

    // A Symbiote's tab: its Git page, in a frame of its own.
    await tab(page, /^alpha/).click();
    await expect(frameOf(page, 'alpha').locator('.overview')).toBeVisible();
    await expect(page.locator('.nexus-home')).toBeHidden();
    await expect(page).toHaveTitle('alpha · main — Symbiote nexus');
    expect(new URL(page.url()).hash).toBe(`#${encodeURIComponent(alpha.dir)}`);

    // A reload comes back to it.
    await page.reload();
    await expect(tab(page, /^alpha/)).toHaveAttribute('aria-selected', 'true');
    await expect(frameOf(page, 'alpha').locator('.overview')).toBeVisible();
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
    await expect(frameOf(page, 'beta').locator('.overview')).toBeVisible();
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
    const running = page
      .getByRole('listbox', { name: 'Repositories' })
      .getByRole('group', { name: /^Running/ })
      .getByRole('option');
    await expect(running).toHaveCount(1);

    // Within the 2 s between reads.
    const gamma = await symbiote('gamma', cache);
    await expect(tab(page, /^gamma/)).toBeVisible({ timeout: 4000 });
    await expect(running).toHaveCount(2);
    await tab(page, /^gamma/).click();
    await expect(frameOf(page, 'gamma').locator('.overview')).toBeVisible();

    // gamma stops: its tab stays, marked, its frame unloaded.
    await gamma.stop();
    await expect(tab(page, /^gamma/)).toHaveText('gammastopped', { timeout: 4000 });
    await expect(tab(page, /^gamma/).locator('.state-dot.tone-idle')).toBeVisible();
    await expect(page.locator('.nexus-stopped')).toContainText('gamma stopped');
    await expect(page.locator('iframe[title="gamma"]')).toHaveCount(0);
    await expect(page).toHaveTitle('gamma, stopped — Symbiote nexus');

    // Served again (another port): the same tab takes it back.
    const again = await startView(gamma.dir, cache);
    cleanup.push(() => again.stop());
    await expect(tab(page, /^gamma/)).toHaveText('gammamain', { timeout: 4000 });
    await expect(frameOf(page, 'gamma').locator('.overview')).toBeVisible();
    const gammaFrame = page.locator('iframe[title="gamma"]');
    await expect(gammaFrame).toHaveAttribute('data-url', again.url);
    // Framed with an open token (SC1), traded by the framed page for its key: it writes.
    await expect(gammaFrame).toHaveAttribute('src', new RegExp(`^${again.url}#k=[\\w-]{43}$`));
    const framed = page.frame({ url: (url) => url.href.startsWith(again.url) });
    await expect
      .poll(() =>
        framed?.evaluate(async () => {
          const key = localStorage.getItem('symbiote.viewer.key') ?? '';
          const res = await fetch('/api/session', { headers: { 'x-symbiote-key': key } });
          return ((await res.json()) as { page: boolean }).page;
        }),
      )
      .toBe(true);

    // alpha, never opened, stops: its tab just leaves.
    await alpha.stop();
    await expect(tab(page, /^alpha/)).toHaveCount(0, { timeout: 4000 });

    // A stopped tab closes.
    await again.stop();
    await expect(tab(page, /^gamma/)).toHaveText('gammastopped', { timeout: 4000 });
    await page.locator('.nexus-stopped').getByRole('button', { name: 'Close tab' }).click();
    await expect(tab(page, /^gamma/)).toHaveCount(0);
    await expect(page.locator('.nexus-home .page-line')).toHaveText(
      'None running · 0 repositories in home',
    );
    // Both ran here: they are ones opened before (decision 912).
    await expect(page.locator('.nexus-group-name')).toHaveText(['Opened before']);
    await expect(page.locator('.nexus-row-name')).toHaveCount(2);
    expect(new URL(page.url()).hash).toBe('');
    expect(errors).toEqual([]);
  });

  test('says when none is running, and how to start one', async ({ page }) => {
    const served = await nexus(cacheDir());
    await page.goto(served.url);
    await expect(page.locator('.nexus-home .page-line')).toHaveText(
      'None running · 0 repositories in home',
    );
    await expect(page.locator('.nexus-welcome')).toContainText(
      'No Symbiote runs yet' +
        'Pick a repository or a folder in Home below and press Enter. A folder that is no ' +
        'repository is made one with git init, after you say yes. Or run symbiote view in a ' +
        'repository: it shows here within 2 seconds.',
    );
    await expect(tabs(page).getByRole('tab')).toHaveText(['Symbiotes0']);
    // No Symbiote, no line after the nexus's own page.
    await expect(page.locator('.views-divider')).toHaveCount(0);
    // Home's folders under it (decision 926): an empty home here, scanned at the start.
    await expect(page.locator('.nexus-message')).toHaveText(
      'Home holds no folder to show: run symbiote view in a repository, or type a path.',
    );
    await expect(page.locator('.nexus-foot')).toContainText('Home: 0 repositories in 1 folder,');
  });

  test('opens a repository typed by its path; it joins the running ones (decision 908)', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const cache = cacheDir();
    const home = homeFolder(['alpha', 'beta', 'gamma'], ['notes']);
    cleanup.push(() => home.remove());
    cleanup.push(() => stopRecorded(cache));
    const alpha = await startView(`${home.projects}/alpha`, cache);
    cleanup.push(() => alpha.stop());
    const served = await nexus(cache, home.dir);
    await page.goto(served.url);

    const field = page.getByRole('combobox', { name: 'Find a repository' });
    const names = page.getByRole('listbox', { name: 'Repositories' }).locator('.nexus-row-name');
    // Running, then home's tree (decision 926).
    await expect(names).toHaveText(['alpha', 'projects/']);
    // The address names no folder until the person types one.
    expect(new URL(page.url()).hash).toBe('');
    await field.fill('~/projects/');
    await expect(names).toHaveText(['alpha', 'beta', 'gamma', 'notes/']);
    await expect(page.locator('.nexus-row .state-dot.nexus-live')).toHaveCount(1);
    await field.press('ArrowDown');
    await expect(page.locator('.nexus-detail h2')).toHaveText('beta');
    await field.press('Enter');
    await expect(tab(page, /^beta/)).toHaveAttribute('aria-selected', 'true');
    await expect(frameOf(page, 'beta').locator('.overview')).toBeVisible();

    // beta runs now: back on Symbiotes, under Running with alpha.
    await tab(page, /^Symbiotes/).click();
    await expect(page.locator('.nexus-group-name')).toHaveText(['Running', 'Home']);
    await expect(names).toHaveText(['alpha', 'beta', 'projects/']);
    expect(errors).toEqual([]);
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

    // Copy SHA: the frame may write the clipboard (its `allow`). On Git: a Symbiote opens on its
    // Overview (V91).
    await alpha.getByRole('link', { name: 'Git' }).click();
    await alpha.getByText('second', { exact: true }).first().click();
    await alpha.getByRole('button', { name: 'Copy SHA' }).click();
    await expect(alpha.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^[0-9a-f]{40}$/);

    // Review this commit: a POST from the frame, past the server's own-origin check.
    await alpha.getByRole('button', { name: 'Review this commit' }).click();
    await expect(alpha.getByText('src/a.ts').first()).toBeVisible({ timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test("draws its tabs as the viewer's line tabs: one row, the row's height, no ground", async ({
    page,
  }) => {
    // fix/fix-nexus-top-left: V89 moved the viewer's tab rules to `.workspace-tabs .stab`; the
    // nexus's tabs, still in V61's markup, fell back to the browser's grey button, their words'
    // height, the Symbiotes on a line under the nexus's own.
    const cache = cacheDir();
    await symbiote('alpha', cache);
    await symbiote('beta', cache);
    const served = await nexus(cache);
    await page.goto(served.url);
    await expect(tabs(page).getByRole('tab')).toHaveCount(3);
    const drawn = await page.evaluate(() => {
      const strip = document.querySelector<HTMLElement>('.nexus-tabs')!;
      const bar = document.querySelector<HTMLElement>('.nexus-bar')!;
      const head = getComputedStyle(document.documentElement).getPropertyValue('--card-head');
      return {
        head: parseFloat(head),
        bar: bar.getBoundingClientRect().height,
        strip: strip.getBoundingClientRect().height,
        tabs: [...strip.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => {
          const box = tab.getBoundingClientRect();
          const style = getComputedStyle(tab);
          return {
            name: tab.dataset.tab === '' ? 'Symbiotes' : tab.textContent,
            top: box.top,
            height: box.height,
            background: style.backgroundColor,
            border: style.borderTopWidth,
            line: getComputedStyle(tab, '::after').content,
            picked: tab.getAttribute('aria-selected') === 'true',
          };
        }),
      };
    });
    // The row is a card's head high, its hairline under it; the tabs stand on it, its full height.
    expect(drawn.bar).toBe(drawn.head + 1);
    expect(drawn.strip).toBe(drawn.head);
    for (const one of drawn.tabs) {
      expect(one.top, one.name ?? '').toBe(drawn.tabs[0]?.top);
      expect(one.height, one.name ?? '').toBe(drawn.head);
      expect(one.background, one.name ?? '').toBe('rgba(0, 0, 0, 0)');
      expect(one.border, one.name ?? '').toBe('0px');
      // The picked tab's line, in the primary, as the viewer's.
      expect(one.line !== 'none', one.name ?? '').toBe(one.picked);
    }
  });

  test('moves between tabs with the arrow keys', async ({ page }) => {
    const cache = cacheDir();
    await symbiote('alpha', cache);
    await symbiote('beta', cache);
    const served = await nexus(cache);
    await page.goto(served.url);
    await expect(tabs(page).getByRole('tab')).toHaveCount(3);
    await tab(page, /^Symbiotes/).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, /^alpha/)).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, /^alpha/)).toBeFocused();
    await page.keyboard.press('End');
    await expect(tab(page, /^beta/)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, /^Symbiotes/)).toHaveAttribute('aria-selected', 'true');
  });
});
