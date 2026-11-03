import { expect, test, type Page } from '@playwright/test';
import { hiveMocks, manyRows, mockOverview, normalMocks } from './overview-data.js';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';
import { collectTargets, crowded } from './targets.js';

// The Overview (V91, decisions 848–859): first in the sidenav and the page `/` opens, in both
// modes. The inbox's actions are the workspace page's and the sidenav card's (Respond, Review,
// Merge into), on real workspaces with a fake agent; each section of both Overviews over the
// proofs' records, answered by `page.route` (overview-data.ts).
let symbiote: RunningWorkspaces;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote.stop();
  expect(errors).toEqual([]);
});

const POLL = { timeout: 15_000 };
const overview = (page: Page) => page.locator('.overview');
const card = (page: Page, name: string) =>
  overview(page).getByRole('region', { name, exact: true });
const figure = (page: Page, name: string) => overview(page).getByRole('group', { name });
const post = (page: Page, path: string, body: unknown) =>
  page.evaluate(
    async ([path, body]) => {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
    },
    [path, body] as const,
  );
const start = (page: Page, branch: string, title: string, planFirst: boolean) =>
  post(page, '/api/workspaces', {
    branch,
    kind: 'feature',
    title,
    parts: { goal: `${title}.` },
    planFirst,
  });
/** An inbox row, by its workspace's title. */
const inboxRow = (page: Page, title: string) =>
  card(page, 'Waiting for you').locator('.table-row').filter({ hasText: title });

test('the root opens the Overview, first in the sidenav; t comes back to it; empty, it says so', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(symbiote.url);
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page).toHaveTitle(/^Overview · /);
  const pages = page.getByRole('navigation', { name: 'Pages' }).getByRole('link');
  await expect(pages.first()).toHaveAccessibleName('Overview');
  await expect(pages.first()).toHaveAttribute('aria-current', 'page');
  await expect(card(page, 'Waiting for you')).toContainText('Nothing waits for you.');
  await expect(card(page, 'Agents at work')).toContainText('No agent is at work.');
  await expect(figure(page, 'Waiting for you')).toContainText('nothing to answer or review');
  await expect(card(page, 'Merged today')).toContainText('Nothing merged yet today.', POLL);

  await page.keyboard.press('g');
  await expect(page).toHaveURL(/\/git$/);
  await page.keyboard.press('t');
  await expect(page).toHaveURL(/\/overview$/);
  await expect(overview(page)).toBeVisible();
});

test("the inbox: each workspace that waits for you and its one action, the workspace page's own", async ({
  page,
}) => {
  test.setTimeout(120_000);
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}overview`);
  const plan = 'feature/save-a-cart';
  const review = 'feature/discount-code';
  const asks = 'feature/shipping-tax';
  await start(page, plan, 'Save a cart', true);
  await start(page, review, 'Discount code', false);
  await start(page, asks, 'Shipping tax', false);
  // A plan, plan first and no commits: Plan ready.
  symbiote.report(plan, '# Plan\n\n1. Save the cart.');
  // Commits and a report: Ready for review.
  symbiote.commit(review, 'src/code.ts', 'export const code = 1;\n', 'Add a code');
  symbiote.report(review, 'Done: src/code.ts.');
  // A permission it waits on.
  symbiote.hook(asks, {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'pnpm test' },
  });
  symbiote.session(asks, { state: 'blocked', waitingFor: 'permission prompt' });
  // The list is read again on a page's load: none was listed when it was first read.
  await page.reload();

  await expect(inboxRow(page, 'Save a cart')).toContainText('Plan ready', POLL);
  await expect(inboxRow(page, 'Discount code')).toContainText('To review1 commit', POLL);
  await expect(inboxRow(page, 'Shipping tax')).toContainText('Permission to run pnpm test', POLL);
  await expect(figure(page, 'Waiting for you')).toContainText('3');
  await expect(figure(page, 'Waiting for you')).toContainText('2 answers · 1 review');

  // Respond: the sidenav card's, the workspace on its terminal, focused; Approve plan under the
  // plan there (V89), none in the inbox.
  await expect(
    inboxRow(page, 'Save a cart').getByRole('button', { name: 'Approve plan' }),
  ).toHaveCount(0);
  await inboxRow(page, 'Save a cart').getByRole('button', { name: 'Respond' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?branch=${encodeURIComponent(plan)}$`));
  const panel = page.getByRole('region', { name: `Workspace ${plan}` });
  await expect(panel.locator('.agent-terminal .xterm-helper-textarea')).toBeFocused(POLL);

  // Answer: the same, for a permission.
  await page.keyboard.press('Escape');
  await page.goto(`${symbiote.url}overview`);
  await inboxRow(page, 'Shipping tax').getByRole('button', { name: 'Answer' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?branch=${encodeURIComponent(asks)}$`));

  // Review: the workspace head's Review, its change's page.
  await page.goto(`${symbiote.url}overview`);
  await inboxRow(page, 'Discount code').getByRole('button', { name: 'Review' }).click();
  await expect(page.locator('.files-side .review-tab')).toBeVisible(POLL);
  // A diff opened from the Overview goes back to it (V91).
  await expect(page.getByRole('link', { name: 'Overview' }).first()).toBeVisible();
  await page.getByLabel('Approve').check();
  await page.getByRole('button', { name: 'Finish review' }).click();
  await expect(page.locator('.finished')).toContainText('Approved');

  // Approved: Merge into, the workspace head's control; queued, the merge shows under Merging.
  await page.goto(`${symbiote.url}overview`);
  const approved = inboxRow(page, 'Discount code');
  await expect(approved).toContainText('Approved', POLL);
  await approved.getByRole('button', { name: 'Merge into', exact: true }).click();
  const merging = card(page, 'Merging');
  await expect(merging.locator('.table-row')).toContainText('Discount code', POLL);
  await expect(merging).toContainText('approved by you');
});

test("normal mode's sections: the figures, agents at work, the merge, merged today, usage, today", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await mockOverview(page, normalMocks());
  await page.goto(`${symbiote.url}overview`);

  await expect(overview(page).locator('.page-line')).toHaveText(
    '4 things wait for you · 2 agents at work · 1 merge in the queue',
  );
  await expect(figure(page, 'Waiting for you')).toContainText('2 answers · 2 reviews');
  await expect(figure(page, 'Agents working')).toContainText('Claude Code · Codex');
  // The findings of a review analyzed in this run (V93, decision 892): proof 01's figure, and the
  // review's row says them.
  await expect(figure(page, 'Findings to read')).toContainText('3in 1 review');
  await expect(figure(page, 'Findings to read')).toContainText('1 error · 2 warnings');
  await expect(card(page, 'Waiting for you')).toContainText('· 1 error · 2 warnings');
  await expect(figure(page, 'Merged this week')).toContainText('8');
  await expect(figure(page, 'Merged this week')).toContainText('3 today, into main');
  await expect(figure(page, 'Time to merge')).toContainText('h median');

  const rows = card(page, 'Waiting for you').locator('.table-row');
  await expect(rows).toHaveCount(4);
  // The oldest first: the review (6 min), the plan (4), the report (2), the question (1).
  await expect(rows.locator('.cell-title')).toHaveText([
    'Add a discount code',
    'Save a cart for later',
    'Which search library fits the catalog?',
    'Charge tax on shipping',
  ]);
  await expect(rows.nth(3)).toContainText('“Tax shipping for EU orders only?”');
  await expect(rows.locator('button')).toHaveText(['Review', 'Respond', 'Read', 'Answer']);

  const work = card(page, 'Agents at work').locator('.table-row');
  await expect(work.nth(0)).toContainText('Running');
  await expect(work.nth(0)).toContainText('npm test');
  await expect(work.nth(0)).toContainText('Claude · Opus 5.5');
  await expect(work.nth(1)).toContainText('Codex · high');

  await expect(card(page, 'Merging')).toContainText('Checking the merge');
  await expect(card(page, 'Merging').getByRole('img')).toHaveAccessibleName(/Merge done/);
  const merged = card(page, 'Merged today').locator('.table-row');
  await expect(merged).toHaveCount(3);
  await expect(merged.first()).toContainText('Email a receipt after checkout');
  await expect(merged.first()).toContainText('approved by you');
  await expect(merged.first()).toContainText('3c1e0f2 pushed');

  await expect(card(page, 'Usage')).toContainText('5-hour window');
  await expect(card(page, 'Usage')).toContainText('34%');
  await expect(card(page, 'Usage')).toContainText('2 agents running');
  const today = card(page, 'Today').locator('.feed-event');
  await expect(today.first()).toContainText('Asked you a question');
  await expect(card(page, 'Today')).toContainText('Plan ready');
  await expect(card(page, 'Today')).toContainText('Merged into main, pushed');

  // Normal mode's Done today folds (decision 859; V93's name), kept in this browser; its rows say
  // when each merged.
  const done = page.locator('.sidenav .group-done');
  await expect(done.getByRole('button', { name: /Done today/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(done.locator('.workspace-row')).toHaveCount(0);
  await done.getByRole('button', { name: /Done today/ }).click();
  await expect(done.locator('.workspace-row')).toHaveCount(3);
  await expect(done.locator('.ws-row-when').first()).toHaveText(/^\d\d:\d\d$/);
  await page.reload();
  await expect(done.locator('.workspace-row')).toHaveCount(3);
});

test("Hive mode's sections: five figures, a stopped one with why, in flight, landed today, limits, events", async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
  await post(page, '/api/hive', { on: true });
  await mockOverview(page, hiveMocks());
  await page.goto(`${symbiote.url}overview`);
  await expect(overview(page)).toHaveAttribute('data-mode', 'hive');

  await expect(overview(page).getByRole('button', { name: 'Turn off Hive' })).toBeVisible();
  await expect(overview(page).getByRole('button', { name: 'New goal' })).toBeVisible();
  await expect(overview(page).locator('.page-line')).toContainText(
    'lands in main through the merge queue',
  );

  await expect(figure(page, 'In flight')).toContainText('4');
  await expect(figure(page, 'In flight')).toContainText('write 1 · check 1 · review 1 · land 1');
  await expect(figure(page, 'Landed today')).toContainText('4');
  await expect(figure(page, 'Landed today')).toContainText('all pushed to origin');
  await expect(figure(page, 'Defects caught')).toContainText('1');
  await expect(figure(page, 'Time to land')).toContainText('18');
  await expect(figure(page, 'Spend today')).toContainText(/\$\d+\.\d\d/);
  await expect(figure(page, 'Spend today')).toContainText('$0.80 a landing on average');

  const stopped = overview(page).getByRole('region', {
    name: 'Stopped: Import products from a supplier feed',
  });
  await expect(stopped).toContainText('Stopped · 3 of 3 rounds');
  await expect(stopped).toContainText('The check still fails: pnpm test:e2e');
  await expect(stopped.getByRole('link', { name: 'Read why' })).toHaveAttribute(
    'href',
    '/?branch=feature%2Fimport-feed&run',
  );

  const flight = card(page, 'In flight').locator('.table-row');
  await expect(flight).toHaveCount(4);
  await expect(flight.nth(0)).toContainText('Checking 4/4');
  await expect(flight.nth(0)).toContainText('pnpm test:e2e');
  await expect(flight.nth(0)).toContainText('2/3');
  await expect(flight.nth(0)).toContainText('$1.92');
  await expect(flight.nth(2)).toContainText('Editing src/catalog/stock.ts');
  await expect(flight.nth(3)).toContainText('Landing in main: checking the merge');
  await expect(flight.nth(0).getByRole('img')).toHaveAccessibleName(/Write done, Check now/);
  // All kinds: by a workspace's kind.
  await card(page, 'In flight').getByLabel('Which kinds').selectOption('fix');
  await expect(flight).toHaveCount(1);

  const landed = card(page, 'Landed today').locator('.table-row');
  await expect(landed).toHaveCount(5);
  await expect(landed.first()).toContainText('Add a discount code');
  await expect(landed.first()).toContainText('2 rounds · 1 defect caught');
  await expect(landed.first()).toContainText('20c37bc pushed');
  await expect(landed.last()).toContainText('Spike · answered');

  const limits = card(page, 'Limits');
  await expect(limits).toContainText('Hive pauses at 90 %');
  await expect(limits).toContainText('Budget per workspace$5.00');
  await expect(limits).toContainText('Reviewer');
  await expect(limits).toContainText('Lands byMerge queue');
  await expect(limits.getByRole('meter').first()).toHaveAttribute('aria-valuenow', '41');

  await expect(card(page, 'Events').locator('.feed-event').first()).toContainText(
    'Check failed: pnpm test:e2e',
  );

  // Its targets are 24 px or spaced (WCAG 2.2, 2.5.8), as every page's (targets.spec.ts).
  expect(crowded(await page.evaluate(collectTargets))).toEqual([]);
});

// fix/overview-fits-the-page: the Overview fits the main area and never scrolls as a page; each
// list scrolls in its own card under its head. With more rows than fit, the inbox (Hive: in
// flight) keeps its rows first: every other list card is down to its minimum, a head and a row
// and a half.
interface Fit {
  page: { scroll: number; client: number };
  bottom: number;
  cards: {
    name: string;
    height: number;
    min: number;
    bottom: number;
    /** The list's height and its content's. */
    list: { client: number; scroll: number; content: number } | null;
    scrolled: number;
    /** How far the card's head and its table's head moved once the list scrolled to its end. */
    moved: { head: number; table: number };
  }[];
}

/** The page's and each named card's heights; each card's list scrolled to its end. */
const fit = (page: Page, names: readonly string[]): Promise<Fit> =>
  page.evaluate((names) => {
    const main = document.querySelector('.shell-main')!.getBoundingClientRect();
    const body = document.querySelector('.overview-body')!;
    const y = (el: Element | null) => el?.getBoundingClientRect().y ?? 0;
    return {
      page: { scroll: body.scrollHeight, client: body.clientHeight },
      bottom: main.bottom,
      cards: names.map((name) => {
        const card = [...document.querySelectorAll('.overview section')].find(
          (c) => c.getAttribute('aria-label') === name,
        )!;
        const list = card.querySelector('.overview-card-body');
        const head = card.querySelector('.card-head');
        const table = card.querySelector('.table-head');
        const before = { head: y(head), table: y(table) };
        const box = card.getBoundingClientRect();
        const shown = list
          ? {
              client: list.clientHeight,
              scroll: list.scrollHeight,
              content: [...list.children].reduce((h, c) => h + c.getBoundingClientRect().height, 0),
            }
          : null;
        if (list) list.scrollTop = list.scrollHeight;
        return {
          name,
          height: box.height,
          min: parseFloat(getComputedStyle(card).minHeight) || 0,
          bottom: box.bottom,
          list: shown,
          scrolled: list?.scrollTop ?? 0,
          moved: { head: y(head) - before.head, table: y(table) - before.table },
        };
      }),
    };
  }, names);

const FIT_SIZES = [
  [1440, 900],
  [1920, 1080],
  [1366, 768],
] as const;

/** At each size: no page scrollbar; every list overflows and scrolls in its card, its heads kept. */
async function expectFits(page: Page, mode: string, first: string, rest: readonly string[]) {
  for (const [width, height] of FIT_SIZES) {
    const at = `${mode} at ${width}×${height}`;
    await page.setViewportSize({ width, height });
    await page.goto(`${symbiote.url}overview`);
    await expect(card(page, first).locator('.table-row').first()).toBeVisible(POLL);
    await page.evaluate(() => document.fonts.ready);
    const f = await fit(page, [first, ...rest]);
    expect.soft(f.page.scroll, `${at}: the page's height`).toBeLessThanOrEqual(f.page.client);
    for (const c of f.cards) {
      expect.soft(c.list, `${at}: ${c.name} has a list`).not.toBeNull();
      expect.soft(c.scrolled, `${at}: ${c.name}'s list scrolls`).toBeGreaterThan(0);
      expect.soft(Math.abs(c.moved.head), `${at}: ${c.name}'s head kept`).toBeLessThan(1);
      expect.soft(Math.abs(c.moved.table), `${at}: ${c.name}'s table head kept`).toBeLessThan(1);
      expect.soft(c.bottom, `${at}: ${c.name} inside the main area`).toBeLessThanOrEqual(f.bottom);
    }
    // The first list keeps its rows: the others of its column are down to their minimum.
    const [kept, ...others] = f.cards;
    for (const c of others.filter((c) => c.name !== 'Today' && c.name !== 'Events')) {
      expect.soft(c.height - c.min, `${at}: ${c.name} at its minimum`).toBeLessThanOrEqual(1);
      expect.soft(kept!.height, `${at}: ${kept!.name} over ${c.name}`).toBeGreaterThan(c.height);
    }
  }
}

test('the page fits the main area: with many rows, each list scrolls in its card, its head kept', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  await mockOverview(page, manyRows(normalMocks()));
  await expectFits(page, 'normal mode', 'Waiting for you', [
    'Agents at work',
    'Merging',
    'Merged today',
    'Today',
  ]);

  await page.goto(`${symbiote.url}git`);
  await post(page, '/api/hive', { on: true });
  await page.unrouteAll();
  await mockOverview(page, manyRows(hiveMocks()));
  await expectFits(page, 'Hive mode', 'In flight', ['Landed today', 'Events']);
});

test('few rows or none: no scrollbar, each card its content, the last of each column to the bottom', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  for (const [records, mocks] of [
    ['as the proof', normalMocks()],
    ['empty', normalMocks(undefined, { empty: true })],
  ] as const) {
    await page.unrouteAll();
    await mockOverview(page, mocks);
    await page.goto(`${symbiote.url}overview`);
    await expect(card(page, 'Merged today')).toBeVisible(POLL);
    await expect(card(page, 'Usage')).not.toContainText('No subscription read yet', POLL);
    await page.evaluate(() => document.fonts.ready);
    const f = await fit(page, [
      'Waiting for you',
      'Agents at work',
      'Merged today',
      'Usage',
      'Today',
    ]);
    expect.soft(f.page.scroll, `${records}: the page's height`).toBeLessThanOrEqual(f.page.client);
    for (const c of f.cards.filter((c) => c.name !== 'Merged today' && c.name !== 'Today')) {
      expect
        .soft(
          Math.abs(c.list!.client - c.list!.content),
          `${records}: ${c.name} its content's height`,
        )
        .toBeLessThanOrEqual(1);
    }
    for (const c of f.cards.filter((c) => c.name === 'Merged today' || c.name === 'Today')) {
      expect
        .soft(Math.abs(f.bottom - 12 - c.bottom), `${records}: ${c.name} to the bottom`)
        .toBeLessThanOrEqual(1);
    }
  }
});
