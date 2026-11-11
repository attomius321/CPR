import { expect, test, type Page } from '@playwright/test';
import { graphPage, servePullRequest, wholeFirst, type RunningPullRequest } from './symbiote.js';

// `symbiote pr 7` on core's markup fixture (L1–L2): a rule and a token are symbols with their own
// diff, the components that render a class are its users, and a comment on a rule's line goes
// to the stylesheet. Since V105 a stylesheet of changed rules is one card, one row and one item:
// controls.css (3 rules) and tokens.css (3 variables); Card.module.css changed one rule.
let symbiote: RunningPullRequest;
const errors: string[] = [];

test.beforeAll(async () => {
  symbiote = await servePullRequest('packages/core/test/fixtures/diff/markup');
});

test.afterAll(() => symbiote.stop());

test.beforeEach(async ({ page }) => {
  // The whole change first (V109): this spec starts from it, not from the riskiest finding.
  await wholeFirst(page);
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(graphPage(symbiote.url));
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

const card = (page: Page, name: string) =>
  page.locator('.react-flow__node-stylesheet', {
    has: page.locator('.stylesheet-name', { hasText: name }),
  });
const symbol = (page: Page, name: string) =>
  page.locator('.react-flow__node-symbol', {
    has: page.locator('.symbol-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }),
  });

test('reviews rules and tokens like code, with the markup that uses them', async ({ page }) => {
  const panel = page.getByRole('complementary', { name: 'Symbol detail' });

  // The removed rule whose class a component still renders.
  await page.getByRole('tab', { name: /Findings/ }).click();
  await expect(page.locator('.finding-row', { hasText: '.badge-new' })).toContainText(
    '.badge-new was removed but is still used by 1 symbol: Row',
  );

  // A rule: its own diff, and the components rendering its class. Its stylesheet's row shows it.
  await page.getByRole('tab', { name: /Changes/ }).click();
  const controls = page.locator('.list-file', { hasText: 'src/ui/controls.css' });
  await controls.getByRole('button', { name: 'Show the rules of controls.css' }).click();
  await controls.locator('.list-link', { hasText: /^\.row$/ }).click();
  await expect(panel.locator('.panel-title')).toHaveText('.row');
  await expect(panel.locator('.panel-kind')).toContainText('rule');
  const added = panel.locator('.row-add', { hasText: 'gap: 4px;' });
  await expect(added).toBeVisible();
  await expect(panel).toContainText('Row');
  await expect(panel).toContainText('Other');

  // A token: its new value, and who reads it, in a stylesheet and in a component's style.
  const tokens = page.locator('.list-file', { hasText: 'src/ui/tokens.css' });
  await tokens.getByRole('button', { name: 'Show the variables of tokens.css' }).click();
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

test('draws a stylesheet of changed rules as one card, which opens and closes in place (V105)', async ({
  page,
}) => {
  await expect(page.locator('.react-flow__node-stylesheet')).toHaveCount(2);
  await expect(card(page, 'controls.css')).toContainText('3 rules');
  await expect(card(page, 'tokens.css')).toContainText('3 variables');
  // Its rules are in it; a stylesheet with one changed rule is that rule.
  await expect(symbol(page, '.row')).toHaveCount(0);
  await expect(symbol(page, '.title')).toBeVisible();
  // The component rendering its classes is linked to the card.
  await expect(symbol(page, 'Other')).toBeVisible();

  await card(page, 'controls.css').click();
  await expect(symbol(page, '.row')).toBeVisible();
  await expect(symbol(page, '.selected .icon')).toBeVisible();
  await expect(card(page, 'controls.css').locator('.stylesheet-node')).toHaveClass(/expanded/);
  await expect(card(page, 'controls.css')).toContainText('hide');
  await expect(page.locator('.react-flow__node-stylesheet')).toHaveCount(2);

  await card(page, 'controls.css').click();
  await expect(symbol(page, '.row')).toHaveCount(0);
  await expect(card(page, 'controls.css')).toContainText('show');
});

test("marks a stylesheet's rules with one mark, and counts it as one change (V105)", async ({
  page,
}) => {
  await page.getByRole('tab', { name: /Changes/ }).click();
  const progress = page.locator('.review-progress');
  await expect(progress).toContainText('0 of 4 changes reviewed');
  await expect(page.getByRole('tab', { name: /Changes/ })).toContainText('4');

  const controls = page.locator('.list-file', { hasText: 'src/ui/controls.css' });
  await controls.getByRole('checkbox', { name: 'Mark controls.css reviewed' }).check();
  await expect(progress).toContainText('1 of 4 changes reviewed');
  await expect(card(page, 'controls.css').locator('.stylesheet-node')).toHaveClass(/reviewed/);
  await controls.getByRole('button', { name: 'Show the rules of controls.css' }).click();
  await expect(controls.locator('.list-item.list-part.done')).toHaveCount(3);

  // A rule picked from the list rings its closed card, which stays closed.
  await controls.locator('.list-link', { hasText: /^\.row$/ }).click();
  await expect(card(page, 'controls.css').locator('.stylesheet-node')).toHaveClass(/selected/);
  await expect(symbol(page, '.row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reviewed', exact: true })).toBeVisible();

  // r on any of its rules unmarks them all.
  await page.keyboard.press('r');
  await expect(progress).toContainText('0 of 4 changes reviewed');
  await expect(controls.locator('.list-item.list-part.done')).toHaveCount(0);
});

test('j and k step over a stylesheet as one change, on its first rule (V105)', async ({ page }) => {
  await page.getByRole('tab', { name: /Changes/ }).click();
  const title = page.getByRole('complementary', { name: 'Symbol detail' }).locator('.panel-title');
  // Card.module.css's rule, Other, controls.css, tokens.css, in the list's order.
  for (const [key, shown] of [
    ['j', '.title'],
    ['j', 'Other'],
    ['j', '.row'],
    ['j', ':root › --accent'],
    ['k', '.row'],
  ] as const) {
    await page.keyboard.press(key);
    await expect(title).toHaveText(shown);
  }
  await expect(card(page, 'controls.css').locator('.stylesheet-node')).toHaveClass(/selected/);
  await expect(page.locator('.list-sheet.current')).toContainText('3 rules');
  await page.keyboard.press('Escape');
});
