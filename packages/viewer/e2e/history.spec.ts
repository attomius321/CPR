import { expect, test } from '@playwright/test';
import { serveLongHistory, type Running } from './symbiote.js';

// The commits page on a longer history (V10): rows drawn only near the view, their details
// asked for as they come near, and a line too long to draw cut into arrows.
const ROWS = 450;
const ROW_HEIGHT = 28;
let symbiote: Running;
const errors: string[] = [];

test.beforeAll(async () => {
  symbiote = await serveLongHistory(ROWS);
});

test.afterAll(() => symbiote.stop());

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => expect(errors).toEqual([]));

const subject = (text: string) =>
  `.commit:has(.commit-subject:text-is("${text.replace(/"/g, '\\"')}"))`;

test('spans the whole history, drawing only the rows near the view', async ({ page }) => {
  await page.goto(`${symbiote.url}history`);
  // "Old idea" is newest; HEAD (main, "commit 450") right under it, where the cursor starts.
  await expect(page.locator('.commit-subject').first()).toHaveText('Old idea');
  await expect(page.locator('.commit.cursor .commit-subject')).toHaveText(`commit ${ROWS}`);
  await expect(page.locator('.commit-list')).toHaveCSS('height', `${(ROWS + 1) * ROW_HEIGHT}px`);
  expect(await page.locator('.commit').count()).toBeLessThan(100);

  // The last rows' details come when they come near.
  await page.locator('.commits-scroll').evaluate((box) => (box.scrollTop = box.scrollHeight));
  await expect(page.locator(subject('commit 1'))).toBeInViewport();
  await expect(page.locator(subject('commit 1')).locator('.commit-dot')).toHaveClass(/lane-0/);
  // Back to HEAD from the far end.
  await page.getByRole('button', { name: 'HEAD → main' }).click();
  await expect(page.locator(subject(`commit ${ROWS}`))).toBeInViewport();
  await expect(page.locator(subject(`commit ${ROWS}`))).toHaveClass(/head/);
});

test('cuts a line longer than 100 rows into arrows; a click goes to the other end', async ({
  page,
}) => {
  await page.goto(`${symbiote.url}history`);
  const old = page.locator(subject('Old idea'));
  await expect(old.locator('.arrow')).toHaveCount(1);
  await expect(old.locator('.arrow')).toHaveAttribute(
    'data-tip',
    'Its parent is 441 rows below: click to go there',
  );
  await old.locator('.arrow').click();
  const parent = page.locator(subject('commit 10'));
  await expect(parent).toBeInViewport();
  await expect(parent).toHaveClass(/cursor/);
  // Clicking an arrow picks nothing.
  await expect(page.locator('.commit.picked')).toHaveCount(0);

  await parent.locator('.arrow').click();
  await expect(old).toBeInViewport();
  await expect(old).toHaveClass(/cursor/);
});
