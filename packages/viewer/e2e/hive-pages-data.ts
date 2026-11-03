// Hive's pages as the proofs draw them (V92; `spikes/hive-redesign` 02-run-live, 03-run-landed,
// 07-run-stopped): each workspace's detail, its changes and its running check's log, answered by
// `page.route` over a real `symbiote view`, beside the Overview's list (overview-data.ts).
import type { Page } from '@playwright/test';
import type {
  HiveCheck,
  HiveReview,
  WorkspaceChanges,
  WorkspaceCommit,
  WorkspaceHiveDetail,
} from '@symbiote/core';

const MINUTE = 60_000;
const iso = (t: number) => new Date(t).toISOString();
const sha = (start: string) => start.padEnd(40, '0');

export const LIVE = 'fix/payment-webhook-retry';
export const LANDED = 'feature/discount-code';
export const STOPPED = 'feature/import-feed';

const COMMANDS = ['pnpm install --frozen-lockfile', 'pnpm check', 'pnpm build', 'pnpm test:e2e'];

const commit = (c: string, subject: string, at: number, added: number, removed: number) =>
  ({ sha: sha(c), subject, author: 'Claude', date: iso(at), added, removed }) as WorkspaceCommit;

const changes = (branch: string, commits: WorkspaceCommit[]): WorkspaceChanges => ({
  branch,
  base: 'a'.repeat(40),
  tip: commits[0]?.sha ?? 'a'.repeat(40),
  commits: { count: commits.length, listed: commits },
  files: {
    count: 2,
    added: commits.reduce((n, c) => n + (c.added ?? 0), 0),
    removed: commits.reduce((n, c) => n + (c.removed ?? 0), 0),
    listed: [
      { status: 'modified', path: 'src/payments/webhooks.ts', added: 38, removed: 7 },
      { status: 'added', path: 'test/webhook-retry.test.ts', added: 52, removed: 0 },
    ],
  },
  uncommitted: { count: 0, listed: [] },
});

const passed = (round: number, at: string, started: number, ms: number[]): HiveCheck => ({
  round,
  at,
  ok: true,
  ms: ms.reduce((a, b) => a + b, 0),
  started: iso(started),
  commands: COMMANDS,
  steps: COMMANDS.map((command, i) => ({ command, ok: true, ms: ms[i] ?? 0 })),
  log: `check-${round}`,
});

const review = (over: Partial<HiveReview> & Pick<HiveReview, 'round' | 'at'>): HiveReview => ({
  verdict: 'approved',
  ms: 91_000,
  cost: 0.42,
  model: 'opus',
  effort: 'high',
  findings: [],
  ...over,
});

const detail = (over: Partial<WorkspaceHiveDetail> & Pick<WorkspaceHiveDetail, 'branch'>) =>
  ({
    step: 'writing',
    round: 1,
    rounds: 3,
    on: true,
    checks: [],
    reviews: [],
    tests: `/s/hive/${over.branch}`,
    ...over,
  }) as WorkspaceHiveDetail;

/** The three workspaces of the proofs: checking round 2, landed in 2 rounds, stopped at 3. */
export function hivePages(now = Date.now()) {
  const ago = (minutes: number) => now - minutes * MINUTE;
  const live = detail({
    branch: LIVE,
    step: 'checking',
    round: 2,
    checked: sha('a91f3c2'),
    checks: [passed(1, sha('5c2d8e0'), ago(16), [21_000, 118_000, 52_000, 231_000])],
    reviews: [
      review({
        round: 1,
        at: sha('5c2d8e0'),
        verdict: 'changes',
        cost: 0.44,
        findings: [
          {
            defect: 'A webhook the provider calls gone (410) is still retried',
            test: 'does not retry a 410 Gone',
            command: 'node --test test/webhook-410.test.ts',
            files: ['test/webhook-410.test.ts'],
            kept: true,
            code: 1,
          },
        ],
      }),
    ],
    live: {
      kind: 'check',
      started: iso(ago(7.38)),
      commands: COMMANDS,
      step: 3,
      since: iso(ago(4.2)),
      done: [
        { ok: true, ms: 21_000 },
        { ok: true, ms: 118_000 },
        { ok: true, ms: 52_000 },
      ],
      log: 'check-2',
      expected: { ms: 10 * MINUTE, steps: [21_000, 118_000, 52_000, 7 * MINUTE] },
    },
    spend: { writer: 1.48, reviews: 0.44, reviewed: 1, total: 1.92, budget: 5 },
    pushed: { at: iso(ago(8)), sha: sha('0e44b7d'), ok: true },
  });
  const landed = detail({
    branch: LANDED,
    step: 'landed',
    round: 2,
    checked: sha('20c37bc'),
    checks: [
      passed(1, sha('97ddb55'), ago(28), [5_000, 12_000, 9_000, 15_000]),
      passed(2, sha('20c37bc'), ago(22), [5_000, 11_000, 9_000, 13_000]),
    ],
    reviews: [
      review({
        round: 1,
        at: sha('97ddb55'),
        verdict: 'changes',
        findings: [
          {
            defect: 'applyCode refuses " save10 ": a code typed with spaces still applies',
            test: 'a code typed with spaces still applies',
            command: 'node --test test/review-spaces.test.ts',
            files: ['test/review-spaces.test.ts'],
            kept: true,
            code: 1,
          },
        ],
      }),
      review({
        round: 2,
        at: sha('20c37bc'),
        summary:
          'Codes are trimmed and matched in any case; the receipt shows the discount. Ran the cart and checkout tests and a code typed with spaces, in capitals and empty.',
        ran: 'pnpm vitest run test/cart',
      }),
    ],
    landings: [
      {
        round: 2,
        at: sha('20c37bc'),
        into: 'main',
        entry: 'm1',
        queued: iso(ago(18)),
        ended: iso(ago(16)),
        outcome: 'landed',
        merge: sha('20c37bc'),
        pushed: { ok: true, remote: 'origin' },
      },
    ],
    pushed: { at: iso(ago(16)), sha: sha('20c37bc'), ok: true },
    spend: { writer: 0, reviews: 0.84, reviewed: 2, total: 0.84, budget: 5 },
  });
  const stopped = detail({
    branch: STOPPED,
    step: 'stuck',
    round: 3,
    note: 'the check failed 3 times: pnpm test:e2e',
    checks: [
      { round: 1, at: sha('71d4f08'), ok: false, ms: 121_000, failed: 'pnpm check' },
      passed(2, sha('e0c2a97'), ago(40), [20_000, 111_000, 49_000, 192_000]),
      {
        round: 3,
        at: sha('4f1c0aa'),
        ok: false,
        ms: 588_000,
        started: iso(ago(23)),
        failed: 'pnpm test:e2e',
        commands: COMMANDS,
        steps: [
          { command: COMMANDS[0] ?? '', ok: true, ms: 20_000 },
          { command: COMMANDS[1] ?? '', ok: true, ms: 111_000 },
          { command: COMMANDS[2] ?? '', ok: true, ms: 49_000 },
          { command: COMMANDS[3] ?? '', ok: false, ms: 408_000 },
        ],
        output:
          '✗ import › imports a 10,000-row feed (30.0 s)\n  Test timeout of 30000ms exceeded.\n  at test/e2e/import.spec.ts:41:5\n1 failed, 63 passed (6.8 min)',
        log: 'check-3',
      },
    ],
    reviews: [
      review({
        round: 2,
        at: sha('e0c2a97'),
        verdict: 'changes',
        cost: 0.51,
        findings: [
          {
            defect: 'A quoted comma splits a row into two columns',
            test: 'keeps a quoted comma',
            command: 'node --test test/review-quotes.test.ts',
            files: ['test/review-quotes.test.ts'],
            kept: true,
            code: 1,
          },
        ],
      }),
    ],
    pushed: { at: iso(ago(25)), sha: sha('4f1c0aa'), ok: true },
    spend: { writer: 2.89, reviews: 0.51, reviewed: 1, total: 3.4, budget: 5 },
  });
  return {
    details: { [LIVE]: live, [LANDED]: landed, [STOPPED]: stopped } as Record<
      string,
      WorkspaceHiveDetail
    >,
    changes: {
      [LIVE]: changes(LIVE, [
        commit('0e44b7d', 'Cover a 410 in the retry test', ago(8), 18, 2),
        commit('a91f3c2', 'Stop retrying a webhook the provider says is gone', ago(9), 16, 4),
        commit('5c2d8e0', 'Back off between webhook retries', ago(15), 40, 3),
        commit('3b9a1f4', 'Retry a failed payment webhook', ago(17), 67, 0),
      ]),
      [LANDED]: changes(LANDED, [
        commit('20c37bc', 'Trim a code before it is matched', ago(23), 2, 1),
        commit('f299285', "Add the reviewer's test for spaces", ago(24), 10, 0),
        commit('97ddb55', 'Apply a code to the order total', ago(28), 25, 1),
        commit('d1308ed', 'Add discount codes to the cart', ago(29), 10, 0),
      ]),
      [STOPPED]: changes(STOPPED, [
        commit('4f1c0aa', 'Stream the feed instead of reading it whole', ago(32), 22, 14),
        commit('b83e5d1', 'Keep a quoted comma in its column', ago(46), 30, 0),
        commit('e0c2a97', "Add the reviewer's test for quotes", ago(48), 13, 0),
        commit('71d4f08', 'Fix two lint errors in the parser', ago(56), 4, 0),
        commit('2a6b9c3', 'Import products from a CSV feed', ago(59), 119, 0),
      ]),
    } as Record<string, WorkspaceChanges>,
    /** The running check's log: the e2e command's last lines. */
    log: [
      { at: ago(4.2), step: 'check', title: 'pnpm test:e2e' },
      {
        at: ago(1),
        out: '12:52:31 ✓ webhooks › retries a 503 with backoff (1.2 s)\n12:52:33 ✓ webhooks › gives up after 5 tries (0.9 s)\n',
      },
      {
        at: ago(0.5),
        out: '12:52:34 ✓ webhooks › does not retry a 410 Gone (0.4 s)\n12:52:41 › checkout › pays with a saved card …\n',
      },
    ],
  };
}

/** Answers each Hive workspace's detail, changes and log reads from `pages` (read only). */
export async function mockHivePages(page: Page, pages = hivePages()): Promise<void> {
  const branchOf = (url: string) => new URL(url).searchParams.get('branch') ?? '';
  await page.route('**/api/workspaces/hive?*', (route) => {
    const found = pages.details[branchOf(route.request().url())];
    return found ? route.fulfill({ json: found }) : route.fallback();
  });
  await page.route('**/api/workspaces/changes?*', (route) => {
    const found = pages.changes[branchOf(route.request().url())];
    return found ? route.fulfill({ json: found }) : route.fallback();
  });
  await page.route('**/api/workspaces/hive/log?*', (route) =>
    route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body: `event: lines\ndata: ${JSON.stringify({ lines: pages.log, next: 1 })}\n\n`,
    }),
  );
}
