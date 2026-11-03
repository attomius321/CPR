// The Overviews' records as the proofs draw them (V91; `spikes/normal-redesign` and
// `spikes/hive-redesign` 01-overview), answered by `page.route` over a real `symbiote view`: the
// list, reviews, merges, the day read, usage and Hive's settings. Times are relative to now, so
// "today" holds whenever the spec runs (two hours back at most: past midnight, a test's own
// hour is moved to noon, see `at`).
import type { Page } from '@playwright/test';
import type {
  AgentLevels,
  BranchReviewList,
  DayEvent,
  HiveDayRecord,
  HiveLandingSetting,
  HivePacingSetting,
  MergeEntry,
  MergeList,
  UsageReport,
  WorkspaceDay,
  WorkspaceHive,
  WorkspaceList,
  WorkspaceSummary,
} from '@symbiote/core';

const MINUTE = 60_000;

/**
 * Now, as the records see it: the real time, or today's noon before 04:00, so that the records'
 * times, up to 3 hours back, fall on today in the browser's time zone.
 */
export function overviewNow(): number {
  const now = new Date();
  if (now.getHours() >= 4) return now.getTime();
  now.setHours(12, 0, 0, 0);
  return now.getTime();
}

const iso = (t: number) => new Date(t).toISOString();

const summary = (
  branch: string,
  title: string,
  created: number,
  over: Partial<WorkspaceSummary> = {},
): WorkspaceSummary => ({
  branch,
  title,
  kind: (branch.split('/')[0] ?? 'feature') as WorkspaceSummary['kind'] & string,
  base: 'a'.repeat(40),
  from: 'main',
  created: iso(created),
  planFirst: false,
  brief: `# ${title}`,
  worktree: { path: `/work/storefront.worktrees/${branch.replace('/', '-')}`, exists: true },
  tip: 'b'.repeat(40),
  ahead: 0,
  merged: false,
  agent: { state: 'done', kind: 'claude' },
  ...over,
});

const merge = (over: Partial<MergeEntry> & Pick<MergeEntry, 'branch'>): MergeEntry => ({
  id: `m-${over.branch.replace('/', '-')}`,
  head: 'c'.repeat(40),
  into: 'main',
  title: `Merge ${over.branch}: ${over.branch}`,
  state: 'queued',
  queued: iso(Date.now()),
  updated: iso(Date.now()),
  ...over,
});

const sha = (start: string) => start.padEnd(40, '0');

/** What every Overview's page reads, by its path. */
export interface OverviewMocks {
  list: WorkspaceList;
  reviews: BranchReviewList;
  merges: MergeList;
  day: WorkspaceDay;
  usage: UsageReport;
  pacing?: HivePacingSetting;
  landing?: HiveLandingSetting;
  reviewer?: AgentLevels;
}

const usage = (now: number, five: number, week: number): UsageReport => {
  const reset = new Date(now);
  reset.setHours(reset.getHours() + 1, 0, 0, 0);
  return {
    subscriptions: [
      {
        agent: 'claude',
        plan: 'Pro',
        windows: [
          { minutes: 300, usedPercent: five, resetsAt: iso(reset.getTime()) },
          { minutes: 10_080, usedPercent: week, resetsAt: iso(now + 3 * 86_400_000) },
        ],
        at: iso(now),
        source: 'live',
      },
    ],
  };
};

/** Normal mode as its proof: four things wait, two agents at work, one merge, three merged. */
export function normalMocks(now = overviewNow(), { empty = false } = {}): OverviewMocks {
  const ago = (minutes: number) => now - minutes * MINUTE;
  const approved = (branch: string) => ({
    branch,
    base: 'a'.repeat(40),
    head: 'b'.repeat(40),
    updated: iso(ago(90)),
    marks: 0,
    refs: [],
    added: [],
    verdict: {
      event: 'approve' as const,
      head: 'b'.repeat(40),
      at: iso(ago(90)),
      comments: 0,
      into: 'main',
      merged: true,
    },
  });
  const reviews: BranchReviewList = {
    defaultBranch: 'main',
    reviewer: 'reviewer@example.com',
    place: 'repository',
    reviews: empty ? [] : [approved('feature/receipt'), approved('fix/coupon-field')],
  };
  if (empty) {
    return {
      list: { workspaces: [], place: 'repository' },
      reviews,
      merges: { merges: [] },
      day: {
        since: iso(ago(7 * 1440)),
        into: 'main',
        events: [],
        merges: [],
        started: {},
        hive: [],
      },
      usage: usage(now, 12, 30),
    };
  }
  const workspaces: WorkspaceSummary[] = [
    summary('feature/saved-carts', 'Save a cart for later', ago(30), {
      planFirst: true,
      agent: { state: 'plan-ready', kind: 'claude' },
      activity: { since: iso(ago(4)) },
    }),
    summary('fix/shipping-tax', 'Charge tax on shipping', ago(25), {
      agent: { state: 'needs-you', kind: 'claude' },
      activity: {
        since: iso(ago(1)),
        asks: {
          at: iso(ago(1)),
          session: 's1',
          kind: 'asks',
          tool: 'AskUserQuestion',
          questions: [{ question: 'Tax shipping for EU orders only?', options: [] }],
        },
      },
    }),
    summary('feature/discount-code', 'Add a discount code', ago(40), {
      ahead: 3,
      agent: { state: 'ready', kind: 'claude' },
      activity: { since: iso(ago(6)) },
    }),
    summary('spike/catalog-search', 'Which search library fits the catalog?', ago(20), {
      agent: { state: 'done', kind: 'claude' },
      activity: { since: iso(ago(2)) },
    }),
    summary('feature/stock-levels', 'Show stock levels on product pages', ago(15), {
      agent: {
        state: 'working',
        kind: 'claude',
        runsOn: { model: 'claude-opus-5-5', effort: 'high' },
      },
      activity: { since: iso(ago(3)), doing: { tool: 'Bash', subject: 'npm test' } },
    }),
    summary('feature/order-pages', 'Paginate the order history', ago(18), {
      agent: { state: 'working', kind: 'codex', effort: 'high' },
      activity: { since: iso(ago(7.5)), doing: { tool: 'Edit', subject: 'src/orders/list.ts' } },
    }),
    summary('feature/receipt', 'Email a receipt after checkout', ago(170), {
      merged: true,
      ahead: 2,
      agent: { state: 'done', kind: 'claude' },
    }),
    summary('fix/coupon-field', 'Rename the cart’s coupon field', ago(160), {
      merged: true,
      ahead: 1,
      agent: { state: 'done', kind: 'claude' },
    }),
  ];
  const events: DayEvent[] = [
    {
      at: iso(ago(6)),
      branch: 'feature/discount-code',
      source: 'thread',
      kind: 'report',
      data: { answered: true },
    },
    {
      at: iso(ago(5)),
      branch: 'spike/catalog-search',
      source: 'thread',
      kind: 'report',
      data: { answered: true },
    },
    {
      at: iso(ago(4)),
      branch: 'feature/saved-carts',
      source: 'thread',
      kind: 'report',
      data: { answered: false },
    },
    {
      at: iso(ago(1)),
      branch: 'fix/shipping-tax',
      source: 'thread',
      kind: 'asks',
      data: { tool: 'AskUserQuestion' },
    },
  ];
  const week = [1, 2, 3, 4, 5].map((d) => ({
    sha: sha(`e${d}`),
    at: iso(now - d * 86_400_000),
    subject: `Merge feature/w${d}: Week ${d}`,
    into: 'main',
    branch: `feature/w${d}`,
    pushed: true,
  }));
  return {
    list: { workspaces, place: 'repository' },
    reviews,
    merges: {
      merges: [
        merge({
          branch: 'fix/order-total-rounding',
          title: 'Merge fix/order-total-rounding: Fix order total rounding',
          state: 'checking',
          queued: iso(ago(2)),
          updated: iso(ago(1)),
          check: { commands: ['npm test'], source: 'symbiote/config.json' },
        }),
      ],
    },
    day: {
      since: iso(now - 7 * 86_400_000),
      into: 'main',
      events,
      merges: [
        ...week,
        {
          sha: sha('0e44b7d'),
          at: iso(ago(120)),
          subject: 'Merge fix/webhooks: Retry failed payment webhooks',
          into: 'main',
          branch: 'fix/webhooks',
          pushed: true,
        },
        {
          sha: sha('5a77b31'),
          at: iso(ago(100)),
          subject: 'Merge fix/coupon-field: Rename the cart’s coupon field',
          into: 'main',
          branch: 'fix/coupon-field',
          pushed: true,
        },
        {
          sha: sha('3c1e0f2'),
          at: iso(ago(60)),
          subject: 'Merge feature/receipt: Email a receipt after checkout',
          into: 'main',
          branch: 'feature/receipt',
          pushed: true,
        },
      ],
      started: {
        'feature/receipt': iso(ago(170)),
        'fix/coupon-field': iso(ago(160)),
        'fix/webhooks': iso(ago(300)),
      },
      hive: [],
    },
    usage: usage(now, 34, 58),
  };
}

const hive = (over: Partial<WorkspaceHive>): WorkspaceHive => ({
  step: 'writing',
  round: 1,
  rounds: 3,
  ...over,
});

const record = (over: Partial<HiveDayRecord> & Pick<HiveDayRecord, 'branch'>): HiveDayRecord => ({
  started: iso(Date.now()),
  step: 'writing',
  round: 1,
  rounds: 3,
  reviews: [],
  spend: { reviews: 0, reviewed: 0, total: 0 },
  ...over,
});

/** Hive mode as its proof: four in flight, one stopped, five landed or answered today. */
export function hiveMocks(
  now = overviewNow(),
  { none = false, budgetReached = false } = {},
): OverviewMocks {
  const ago = (minutes: number) => now - minutes * MINUTE;
  const landedAt = (minutes: number) => ({
    round: 1,
    at: 'c'.repeat(40),
    into: 'main',
    entry: 'm',
    queued: iso(ago(minutes + 2)),
    ended: iso(ago(minutes)),
    outcome: 'landed' as const,
    pushed: { ok: true as const, remote: 'origin' },
  });
  const flight: WorkspaceSummary[] = none
    ? []
    : [
        summary('fix/payment-webhook-retry', 'Retry failed payment webhooks', ago(18.6), {
          ahead: 2,
          hive: hive({
            step: 'checking',
            round: 2,
            live: {
              kind: 'check',
              started: iso(ago(4.2)),
              commands: ['pnpm install', 'pnpm check', 'pnpm build', 'pnpm test:e2e'],
              step: 3,
              since: iso(ago(1)),
              done: [
                { ok: true, ms: 20_000 },
                { ok: true, ms: 60_000 },
                { ok: true, ms: 90_000 },
              ],
              expected: { ms: 7 * 60_000, steps: [20_000, 60_000, 90_000, 250_000] },
            },
          }),
        }),
        summary('feature/search-cache', 'Cache product search results', ago(9.2), {
          ahead: 1,
          hive: hive({
            step: 'reviewing',
            live: {
              kind: 'review',
              started: iso(ago(1.6)),
              phase: 'review',
              doing: 'Bash: vitest run test/search',
            },
          }),
        }),
        summary('feature/stock-levels', 'Show stock levels on product pages', ago(3.1), {
          agent: { state: 'working', kind: 'claude' },
          activity: {
            since: iso(ago(1)),
            doing: { tool: 'Edit', subject: 'src/catalog/stock.ts' },
          },
          hive: hive({ step: 'writing' }),
        }),
        summary('feature/orders-csv', 'Export orders as CSV', ago(14.4), {
          ahead: 3,
          hive: hive({
            step: 'landing',
            landing: {
              round: 1,
              at: 'c'.repeat(40),
              into: 'main',
              entry: 'm1',
              queued: iso(ago(1)),
              state: 'checking',
            },
          }),
        }),
      ];
  const stopped = summary('feature/import-feed', 'Import products from a supplier feed', ago(60), {
    ahead: 4,
    hive: hive({
      step: 'stuck',
      round: 3,
      note: budgetReached
        ? 'its spend reached its budget: $5.02 of $5.00 (the writer $4.21, 3 reviews $0.81). Raise the budget in Settings, then send it a message to go on'
        : 'The check still fails: pnpm test:e2e › imports a 10,000-row feed timed out after 30 s',
    }),
  });
  const landed = [
    ['feature/discount-code', 'Add a discount code', 16, 0.84, 2, [1, 0], '20c37bc'],
    ['fix/tax-rounding', 'Fix tax rounding on invoices', 62, 0.51, 1, [0], '8f3e1a2'],
    ['feature/order-history', 'Paginate the order history', 140, 2.1, 3, [1, 1, 0], 'c41d9e0'],
    ['fix/coupon-field', 'Rename the cart’s coupon field', 180, 0.22, 1, [0], '5a77b31'],
  ] as const;
  const records: HiveDayRecord[] = [
    ...landed.map(([branch, title, minutes, spent, rounds, kept, merged]) =>
      record({
        branch,
        title,
        kind: branch.startsWith('fix') ? 'fix' : 'feature',
        started: iso(ago(minutes + 18)),
        step: 'landed',
        round: rounds,
        landings: [{ ...landedAt(minutes), round: rounds, merge: sha(merged) }],
        reviews: kept.map((k, i) => ({ round: i + 1, kept: k, cost: 0.1 })),
        spend: { writer: spent - 0.1, reviews: 0.1, reviewed: 1, total: spent },
        writer: [{ transcript: 0, at: iso(ago(minutes + 2)), total: spent - 0.1 }],
      }),
    ),
    record({
      branch: 'spike/drop-lodash',
      title: 'Can we drop lodash?',
      kind: 'spike',
      step: 'answered',
      spend: { writer: 0.31, reviews: 0, reviewed: 0, total: 0.31 },
      writer: [{ transcript: 0, at: iso(ago(205)), total: 0.31 }],
    }),
    ...(none
      ? []
      : [
          record({
            branch: 'fix/payment-webhook-retry',
            step: 'checking',
            round: 2,
            spend: { writer: 1.62, reviews: 0.3, reviewed: 1, total: 1.92 },
            writer: [{ transcript: 0, at: iso(ago(6)), total: 1.62 }],
            reviews: [{ round: 1, kept: 1, cost: 0.3 }],
          }),
          record({
            branch: 'feature/search-cache',
            step: 'reviewing',
            spend: { writer: 0.86, reviews: 0, reviewed: 0, total: 0.86 },
            writer: [{ transcript: 0, at: iso(ago(3)), total: 0.86 }],
          }),
          record({
            branch: 'feature/stock-levels',
            spend: { writer: 0.38, reviews: 0, reviewed: 0, total: 0.38 },
            writer: [{ transcript: 0, at: iso(ago(1)), total: 0.38 }],
          }),
          record({
            branch: 'feature/orders-csv',
            step: 'landing',
            spend: { writer: 1.12, reviews: 0, reviewed: 0, total: 1.12 },
            writer: [{ transcript: 0, at: iso(ago(2)), total: 1.12 }],
          }),
        ]),
    record({
      branch: 'feature/import-feed',
      step: 'stuck',
      round: 3,
      spend: {
        writer: budgetReached ? 4.21 : 2.4,
        reviews: 0.81,
        reviewed: 3,
        total: budgetReached ? 5.02 : 3.21,
        budget: 5,
      },
    }),
  ];
  const event = (
    minutes: number,
    branch: string,
    kind: string,
    data: Record<string, unknown> = {},
  ) => ({ at: iso(ago(minutes)), branch, source: 'hive', kind, data }) as DayEvent;
  return {
    list: {
      workspaces: [
        ...flight,
        stopped,
        ...landed.map(([branch, title, minutes, , rounds, , merged]) =>
          summary(branch, title, ago(200), {
            merged: true,
            ahead: 1,
            // When it landed, as the list carries it (V92: the sidenav's Landed today).
            hive: hive({
              step: 'landed',
              round: rounds,
              landing: { ...landedAt(minutes), round: rounds, merge: sha(merged) },
            }),
          }),
        ),
        summary('spike/drop-lodash', 'Can we drop lodash?', ago(230), {
          lastAction: iso(ago(205)),
          hive: hive({ step: 'answered' }),
        }),
      ],
      place: 'repository',
    },
    reviews: {
      defaultBranch: 'main',
      reviewer: 'reviewer@example.com',
      place: 'repository',
      reviews: [],
    },
    merges: { merges: [] },
    day: {
      since: iso(now - 7 * 86_400_000),
      into: 'main',
      events: [
        event(205, 'spike/drop-lodash', 'answered', { commits: 0 }),
        event(16, 'feature/discount-code', 'landed', {
          into: 'main',
          merge: sha('20c37bc'),
          pushed: true,
        }),
        event(14, 'feature/import-feed', 'stuck', { note: 'The check still fails' }),
        event(12, 'feature/discount-code', 'review', {
          round: 1,
          verdict: 'changes',
          kept: 1,
          cost: 0.3,
        }),
        event(10, 'feature/orders-csv', 'land-queued', { into: 'main', commit: sha('7d2e9f1') }),
        event(8, 'feature/search-cache', 'review-started', { round: 1, model: 'claude-opus-5-5' }),
        event(4, 'fix/payment-webhook-retry', 'check', {
          round: 1,
          ok: false,
          ms: 1,
          failed: 'pnpm test:e2e',
        }),
      ],
      merges: [],
      started: {},
      hive: records,
    },
    usage: usage(now, 41, budgetReached ? 92 : 63),
    pacing: { pauseAt: 90, budget: 5, read: true },
    landing: { by: 'queue', token: false },
    reviewer: {
      agents: [
        {
          kind: 'claude',
          efforts: { levels: ['low', 'medium', 'high'], default: 'high', by: 'symbiote' },
          defaultModel: { id: 'opus', by: 'symbiote' },
        },
      ],
      file: 'symbiote/config.json',
    },
  };
}

/** Answers the Overview's reads from `mocks` (read only: nothing reaches `symbiote view`). */
export async function mockOverview(page: Page, mocks: OverviewMocks): Promise<void> {
  const answer = (pattern: string, body: unknown) =>
    page.route(pattern, (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json: body }) : route.fallback(),
    );
  await answer('**/api/workspaces', mocks.list);
  await answer('**/api/reviews', mocks.reviews);
  await answer('**/api/merges', mocks.merges);
  await answer('**/api/workspaces/day?*', mocks.day);
  await answer('**/api/usage', mocks.usage);
  if (mocks.pacing) await answer('**/api/hive/pacing', mocks.pacing);
  if (mocks.landing) await answer('**/api/hive/landing', mocks.landing);
  if (mocks.reviewer) await answer('**/api/hive/reviewer/efforts', mocks.reviewer);
}
