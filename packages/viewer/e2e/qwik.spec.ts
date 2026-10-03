import { expect, test } from '@playwright/test';
import { servePullRequest, type RunningPullRequest } from './cpr.js';

// `cpr pr 7 --plugin qwik` on the plugin's MDX fixture: an `.mdx` route is a template with its
// own diff and the components it renders, and a comment on one of its lines goes to the file.
let cpr: RunningPullRequest;
const errors: string[] = [];

test.beforeAll(async () => {
  cpr = await servePullRequest('packages/plugin-qwik/test/fixtures/qwik-mdx', ['--plugin', 'qwik']);
});

test.afterAll(() => cpr.stop());

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(cpr.url);
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

test('reviews an MDX route like code, and comments on its lines', async ({ page }) => {
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });

  // The removed component an MDX route still renders.
  await page.getByRole('tab', { name: /Findings/ }).click();
  await expect(page.locator('.finding-row', { hasText: 'removed-still-referenced' })).toContainText(
    'Chart was removed but is still used by 1 symbol: index.mdx',
  );

  // The blog page gained its first component: its diff, and what it renders.
  await page.getByRole('tab', { name: /Changes/ }).click();
  const blog = page.locator('.list-file', { hasText: 'src/routes/blog' });
  await blog.locator('.list-link', { hasText: 'index.mdx' }).click();
  await expect(panel.locator('.panel-title')).toHaveText('index.mdx');
  await expect(panel).toContainText('MDX route');
  const added = panel.locator('.row-add', { hasText: '<Quote by="Ada" />' });
  await expect(added).toBeVisible();
  await expect(panel).toContainText('Quote');

  await added.click();
  await expect(panel.locator('.comment-actions')).toContainText(
    'on line 7 of src/routes/blog/index.mdx',
  );
  await panel.getByLabel('Comment').fill('Cite the source too?');
  await panel.getByRole('button', { name: 'Add comment' }).click();

  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByRole('button', { name: 'Submit review to GitHub' }).click();
  await expect(page.locator('.posted')).toContainText('Review posted.');
  const posted = cpr.requests.filter((r) => r.method === 'POST');
  expect(posted[0]?.body).toMatchObject({
    comments: [
      { path: 'src/routes/blog/index.mdx', line: 7, side: 'RIGHT', body: 'Cite the source too?' },
    ],
  });
});
