import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './cpr.js';

// `cpr view` without revisions (V9): the commits page; picked pairs are analyzed on demand,
// each at /diff/<base>..<head>/.
let cpr: RunningCommits;
const errors: string[] = [];

test.beforeAll(async () => {
  cpr = await serveCommits();
});

test.afterAll(() => cpr.stop());

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => expect(errors).toEqual([]));

const short = (sha: string | undefined) => (sha ?? '').slice(0, 7);
/** The row whose subject is, or starts with, `subject`. */
const row = (page: Page, subject: string) =>
  page.locator('.commit', {
    has: page.locator('.commit-subject').getByText(new RegExp(`^${subject}(,|$)`)),
  });
const symbol = (page: Page, name: string) =>
  page.locator('.react-flow__node-symbol', {
    has: page.locator('.symbol-name', { hasText: name }),
  });

test('lists the branch, newest first', async ({ page }) => {
  await page.goto(cpr.url);
  await expect(page.locator('.commits-title')).toContainText('Commits on main');
  await expect(page.locator('.commit-subject')).toHaveText([
    /^Add half, and a subject that runs on/,
    'Add cube',
    'Add square',
    'head',
    'base',
  ]);
  await expect(row(page, 'Add half').locator('.ref')).toHaveText(['HEAD', 'main']);
  await expect(row(page, 'base').getByRole('button', { name: 'This commit' })).toBeDisabled();
  // A long subject is cut, not the page: no sideways scroll, every row's end and Compare in view.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(row(page, 'Add half').locator('.commit-date')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Compare' })).toBeInViewport();
});

test('picks two commits, analyzes them, and goes back', async ({ page }) => {
  const [, head, , cube] = cpr.shas;
  await page.goto(cpr.url);
  await row(page, 'Add cube').click();
  await row(page, 'head').click();
  await expect(page.locator('.compare-label')).toHaveText(
    `${short(head)} → ${short(cube)} · 2 commits`,
  );
  await page.getByRole('button', { name: 'Compare' }).click();

  await expect(page).toHaveURL(`${cpr.url}diff/${head}..${cube}/`);
  await expect(page.getByRole('status')).toContainText(`Analyzing ${short(head)} → ${short(cube)}`);
  await expect(symbol(page, 'square').locator('.symbol')).toHaveClass(/tone-added/);
  await expect(symbol(page, 'cube').locator('.symbol')).toHaveClass(/tone-added/);
  await expect(symbol(page, 'half')).toHaveCount(0);
  // The commits page's styles leave the review sidebar's own progress bar alone.
  await expect(page.locator('.sidebar .progress')).toHaveCSS('margin-top', '0px');

  // Kept: a reload shows it at once.
  await page.reload();
  await expect(symbol(page, 'cube')).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.getByRole('link', { name: '← Commits' }).click();
  await expect(page).toHaveURL(cpr.url);
  await expect(page.locator('.commit')).toHaveCount(5);
});

test('compares one commit with its parent, from the keyboard too', async ({ page }) => {
  const [, , , cube, half] = cpr.shas;
  await page.goto(cpr.url);
  await row(page, 'Add half').getByRole('button', { name: 'This commit' }).click();
  await expect(page).toHaveURL(`${cpr.url}diff/${cube}..${half}/`);
  await expect(symbol(page, 'half').locator('.symbol')).toHaveClass(/tone-added/);
  await expect(symbol(page, 'cube')).toHaveCount(0);

  // j/k move, x picks, Enter compares: the newest alone, against its parent (kept: at once).
  await page.goto(cpr.url);
  await expect(page.locator('.commit')).toHaveCount(5);
  await page.keyboard.press('x');
  await expect(page.locator('.compare-label')).toHaveText(
    `${short(cube)} → ${short(half)} · 1 commit`,
  );
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${cpr.url}diff/${cube}..${half}/`);
});

test('stops an analysis', async ({ page }) => {
  const [base, , , , half] = cpr.shas;
  await page.goto(cpr.url);
  await row(page, 'base').click();
  await row(page, 'Add half').click();
  await page.getByRole('button', { name: 'Compare' }).click();
  await expect(page).toHaveURL(`${cpr.url}diff/${base}..${half}/`);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page).toHaveURL(cpr.url);
  await expect(page.locator('.commit')).toHaveCount(5);
});

test('analyzes a diff URL opened anew', async ({ page }) => {
  const [base, head] = cpr.shas;
  await page.goto(`${cpr.url}diff/${base}..${head}/`);
  await expect(symbol(page, 'triple')).toBeVisible();
  // A picked pair has no names: short SHAs, not the full ones twice.
  await expect(page.locator('.summary .revisions')).toHaveText(`${short(base)} → ${short(head)}`);
});
