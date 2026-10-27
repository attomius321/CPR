import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// A diff's or a review's page while its pair is analyzed (V71): a card on the start page's arcs,
// the phases as steps, Start's buttons. Each state is served by routing `api/graph`.
let symbiote: RunningCommits;
const errors: string[] = [];

test.beforeAll(async () => {
  symbiote = await serveCommits();
});

test.afterAll(() => symbiote.stop());

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => expect(errors).toEqual([]));

const short = (sha: string) => sha.slice(0, 7);
const pair = () => {
  const [base = '', head = ''] = symbiote.shas;
  return { base, head };
};

/** Opens the pair's page with `api/graph` answering `status` and `body` (the pair added). */
async function open(page: Page, status: number, body: Record<string, unknown>, review = false) {
  await page.route('**/api/graph', (route) =>
    route.fulfill({ status, json: { ...pair(), ...body } }),
  );
  // A pair not analyzed is analyzed when opened: answer, start nothing.
  await page.route('**/api/diffs', (route) => route.fulfill({ json: { url: '/' } }));
  if (review) {
    await page.route('**/api/capabilities', async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: {
          ...json,
          review: { forge: 'local' },
          branchReview: {
            branch: 'feature/analyzing',
            ref: 'feature/analyzing',
            ...pair(),
            reviewed: null,
            since: null,
            into: 'main',
          },
        },
      });
    });
  }
  const { base, head } = pair();
  await page.goto(`${symbiote.url}diff/${base}..${head}/`);
  await expect(page.locator('.analysis-card')).toBeVisible();
}

const running = { phase: 'references', queued: 0, elapsedMs: 14_400 };
const box = async (page: Page, selector: string) => {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`no box for ${selector}`);
  return found;
};

test('draws a running analysis as a card of steps on the arcs, over the whole page', async ({
  page,
}) => {
  await open(page, 202, running);
  const { base, head } = pair();
  await expect(page.getByRole('status')).toContainText(`Analyzing ${short(base)} → ${short(head)}`);
  // The seconds stay out of the live region: read out every second before.
  await expect(page.locator('.analysis-chip')).toHaveText('14 s');
  await expect(page.getByRole('status')).not.toContainText('14 s');
  // The running step is said in the live region.
  await expect(page.getByRole('status')).toContainText('Find references');

  const steps = page.locator('.analysis-step');
  await expect(steps).toHaveText([
    'Check out both sides',
    'Load the base',
    'Load the head',
    'Extract symbols',
    'Find references',
    'Look for findings',
  ]);
  await expect(page.locator('.analysis-step .state-dot.tone-done')).toHaveCount(4);
  await expect(steps.nth(4).locator('.state-dot')).toHaveClass(/tone-working/);
  await expect(steps.nth(4)).toHaveAttribute('aria-current', 'step');
  await expect(steps.nth(5).locator('.state-dot')).toHaveClass(/tone-idle/);

  // The ground is the whole main area; the card in its middle.
  const main = await box(page, 'main.canvas');
  const ground = await box(page, '.analysis-ground');
  expect(ground).toEqual(main);
  const card = await box(page, '.analysis-card');
  expect(Math.abs(card.x + card.width / 2 - (main.x + main.width / 2))).toBeLessThanOrEqual(1);
  // The orbit turns while it runs.
  const turning = await page
    .locator('.analysis-orbit')
    .evaluate((el) => getComputedStyle(el, '::after').animationName);
  expect(turning).not.toBe('none');

  // Start's head buttons: 36 px, an icon; Stop is not the primary.
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toHaveClass(/secondary/);
  await expect(stop.locator('svg')).toHaveCount(1);
  const back = page.getByRole('link', { name: 'Back to Git' });
  await expect(back).toHaveClass(/button ghost/);
  await expect(back.locator('svg')).toHaveCount(1);
  expect((await stop.boundingBox())?.height).toBe(36);
  expect((await back.boundingBox())?.height).toBe(36);
});

test('waits for the analyses before it', async ({ page }) => {
  await open(page, 202, { phase: null, queued: 2, elapsedMs: 3_000 });
  const steps = page.locator('.analysis-step');
  await expect(steps).toHaveCount(7);
  await expect(steps.first()).toHaveText('Waiting for 2 other analyses');
  await expect(steps.first()).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.analysis-step .state-dot.tone-idle')).toHaveCount(6);
});

test("names a review's branch while it is analyzed", async ({ page }) => {
  await open(page, 202, running, true);
  const { base, head } = pair();
  await expect(page.locator('.analysis-title h1')).toHaveText('Reviewing feature/analyzing');
  await expect(page.locator('.analysis-title p')).toHaveText(
    `into main · first review · ${short(base)} → ${short(head)}`,
  );
});

test('shows a failure: the Failed chip, the error in the text colour, Analyze again', async ({
  page,
}) => {
  await open(page, 502, { error: 'Error: it broke\n    at references (references.ts:1:1)' });
  await expect(page.locator('.analysis-chip')).toHaveText('Failed');
  await expect(page.locator('.analysis-chip svg')).toHaveCount(1);
  await expect(page.locator('.analysis-steps')).toHaveCount(0);
  const error = page.locator('.analysis-error');
  await expect(error).toContainText('Error: it broke');
  const title = await page
    .locator('.analysis-title h1')
    .evaluate((el) => getComputedStyle(el).color);
  await expect(error).toHaveCSS('color', title);
  // The orbit is still once the analysis ended.
  const turning = await page
    .locator('.analysis-orbit')
    .evaluate((el) => getComputedStyle(el, '::after').animationName);
  expect(turning).toBe('none');

  const again = page.getByRole('button', { name: 'Analyze again' });
  await expect(again).not.toHaveClass(/secondary|ghost/);
  await expect(again.locator('svg')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Back to Git' })).toHaveClass(/button ghost/);
  // Again: it runs.
  await page.unroute('**/api/graph');
  await page.route('**/api/graph', (route) =>
    route.fulfill({ status: 202, json: { ...pair(), ...running } }),
  );
  await again.click();
  await expect(page.locator('.analysis-step')).toHaveCount(6);
});

test('shows a stopped analysis', async ({ page }) => {
  await open(page, 404, {});
  await expect(page.locator('.analysis-chip')).toHaveText('Stopped');
  await expect(page.locator('.analysis-card')).toContainText('Its analysis was stopped.');
  await expect(page.getByRole('button', { name: 'Analyze again' })).toBeVisible();
});

test('holds the orbit still without motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 202, running);
  const turning = await page
    .locator('.analysis-orbit')
    .evaluate((el) => getComputedStyle(el, '::after').animationName);
  expect(turning).toBe('none');
});
