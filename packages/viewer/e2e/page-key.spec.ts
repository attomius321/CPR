import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// SC1 (decision 930): the page writes with the key it traded the opened address's token for. A
// tab opened on the bare address (a bookmark, a second browser) reads, and says "Open from
// Symbiote" instead of writing. These specs send no key of their own, as a browser holds none.
test.use({ extraHTTPHeaders: {} });

let symbiote: RunningCommits;

test.beforeAll(async () => {
  symbiote = await serveCommits();
});

test.afterAll(() => symbiote.stop());

const notice = (page: Page) => page.getByRole('alert').filter({ hasText: 'Open from Symbiote' });

/** Compares "Add half" with its parent: a write (`POST /api/diffs`). */
async function compare(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Compare mode' }).click();
  await page.locator('.commit', { hasText: 'Add half' }).click();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
}

test('a tab opened on the bare address reads; its first write says Open from Symbiote', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${symbiote.url}git`);
  // It reads: the commits are there.
  await expect(page.locator('.commit')).toHaveCount(7);
  await expect(notice(page)).toBeVisible();
  await notice(page).getByRole('button', { name: 'Close' }).click();
  await expect(notice(page)).toHaveCount(0);

  // Its first write is refused for want of the key, and said; the page stays where it was.
  const refused = page.waitForResponse((r) => r.url().endsWith('/api/diffs'));
  await compare(page);
  expect((await refused).status()).toBe(403);
  await expect(notice(page)).toBeVisible();
  await expect(page).toHaveURL(`${symbiote.url}git`);

  // The Confirm's asks are the page's too.
  expect((await page.request.get(`${symbiote.url}api/mcp/asks`)).status()).toBe(403);

  // Open again: symbiote view opens or prints a fresh address itself; this tab is told where.
  await notice(page).getByRole('button', { name: 'Open again' }).click();
  await expect(notice(page)).toContainText('A new address is open in your browser');
  expect(errors).toEqual([]);
});

test('the address Symbiote opens writes: its token traded once, then gone from it', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const address = (await symbiote.freshAddress()).replace('#', 'git#');
  await page.goto(address);
  await expect(page.locator('.commit')).toHaveCount(7);
  // Out of the address at once: not shown, not kept in the history.
  await expect(page).toHaveURL(`${symbiote.url}git`);
  await compare(page);
  await expect(page).toHaveURL(/\/diff\/[0-9a-f]{40}\.\.[0-9a-f]{40}\/$/);
  // A reload keeps the key: it was kept in this origin's storage.
  await page.goto(`${symbiote.url}git`);
  await expect(page.locator('.commit')).toHaveCount(7);
  await expect(notice(page)).toHaveCount(0);

  // The same address in another browser: its token was used, so it reads only.
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await second.goto(address);
    await expect(second.locator('.commit')).toHaveCount(7);
    await expect(notice(second)).toBeVisible();
  } finally {
    await other.close();
  }
  expect(errors).toEqual([]);
});
