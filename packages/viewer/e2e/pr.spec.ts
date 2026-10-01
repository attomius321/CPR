import { expect, test } from '@playwright/test';
import { servePullRequest, type RunningPullRequest } from './cpr.js';

// `cpr pr 7` on the detectors fixture, against a mock GitHub API: comments written in the
// viewer reach GitHub as one review.
let cpr: RunningPullRequest;
const errors: string[] = [];

test.beforeAll(async () => {
  cpr = await servePullRequest('detectors');
});

test.afterAll(() => cpr.stop());

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(cpr.url);
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

test('comments on symbols and submits the review to GitHub', async ({ page }) => {
  await expect(page.locator('.summary .request')).toContainText('#7 Add perimeter and volume');
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });

  // An added function: the comment goes on its first line.
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.locator('.list-link', { hasText: 'perimeter' }).click();
  await expect(panel.locator('.row-add').first()).toBeVisible();
  await expect(panel.locator('.comment-actions')).toContainText('on line 11 of src/shapes.ts');
  await page.keyboard.press('c');
  await page.keyboard.type('Is a square the only shape?');
  await page.keyboard.press('Control+Enter');
  await expect(panel.locator('.draft-body')).toHaveText('Is a square the only shape?');

  // A removed method: its line is on the base side.
  await page.locator('.list-link', { hasText: 'Canvas.clear' }).click();
  await panel.locator('.row-del').first().click();
  await expect(panel.locator('.comment-actions')).toContainText(
    'on removed line 15 of src/shapes.ts',
  );
  await panel.getByLabel('Comment').fill('render() still calls this.');
  await panel.getByRole('button', { name: 'Add comment' }).click();

  // Drafts survive a reload.
  await page.reload();
  const tab = page.getByRole('tab', { name: /Review/ });
  await expect(tab).toContainText('2');
  await tab.click();
  await page.getByLabel('Review summary').fill('Two questions.');
  await page.getByLabel('Request changes').check();
  await page.getByRole('button', { name: 'Submit review to GitHub' }).click();
  await expect(page.locator('.posted')).toContainText('Review posted.');
  await expect(page.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/acme/widgets/pull/7#pullrequestreview-1',
  );
  await expect(tab).toContainText('0');

  const posted = cpr.requests.filter((r) => r.method === 'POST');
  expect(posted).toHaveLength(1);
  expect(posted[0]?.body).toMatchObject({
    event: 'REQUEST_CHANGES',
    body: 'Two questions.',
    comments: [
      { path: 'src/shapes.ts', line: 11, side: 'RIGHT', body: 'Is a square the only shape?' },
      { path: 'src/shapes.ts', line: 15, side: 'LEFT', body: 'render() still calls this.' },
    ],
  });
});
