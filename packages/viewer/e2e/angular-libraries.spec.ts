import { expect, test } from '@playwright/test';
import { servePullRequest, type RunningPullRequest } from './cpr.js';

// `cpr pr 7 --plugin angular` on the fixture with fake Angular libraries in its node_modules:
// library components, directives and pipes are boxes of their package, and a field read only
// through a library pipe (`@if (org$ | await; as org)`) is a use.
let cpr: RunningPullRequest;
const errors: string[] = [];

test.beforeAll(async () => {
  cpr = await servePullRequest('packages/plugin-angular/test/fixtures/libraries', [
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

test('shows what a template uses of its libraries, by package', async ({ page }) => {
  for (const name of ['@acme/ui', '@legacy/widgets', '@old/forms']) {
    await expect(page.locator('.file-label', { hasText: `package ${name}` })).toBeVisible();
  }
  // Installed but never imported.
  await expect(page.locator('.file-label', { hasText: 'package @acme/unused' })).toHaveCount(0);

  await page.getByRole('tab', { name: /Findings/ }).click();
  await expect(page.locator('.finding-row', { hasText: 'removed-still-referenced' })).toContainText(
    'Organization.name was removed but is still used by 1 symbol: org.component.html',
  );
});
