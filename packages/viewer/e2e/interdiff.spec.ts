import { expect, test, type Page } from '@playwright/test';
import { fixtureFile, servePullRequest, type RunningPullRequest } from './cpr.js';

// Review a pull request, then a new push arrives: what was reviewed and still the same stays
// reviewed, what changed is flagged, and comments stay on their lines.
let cpr: RunningPullRequest;

test.beforeAll(async () => {
  cpr = await servePullRequest('detectors');
});

test.afterAll(() => cpr.stop());

const saved = (page: Page, name: 'review' | 'drafts') =>
  page.waitForResponse(
    (r) => r.url().endsWith(`/api/state/${name}`) && r.request().method() === 'PUT',
  );

test('keeps the review across a new push and flags what changed', async ({ page }) => {
  await page.goto(cpr.url);
  await page.getByRole('tab', { name: /Changes/ }).click();
  for (const name of ['perimeter', 'Canvas.clear']) {
    const write = saved(page, 'review');
    await page.getByLabel(`Mark ${name} reviewed`).check();
    await write;
  }
  await page.locator('.list-link', { hasText: 'volume' }).click();
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });
  await expect(panel.locator('.comment-actions')).toContainText('on line 15 of src/shapes.ts');
  await panel.getByLabel('Comment').fill('Cube only?');
  const write = saved(page, 'drafts');
  await panel.getByRole('button', { name: 'Add comment' }).click();
  await write;

  // The author adds a header comment (everything moves down a line) and rewrites perimeter.
  const shapes = fixtureFile('detectors', 'src/shapes.ts');
  await cpr.push({
    'src/shapes.ts': `// Shapes and tools.\n${shapes.replace('shape.size * 4', '4 * shape.size')}`,
  });

  // A new run is a new origin: the state comes from the CLI's cache, not the browser.
  await page.goto(cpr.url);
  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(page.locator('.stale-note')).toHaveText('↻ 1 symbol changed since you reviewed it');
  await expect(page.locator('.list-item', { hasText: 'perimeter' })).toHaveClass(/stale/);
  await expect(page.getByLabel('Mark perimeter reviewed')).not.toBeChecked();
  await expect(page.getByLabel('Mark Canvas.clear reviewed')).toBeChecked();

  await page.getByRole('tab', { name: /Review/ }).click();
  await expect(page.locator('.draft-row')).toContainText('on line 16 of src/shapes.ts');
  await expect(page.locator('.draft-row')).toContainText('Cube only?');
});

test('opened with --since, walks only what changed since the previous push', async ({ page }) => {
  // A third push rewrites volume; open it compared with the second.
  const shapes = fixtureFile('detectors', 'src/shapes.ts')
    .replace('shape.size * 4', '4 * shape.size')
    .replace('shape.size ** 3', 'shape.size * shape.size * shape.size');
  await cpr.push({ 'src/shapes.ts': `// Shapes and tools.\n${shapes}` }, { since: true });

  await page.goto(cpr.url);
  const only = page.getByLabel(/Only changes since [0-9a-f]{7}/);
  await expect(only).toBeChecked();
  await expect(page.locator('.chip-since')).toHaveText(/since [0-9a-f]{7}: 1 updated · 7 same/);
  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(page.locator('.list-link')).toHaveText(['volume']);
  await page.keyboard.press('j');
  await expect(page.locator('.panel-title')).toHaveText('volume');
  await expect(page.locator('.panel-kind')).toContainText('updated since');

  await only.uncheck();
  await expect(page.locator('.list-link')).toHaveCount(8);
});
