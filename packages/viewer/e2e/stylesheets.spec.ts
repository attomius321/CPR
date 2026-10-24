import { expect, test } from '@playwright/test';
import { servePullRequest, type RunningPullRequest } from './symbiote.js';

// `symbiote pr 7` on core's markup fixture (L1–L2): a rule and a token are symbols with their own
// diff, the components that render a class are its users, and a comment on a rule's line goes
// to the stylesheet.
let symbiote: RunningPullRequest;
const errors: string[] = [];

test.beforeAll(async () => {
  symbiote = await servePullRequest('packages/core/test/fixtures/diff/markup');
});

test.afterAll(() => symbiote.stop());

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(symbiote.url);
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

test('reviews rules and tokens like code, with the markup that uses them', async ({ page }) => {
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });

  // The removed rule whose class a component still renders.
  await page.getByRole('tab', { name: /Findings/ }).click();
  await expect(page.locator('.finding-row', { hasText: '.badge-new' })).toContainText(
    '.badge-new was removed but is still used by 1 symbol: Row',
  );

  // A rule: its own diff, and the components rendering its class.
  await page.getByRole('tab', { name: /Changes/ }).click();
  const controls = page.locator('.list-file', { hasText: 'src/ui/controls.css' });
  await controls.locator('.list-link', { hasText: /^\.row$/ }).click();
  await expect(panel.locator('.panel-title')).toHaveText('.row');
  await expect(panel.locator('.panel-kind')).toContainText('rule');
  const added = panel.locator('.row-add', { hasText: 'gap: 4px;' });
  await expect(added).toBeVisible();
  await expect(panel).toContainText('Row');
  await expect(panel).toContainText('Other');

  // A token: its new value, and who reads it, in a stylesheet and in a component's style.
  const tokens = page.locator('.list-file', { hasText: 'src/ui/tokens.css' });
  await tokens.locator('.list-link', { hasText: ':root › --accent' }).click();
  await expect(panel.locator('.panel-title')).toHaveText(':root › --accent');
  await expect(panel.locator('.row-add', { hasText: '--accent: teal;' })).toBeVisible();
  await expect(panel).toContainText('.selected .icon');

  // A comment on the rule's added line goes to the stylesheet's line.
  await controls.locator('.list-link', { hasText: /^\.row$/ }).click();
  await panel.locator('.row-add', { hasText: 'gap: 4px;' }).click();
  await expect(panel.locator('.comment-actions')).toContainText('on line 3 of src/ui/controls.css');
  await panel.getByLabel('Comment').fill('A token for the gap?');
  await panel.getByRole('button', { name: 'Add comment' }).click();

  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByRole('button', { name: 'Submit review to GitHub' }).click();
  await expect(page.locator('.posted')).toContainText('Review posted.');
  const posted = symbiote.requests.filter((r) => r.method === 'POST');
  expect(posted[0]?.body).toMatchObject({
    comments: [
      { path: 'src/ui/controls.css', line: 3, side: 'RIGHT', body: 'A token for the gap?' },
    ],
  });
});
