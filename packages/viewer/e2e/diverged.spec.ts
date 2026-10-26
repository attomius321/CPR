import { expect, test, type Page } from '@playwright/test';
import { showGraph, serveDiverged, type RunningDiverged } from './symbiote.js';

// V10c: two picks on lines that diverged are compared from their fork point, as a pull request
// shows a branch: what head's side adds, never the other side's work as reverted.
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => expect(errors).toEqual([]));

const short = (sha: string) => sha.slice(0, 7);
const row = (page: Page, subject: string) =>
  page.locator('.commit', { has: page.locator('.commit-subject', { hasText: subject }) });
const symbol = (page: Page, name: string) =>
  page.locator('.react-flow__node-symbol', {
    has: page.locator('.symbol-name', { hasText: new RegExp(`^${name}$`) }),
  });

async function pickBoth(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Compare mode' }).click();
  await row(page, 'Add half').click();
  await row(page, 'Change square').click();
}

test.describe('with main checked out', () => {
  let symbiote: RunningDiverged;
  test.beforeAll(async () => {
    symbiote = await serveDiverged();
  });
  test.afterAll(() => symbiote.stop());

  test("compares the branch from where it forked: its own changes, none of main's", async ({
    page,
  }) => {
    const { fork, main, topic } = symbiote;
    await pickBoth(page, `${symbiote.url}history`);
    await expect(page.locator('.compare-label')).toHaveText(
      `${short(fork)} → ${short(topic)} · 2 commits · diverged from ${short(main)}: its 2 commits since the fork are not in this diff`,
    );
    // The fork point is ringed, and a click away.
    await expect(page.locator('.fork-ring')).toHaveCount(1);
    await expect(row(page, 'Add square').locator('.fork-ring')).toHaveCount(1);
    await page.getByRole('button', { name: short(fork) }).click();
    await expect(page.locator('.commit.cursor .commit-subject')).toHaveText('Add square');

    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page).toHaveURL(`${symbiote.url}diff/${fork}..${topic}/`);
    await showGraph(page);
    await expect(symbol(page, 'twice').locator('.symbol')).toHaveClass(/tone-added/);
    await expect(symbol(page, 'square').locator('.symbol')).toHaveClass(/tone-modified/);
    // main's work since the fork is not shown, as removed or otherwise.
    await expect(symbol(page, 'cube')).toHaveCount(0);
    await expect(symbol(page, 'half')).toHaveCount(0);
  });

  test("swaps the sides: main's changes since the fork", async ({ page }) => {
    const { fork, main, topic } = symbiote;
    await pickBoth(page, `${symbiote.url}history`);
    await page.getByRole('button', { name: 'Swap' }).click();
    await expect(page.locator('.compare-label')).toHaveText(
      `${short(fork)} → ${short(main)} · 2 commits · diverged from ${short(topic)}: its 2 commits since the fork are not in this diff`,
    );
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page).toHaveURL(`${symbiote.url}diff/${fork}..${main}/`);
    await showGraph(page);
    await expect(symbol(page, 'cube').locator('.symbol')).toHaveClass(/tone-added/);
    await expect(symbol(page, 'half').locator('.symbol')).toHaveClass(/tone-added/);
    await expect(symbol(page, 'twice')).toHaveCount(0);
  });

  test('compares a commit and its ancestor as before: no fork point, no Swap', async ({ page }) => {
    await page.goto(`${symbiote.url}history`);
    await page.getByRole('button', { name: 'Compare mode' }).click();
    await row(page, 'Add twice').click();
    await row(page, 'Add square').click();
    await expect(page.locator('.compare-label')).toHaveText(
      `${short(symbiote.fork)} → ${short((await row(page, 'Add twice').locator('.commit-sha').textContent()) ?? '')} · 1 commit`,
    );
    await expect(page.locator('.fork-ring')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Swap' })).toHaveCount(0);
  });
});

test.describe('with the branch checked out', () => {
  let symbiote: RunningDiverged;
  test.beforeAll(async () => {
    symbiote = await serveDiverged('topic');
  });
  test.afterAll(() => symbiote.stop());

  test("still takes main's side as the base: the default branch", async ({ page }) => {
    const { fork, main, topic } = symbiote;
    await pickBoth(page, `${symbiote.url}history`);
    await expect(page.locator('.compare-label')).toHaveText(
      `${short(fork)} → ${short(topic)} · 2 commits · diverged from ${short(main)}: its 2 commits since the fork are not in this diff`,
    );
    await expect(page.locator('.compare-diverged')).toHaveAttribute(
      'data-tip',
      `${short(main)} is on main\nThis diff shows what ${short(topic)} adds since they forked at ${short(fork)}. Swap compares ${short(main)} instead.`,
    );
  });
});
