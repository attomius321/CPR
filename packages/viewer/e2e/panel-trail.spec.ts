import { expect, test, type Locator, type Page } from '@playwright/test';
import { graphPage, serveFixture, wholeFirst, type Running } from './symbiote.js';

// V107: the detail panel's way back (decision 982) and its rows on one line (decision 999). The
// fixture removes `Ledger.legacyTotal`, still called by two report functions with long names (an
// error), and changes `LedgerEntry`, whose users only name its type (not on the canvas), and the
// custom property `--ledger-accent`, used by two rules whose selectors have spaces (they wrapped).
let symbiote: Running;
const errors: string[] = [];

test.beforeAll(async () => {
  symbiote = await serveFixture('packages/viewer/test/fixtures/panel-trail');
});

test.afterAll(() => symbiote.stop());

test.beforeEach(async ({ page }) => {
  await wholeFirst(page);
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(graphPage(symbiote.url));
  await expect(page.locator('.react-flow__node-symbol').first()).toBeVisible();
});

test.afterEach(() => expect(errors).toEqual([]));

const RENDER = 'renderQuarterlyLedgerReportForTheFinanceTeamDashboard';
const panel = (page: Page) => page.getByRole('complementary', { name: 'Symbol detail' });
const title = (page: Page) => panel(page).locator('.panel-title');
const back = (page: Page) => panel(page).getByRole('button', { name: 'Back', exact: true });
const link = (page: Page, name: string) =>
  panel(page).locator('.neighbours').getByRole('button', { name, exact: true });

/** Picks the error, `Ledger.legacyTotal`, from the sidebar's Findings. */
async function pickTheError(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /Findings/ }).click();
  await page.locator('.finding-row.finding-error').click();
  await expect(title(page)).toHaveText('Ledger.legacyTotal');
}

test('Back returns to the pick a link was followed from: the button, then Alt+←', async ({
  page,
}) => {
  await pickTheError(page);
  // Nothing followed yet: no Back.
  await expect(back(page)).toHaveCount(0);

  await link(page, RENDER).click();
  await expect(title(page)).toHaveText(RENDER);
  await expect(back(page)).toHaveAttribute('data-tip', 'Back to Ledger.legacyTotal');
  await expect(back(page)).toHaveAttribute('data-tip-keys', 'Alt+←');
  await back(page).click();
  await expect(title(page)).toHaveText('Ledger.legacyTotal');
  await expect(back(page)).toHaveCount(0);

  // Two links deep, Alt+← walks back one at a time.
  await link(page, RENDER).click();
  await link(page, 'Ledger').click();
  await expect(title(page)).toHaveText('Ledger');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(title(page)).toHaveText(RENDER);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(title(page)).toHaveText('Ledger.legacyTotal');
  await expect(back(page)).toHaveCount(0);
});

test('a pick from the sidebar, j or the canvas clears the trail', async ({ page }) => {
  await pickTheError(page);
  await link(page, RENDER).click();
  await expect(back(page)).toBeVisible();
  // The sidebar: the same finding picked again starts afresh.
  await page.locator('.finding-row.finding-error').click();
  await expect(title(page)).toHaveText('Ledger.legacyTotal');
  await expect(back(page)).toHaveCount(0);

  await link(page, RENDER).click();
  await expect(back(page)).toBeVisible();
  await page.keyboard.press('j');
  await expect(title(page)).not.toHaveText(RENDER);
  await expect(back(page)).toHaveCount(0);

  await link(page, RENDER).click();
  await expect(back(page)).toBeVisible();
  // Another symbol drawn, once the canvas holds still after the pick.
  await page.waitForTimeout(1_000);
  const names = await page.locator('.react-flow__node-symbol .symbol-name').allTextContents();
  const other = names.find((name) => name !== RENDER);
  expect(other).toBeTruthy();
  await page
    .locator('.react-flow__node-symbol', {
      has: page.locator('.symbol-name').getByText(other ?? '', { exact: true }),
    })
    .click();
  await expect(title(page)).toHaveText(other ?? '');
  await expect(back(page)).toHaveCount(0);
  // An old trail does not come back with its pick.
  await page.locator('.finding-row.finding-error').click();
  await link(page, RENDER).click();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await pickTheError(page);
  await expect(back(page)).toHaveCount(0);
});

/** Each row of the panel's lists: its height, its name's and whether the name is cut. */
const rows = (lists: Locator) =>
  lists.locator('li').evaluateAll((items) =>
    items.map((li) => {
      const name = li.querySelector<HTMLElement>('.link');
      const style = name ? getComputedStyle(name) : null;
      return {
        text: name?.textContent ?? '',
        height: li.getBoundingClientRect().height,
        line: style ? parseFloat(style.fontSize) * 1.5 : 0,
        cut: name ? name.scrollWidth > name.clientWidth : false,
        // Nothing past the row's end: the list never scrolls sideways.
        fits: li.scrollWidth <= li.clientWidth + 1,
        ellipsis: style?.textOverflow,
        nowrap: style?.whiteSpace,
        tip: name?.getAttribute('data-tip') ?? '',
      };
    }),
  );

test('at the narrowest panel every row is one line, a long name cut with its tip whole', async ({
  page,
}) => {
  await pickTheError(page);
  const handle = page.getByRole('separator', { name: 'Resize detail panel' });
  await handle.focus();
  await page.keyboard.press('Home');
  await expect
    .poll(() => panel(page).evaluate((el) => Math.round(el.getBoundingClientRect().width)))
    .toBe(320);

  // Still used by: two long names, each cut on its one line, its tip the name and its place.
  const used = await rows(panel(page).locator('.neighbours'));
  expect(used.map((r) => r.text)).toContain(RENDER);
  for (const row of used) {
    expect(row.height, row.text).toBeLessThan(row.line + 12);
    expect(row.fits, row.text).toBe(true);
    expect(row.nowrap).toBe('nowrap');
    expect(row.ellipsis).toBe('ellipsis');
  }
  const render = used.find((r) => r.text === RENDER);
  expect(render?.cut).toBe(true);
  expect(render?.tip).toMatch(new RegExp(`^${RENDER}\\nsrc/report\\.ts:\\d+$`));

  // LedgerEntry's users are not on the canvas: the chip is its icon, its words its tip.
  await page.getByRole('tab', { name: /Findings/ }).click();
  // Its compatible change is in the fold below the rest (V100).
  await page.locator('.finding-fold').click();
  await page.locator('.finding-row.finding-info', { hasText: 'LedgerEntry' }).click();
  await expect(title(page)).toHaveText('LedgerEntry');
  const chip = panel(page).locator('.neighbour-away').first();
  await expect(chip.locator('.icon')).toBeVisible();
  await expect(chip.locator('.neighbour-away-words')).toBeHidden();
  await expect(chip).toHaveAttribute('data-tip', 'not on the canvas');
  for (const row of await rows(panel(page).locator('.neighbours'))) {
    expect(row.height, row.text).toBeLessThan(row.line + 12);
  }

  // A rule's selector has spaces: it wrapped onto three lines before.
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page
    .getByRole('navigation', { name: 'Review' })
    .getByRole('button', { name: ':root › --ledger-accent', exact: true })
    .click();
  const rules = await rows(panel(page).locator('.neighbours'));
  expect(rules.map((r) => r.text)).toContain(
    '.ledger-report .quarterly-summary .account-balance-row:hover',
  );
  for (const row of rules) {
    expect(row.height, row.text).toBeLessThan(row.line + 12);
    expect(row.fits, row.text).toBe(true);
    expect(row.cut, row.text).toBe(true);
    expect(row.tip.split('\n')[0]).toBe(row.text);
  }

  // Changed members: the class's, one line each too.
  await pickTheError(page);
  await link(page, RENDER).click();
  await link(page, 'Ledger').click();
  await expect(title(page)).toHaveText('Ledger');
  const members = await rows(panel(page).locator('.neighbours'));
  expect(members.map((r) => r.text)).toContain(
    'Ledger.recalculateRunningBalanceForEveryAccountInTheLedger',
  );
  for (const row of members) expect(row.height, row.text).toBeLessThan(row.line + 12);
});
