import { expect, test, type Page } from '@playwright/test';
import { serveCommits, type RunningCommits } from './symbiote.js';

// A diff's or a review's page while its pair is analyzed (V90, decision 846; V71 before): the six
// steps as a timeline with their times, Stop; beside them what needs no graph — the files (git's,
// served from the pair), and for a workspace's branch its report, commits and brief. Each state is
// served by routing `api/graph`; the files are the real server's.
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
const BRANCH = 'feature/analyzing';

/** Answers `api/graph` with each of `answers` in turn, the last one from then on. */
async function answer(page: Page, answers: [status: number, body: Record<string, unknown>][]) {
  let asked = 0;
  await page.unroute('**/api/graph');
  await page.route('**/api/graph', (route) => {
    const [status, body] = answers[Math.min(asked++, answers.length - 1)] ?? [404, {}];
    return route.fulfill({ status, json: { ...pair(), ...body } });
  });
}

/** Opens the pair's page with `api/graph` answering `answers`; `review`: as a branch's review. */
async function open(
  page: Page,
  answers: [status: number, body: Record<string, unknown>][],
  review = false,
) {
  await answer(page, answers);
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
            branch: BRANCH,
            ref: BRANCH,
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
  await expect(page.locator('.opening')).toBeVisible();
}

const running = { phase: 'references', queued: 0, elapsedMs: 14_400 };
const NAMES = [
  'Check out both sides',
  'Load the base',
  'Load the head',
  'Extract symbols',
  'Find references',
  'Look for findings',
];

test('draws a running analysis as six steps on a timeline, the arcs gone', async ({ page }) => {
  await open(page, [[202, running]]);
  const { base, head } = pair();
  await expect(page.locator('.page-name-line h1')).toContainText(`${short(base)} → ${short(head)}`);
  await expect(page.locator('.analysis-state')).toHaveText('Analyzing · step 5 of 6');
  await expect(page.locator('.analysis-state')).toHaveAttribute('data-tone', 'run');
  await expect(page.locator('.opening-clock')).toHaveText('0:14');
  // The live region says the step and how far it is; the clock stays out of it.
  const status = page.locator('.opening-now [role="status"]');
  await expect(status).toHaveText('Find references · 4 done, 1 to come');

  const steps = page.locator('.opening-step');
  await expect(steps.locator('.opening-step-name')).toHaveText(NAMES);
  await expect(steps.nth(0).locator('.opening-step-detail')).toHaveText(
    `${short(base)} and ${short(head)}, each in a worktree`,
  );
  await expect(page.locator('.opening-step.mark-done')).toHaveCount(4);
  await expect(steps.nth(4)).toHaveClass(/mark-running/);
  await expect(steps.nth(4)).toHaveAttribute('aria-current', 'step');
  await expect(steps.nth(5)).toHaveClass(/mark-next/);
  await expect(page.locator('.opening-segment.mark-done')).toHaveCount(4);
  // What runs moves (fix/static-loadings): the bar's running segment sweeps, its step's arc, the
  // head's label's and the Graph tab's turn; without motion, all still.
  const moving = [
    page.locator('.opening-segment.mark-running'),
    steps.nth(4).locator('.icon'),
    page.locator('.analysis-state .icon'),
    page.getByRole('tab', { name: 'Graph', exact: true }).locator('.icon'),
  ];
  // Its own and its pseudo-elements' (the sweep is the segment's ::after).
  const animations = (locator: (typeof moving)[number]) =>
    locator.evaluate((node) => node.getAnimations({ subtree: true }).length);
  for (const locator of moving) expect(await animations(locator)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const locator of moving) expect(await animations(locator)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Stop is not the primary; no arcs, no comet, no card in the middle.
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveClass(/secondary/);
  await expect(page.locator('.ground, .ground-ring, .analysis-orbit, .analysis-card')).toHaveCount(
    0,
  );
  // Graph is the steps meanwhile: a spinner beside its name.
  await expect(page.getByRole('tab', { name: 'Graph', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: 'Graph', exact: true }).locator('svg')).toHaveCount(1);
});

test('times each step as the page sees the phases change', async ({ page }) => {
  // Two answers each (about a second at 500 ms), then the symbols' extraction from then on.
  await open(page, [
    [202, { phase: 'loadBase', queued: 0, elapsedMs: 1_000 }],
    [202, { phase: 'loadBase', queued: 0, elapsedMs: 1_500 }],
    [202, { phase: 'loadHead', queued: 0, elapsedMs: 2_000 }],
    [202, { phase: 'loadHead', queued: 0, elapsedMs: 2_500 }],
    [202, { phase: 'extract', queued: 0, elapsedMs: 3_000 }],
  ]);
  const times = page.locator('.opening-step-time');
  await expect(page.locator('.opening-step').nth(3)).toHaveClass(/mark-running/);
  // Opened during the base's load: checking out was before, and has no time.
  await expect(times.nth(0)).toHaveText('');
  await expect(times.nth(1)).toHaveText(/^\d\.\d s$/);
  await expect(times.nth(2)).toHaveText(/^\d\.\d s$/);
  // The running step counts in minutes and seconds; the steps to come have none.
  await expect(times.nth(3)).toHaveText(/^0:0\d$/);
  await expect(times.nth(4)).toHaveText('');
});

test('waits for the analyses before it', async ({ page }) => {
  await open(page, [[202, { phase: null, queued: 2, elapsedMs: 3_000 }]]);
  const steps = page.locator('.opening-step');
  await expect(steps).toHaveCount(7);
  await expect(steps.first().locator('.opening-step-name')).toHaveText(
    'Waiting for 2 other analyses',
  );
  await expect(steps.first()).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.opening-step.mark-next')).toHaveCount(6);
  await expect(page.locator('.analysis-state')).toHaveText('Waiting to analyze');
});

test('lists the files at once, read on the Files page meanwhile, comments waiting', async ({
  page,
}) => {
  await open(page, [[202, running]]);
  // git's files, from the pair: the real server's, before any graph.
  const ready = page.locator('.opening-ready');
  await expect(ready.locator('.changes-file')).toHaveCount(1);
  await expect(ready.locator('.changes-file')).toContainText('math.ts');
  await expect(page.locator('.bar .page-line')).toContainText('1 file');
  await expect(page.locator('.opening-note')).toContainText(
    'The files do not wait for it: start with them.',
  );

  await page.getByRole('button', { name: 'Read the files' }).click();
  await expect(page.getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.file-code .row-add').first()).toBeVisible();
  await expect(page.locator('.files-waiting')).toHaveText('Comments open once the graph is built.');
  // No line takes a comment yet.
  await expect(page.locator('.file-code .pickable')).toHaveCount(0);
  expect(page.url()).not.toContain('view=');

  // Back to the steps.
  await page.getByRole('tab', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.opening-steps')).toBeVisible();
});

test("shows a workspace's report, commits and brief while its review is analyzed", async ({
  page,
}) => {
  const { base, head } = pair();
  const workspace = {
    branch: BRANCH,
    title: 'Add a discount code',
    base,
    created: '2026-11-03T10:00:00Z',
    planFirst: false,
    brief: 'Customers can enter a **discount code** at checkout.',
    worktree: { path: '/tmp/nowhere', exists: false },
    tip: head,
    ahead: 1,
    merged: false,
    agent: { state: 'finished', kind: 'claude' },
  };
  await page.route('**/api/workspaces', (route) =>
    route.fulfill({ json: { workspaces: [workspace], place: 'repository' } }),
  );
  await page.route('**/api/workspaces/thread?*', (route) =>
    route.fulfill({
      json: {
        recorded: true,
        entries: [
          { at: '2026-11-03T12:30:00Z', session: 's', kind: 'report', text: 'An older report.' },
          {
            at: '2026-11-03T12:44:00Z',
            session: 's',
            kind: 'report',
            text: 'Done. SAVE10 takes 10 % off the subtotal.',
          },
        ],
      },
    }),
  );
  await page.route('**/api/workspaces/changes?*', (route) =>
    route.fulfill({
      json: {
        branch: BRANCH,
        base,
        tip: head,
        commits: {
          count: 1,
          listed: [
            { sha: head, subject: 'Add square', author: 'Ada', date: '2026-11-03T12:44:00Z' },
          ],
        },
        files: { count: 0, added: 0, removed: 0, listed: [] },
        uncommitted: null,
      },
    }),
  );
  await open(page, [[202, running]], true);
  await expect(page.locator('.page-name-line h1')).toHaveText(`Review of ${BRANCH}`);
  await expect(page.locator('.bar .page-line')).toContainText('into main');
  await expect(page.locator('.bar .page-line')).toContainText(`${short(base)} → ${short(head)}`);

  const agent = page.locator('.opening-agent');
  await expect(agent.locator('.opening-agent-head')).toContainText('Claude Code');
  await expect(agent.locator('.opening-report')).toHaveText(
    'Done. SAVE10 takes 10 % off the subtotal.',
  );
  await expect(agent.locator('.opening-commits li')).toHaveCount(1);
  await expect(agent.locator('.opening-commits li')).toContainText('Add square');
  await expect(page.locator('.opening-brief strong')).toHaveText('discount code');
  await expect(page.locator('.opening-note')).toContainText(
    "The files, the commits and the agent's report do not wait for it",
  );
});

test("leaves out a workspace's commits that start elsewhere than the review", async ({ page }) => {
  const { head } = pair();
  await page.route('**/api/workspaces', (route) =>
    route.fulfill({
      json: {
        workspaces: [
          {
            branch: BRANCH,
            base: head,
            created: '2026-11-03T10:00:00Z',
            planFirst: false,
            brief: 'A brief.',
            worktree: { path: '/tmp/nowhere', exists: false },
            tip: head,
            ahead: 1,
            merged: false,
            agent: { state: 'finished' },
          },
        ],
        place: 'repository',
      },
    }),
  );
  await page.route('**/api/workspaces/thread?*', (route) =>
    route.fulfill({ json: { recorded: true, entries: [] } }),
  );
  await page.route('**/api/workspaces/changes?*', (route) =>
    route.fulfill({
      json: {
        branch: BRANCH,
        base: head,
        tip: head,
        commits: {
          count: 1,
          listed: [{ sha: head, subject: 'x', author: 'A', date: '2026-11-03T12:44:00Z' }],
        },
        files: { count: 0, added: 0, removed: 0, listed: [] },
        uncommitted: null,
      },
    }),
  );
  await open(page, [[202, running]], true);
  await expect(page.locator('.opening-brief')).toHaveText('A brief.');
  await expect(page.locator('.opening-agent')).toHaveCount(0);
});

test('shows a failure where it was seen to fail, the error, Analyze again', async ({ page }) => {
  await open(page, [
    [202, running],
    [502, { error: 'Error: it broke\n    at references (references.ts:1:1)' }],
  ]);
  await expect(page.locator('.analysis-state')).toHaveText('Failed at Find references');
  await expect(page.locator('.analysis-state')).toHaveAttribute('data-tone', 'error');
  await expect(page.locator('.opening-step.mark-done')).toHaveCount(4);
  await expect(page.locator('.opening-step').nth(4)).toHaveClass(/mark-failed/);
  await expect(page.locator('.opening-error')).toContainText('Error: it broke');
  const again = page.getByRole('button', { name: 'Analyze again' });
  await expect(again).not.toHaveClass(/secondary|ghost/);
  await expect(page.getByRole('link', { name: 'Back to Git' }).first()).toBeVisible();
  // Again: it runs.
  await answer(page, [[202, running]]);
  await again.click();
  await expect(page.locator('.opening-step')).toHaveCount(6);
  await expect(page.locator('.analysis-state')).toHaveText('Analyzing · step 5 of 6');
});

test('shows a failure opened after it ended: the error, no steps', async ({ page }) => {
  await open(page, [[502, { error: 'Error: it broke' }]]);
  await expect(page.locator('.analysis-state')).toHaveText('Failed');
  await expect(page.locator('.opening-steps')).toHaveCount(0);
  await expect(page.locator('.opening-error')).toContainText('Error: it broke');
});

test('shows a stopped analysis', async ({ page }) => {
  await open(page, [[404, {}]]);
  await expect(page.locator('.analysis-state')).toHaveText('Stopped');
  await expect(page.locator('.opening-now')).toContainText('Its analysis was stopped.');
  await expect(page.getByRole('button', { name: 'Analyze again' })).toBeVisible();
});
