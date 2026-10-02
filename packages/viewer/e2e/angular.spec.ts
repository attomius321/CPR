import { expect, test } from '@playwright/test';
import { servePullRequest, type RunningPullRequest } from './cpr.js';

// `cpr pr 7 --plugin angular` on the plugin's fixture: a template is a symbol with its own diff,
// and a comment on one of its lines goes to the template file.
let cpr: RunningPullRequest;
const errors: string[] = [];

test.beforeAll(async () => {
  cpr = await servePullRequest('packages/plugin-angular/test/fixtures/templates', [
    '--plugin',
    'angular',
  ]);
});

test.afterAll(() => cpr.stop());

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(cpr.url);
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

test('reviews a template like code, and comments on its lines', async ({ page }) => {
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });

  // The finding names the template that still calls the removed method.
  await page.getByRole('tab', { name: /Findings/ }).click();
  await expect(page.locator('.finding-row', { hasText: 'removed-still-referenced' })).toContainText(
    'still used by 1 symbol: article.component.html',
  );

  // The template opens with its own diff: the button added in this change.
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.locator('.list-link', { hasText: 'article.component.html' }).click();
  await expect(panel.locator('.panel-title')).toHaveText('article.component.html');
  await expect(panel).toContainText('template of ArticleComponent');
  const added = panel.locator('.row-add', { hasText: 'toggle()' });
  await expect(added).toBeVisible();
  await expect(panel).toContainText('ArticleComponent.toggle');

  await added.click();
  await expect(panel.locator('.comment-actions')).toContainText(
    'on line 5 of src/app/article.component.html',
  );
  await panel.getByLabel('Comment').fill('Should Toggle be hidden while loading?');
  await panel.getByRole('button', { name: 'Add comment' }).click();

  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByRole('button', { name: 'Submit review to GitHub' }).click();
  await expect(page.locator('.posted')).toContainText('Review posted.');
  const posted = cpr.requests.filter((r) => r.method === 'POST');
  expect(posted[0]?.body).toMatchObject({
    comments: [
      {
        path: 'src/app/article.component.html',
        line: 5,
        side: 'RIGHT',
        body: 'Should Toggle be hidden while loading?',
      },
    ],
  });
});
