// V91: the Overview's events of today, in words — normal mode's from the threads, the queue and
// git's merges; Hive's from its log. Only today's (local), the newest first; nothing made up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DayEvent, MergeEntry, WorkspaceDay, WorkspaceSummary } from '@symbiote/core';
import { hiveFeed, normalFeed } from '../src/overview/feed.js';
import type { MergedRow } from '../src/overview/normal-overview.js';

const zone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Bucharest';
});
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

const NOW = Date.parse('2026-11-03T11:00:00.000Z');
const today = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 3, (h ?? 0) - 2, m ?? 0)).toISOString();
};
const YESTERDAY = '2026-11-02T21:59:59.999Z';

const summary = (branch: string, over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  branch,
  base: 'a'.repeat(40),
  from: 'main',
  created: today('08:00'),
  planFirst: false,
  brief: 'A brief',
  worktree: { path: `/work/${branch}`, exists: true, changed: 0 },
  tip: 'b'.repeat(40),
  ahead: 0,
  merged: false,
  agent: { state: 'done', kind: 'claude' },
  ...over,
});

const thread = (
  branch: string,
  at: string,
  kind: string,
  extra: Partial<DayEvent> = {},
): DayEvent => ({
  at,
  branch,
  source: 'thread',
  kind,
  ...extra,
});
const hive = (
  branch: string,
  at: string,
  kind: string,
  data: Record<string, unknown> = {},
): DayEvent => ({
  at,
  branch,
  source: 'hive',
  kind,
  data,
});

const day = (events: DayEvent[], started: Record<string, string> = {}): WorkspaceDay => ({
  since: '2026-10-27T22:00:00.000Z',
  into: 'main',
  events,
  merges: [],
  started,
  hive: [],
});

describe("normal mode's events", () => {
  const list = [
    summary('fix/shipping-tax', { title: 'Charge tax on shipping' }),
    summary('feature/saved-carts', { title: 'Save a cart for later', planFirst: true }),
    summary('feature/discount-code', { title: 'Add a discount code', ahead: 3 }),
    summary('spike/catalog-search', { title: 'Which search library fits the catalog?' }),
    summary('feature/new', { title: 'A new one' }),
  ];
  const events = [
    thread('fix/shipping-tax', today('12:52'), 'asks', {
      data: { tool: 'AskUserQuestion' },
      text: 'Tax shipping?',
    }),
    thread('fix/shipping-tax', today('12:53'), 'asks', { data: { tool: 'Bash' } }),
    thread('feature/saved-carts', today('12:49'), 'report', {
      data: { answered: false },
      text: '# Plan',
    }),
    thread('feature/discount-code', today('12:46'), 'report', { data: { answered: true } }),
    thread('spike/catalog-search', today('12:47'), 'report', { data: { answered: true } }),
    // The person's own message, and yesterday's: not today's events.
    thread('fix/shipping-tax', today('12:54'), 'prompt', { text: 'EU only' }),
    thread('fix/shipping-tax', YESTERDAY, 'asks', { data: { tool: 'AskUserQuestion' } }),
    // Hive's log in normal mode: not shown.
    hive('fix/shipping-tax', today('12:00'), 'check', { ok: true }),
  ];
  const queued: MergeEntry = {
    id: 'm1',
    branch: 'fix/order-total-rounding',
    head: 'c'.repeat(40),
    into: 'main',
    title: 'Merge fix/order-total-rounding: Fix order total rounding',
    state: 'checking',
    queued: today('12:50'),
    updated: today('12:51'),
  };
  const merged: MergedRow[] = [
    {
      sha: '3c1e0f2'.padEnd(40, '0'),
      at: today('11:20'),
      title: 'Email a receipt after checkout',
      into: 'main',
      pushed: true,
      by: 'you',
    },
    {
      sha: '5a77b31'.padEnd(40, '0'),
      at: today('10:02'),
      title: 'Rename the coupon field',
      into: 'main',
      pushed: false,
    },
    { sha: '0e44b7d'.padEnd(40, '0'), at: YESTERDAY, title: 'Old', into: 'main', pushed: true },
  ];
  const feed = () =>
    normalFeed(
      day(events, { 'feature/new': today('09:00'), old: YESTERDAY }),
      [queued],
      merged,
      list,
      NOW,
    );

  it('says each in words, the newest first, today only', () => {
    expect(feed().map((item) => [item.at.slice(11, 16), item.what, item.about, item.tone])).toEqual(
      [
        ['10:53', 'Asked for a permission', 'Charge tax on shipping', 'you'],
        ['10:52', 'Asked you a question', 'Charge tax on shipping', 'you'],
        ['10:50', 'Queued to merge into main', 'Fix order total rounding · you approved', 'run'],
        ['10:49', 'Plan ready', 'Save a cart for later', 'you'],
        ['10:47', 'Answered with a report', 'Which search library fits the catalog?', 'you'],
        ['10:46', 'Ready for review', 'Add a discount code', 'you'],
        [
          '09:20',
          'Merged into main, pushed',
          'Email a receipt after checkout · 3c1e0f2 · you approved',
          'ok',
        ],
        ['08:02', 'Merged into main', 'Rename the coupon field · 5a77b31', 'ok'],
        ['07:00', 'Started', 'A new one', 'idle'],
      ],
    );
  });

  it('is empty before the day read and without a queue', () => {
    expect(normalFeed(null, [], [], [], NOW)).toEqual([]);
  });
});

describe("Hive's events", () => {
  const list = [summary('fix/payment', { title: 'Retry failed payment webhooks' })];
  const base = day([
    hive('fix/payment', today('12:52'), 'check', {
      round: 2,
      ok: false,
      ms: 1,
      failed: 'pnpm test:e2e',
    }),
    hive('fix/payment', today('12:51'), 'check', { round: 1, ok: true, ms: 1 }),
    hive('fix/payment', today('12:50'), 'review-started', { round: 1, model: 'claude-opus-5-5' }),
    hive('fix/payment', today('12:49'), 'review', {
      round: 1,
      verdict: 'changes',
      kept: 2,
      cost: 0.3,
    }),
    hive('fix/payment', today('12:48'), 'review', { round: 1, verdict: 'approved', kept: 0 }),
    hive('fix/payment', today('12:47'), 'land-queued', {
      into: 'main',
      entry: 'm1',
      commit: '7d2e9f1'.padEnd(40, '0'),
    }),
    hive('feature/cleaned', today('12:46'), 'landed', {
      into: 'main',
      merge: '20c37bc'.padEnd(40, '0'),
      pushed: true,
    }),
    hive('feature/import', today('12:45'), 'stuck', { note: 'The check still fails' }),
    hive('fix/payment', today('12:44'), 'land-failed', { outcome: 'conflict', into: 'main' }),
    hive('spike/lodash', today('12:43'), 'answered', { commits: 0 }),
    hive('fix/payment', today('12:42'), 'paused', { reason: 'usage' }),
    hive('fix/payment', today('12:41'), 'started'),
    // Noise Hive writes for itself, and a thread's: not shown.
    hive('fix/payment', today('12:40'), 'turn-ended', { round: 1 }),
    hive('fix/payment', today('12:39'), 'message', { key: 'x' }),
    thread('fix/payment', today('12:38'), 'report'),
    hive('fix/payment', YESTERDAY, 'check', { round: 1, ok: true }),
  ]);
  base.hive = [
    {
      branch: 'feature/cleaned',
      title: 'Add a discount code',
      started: today('08:00'),
      step: 'landed',
      round: 2,
      rounds: 3,
      reviews: [],
      spend: { reviews: 0, reviewed: 0, total: 0 },
      finished: today('12:50'),
    },
  ];

  it('says each in words, the newest first, today only', () => {
    expect(
      hiveFeed(base, list, NOW).map((item) => [item.what, item.about, item.tone, item.icon]),
    ).toEqual([
      ['Check failed: pnpm test:e2e', 'Retry failed payment webhooks · round 2', 'fail', 'check'],
      ['Check passed', 'Retry failed payment webhooks · round 1', 'ok', 'check'],
      ['Running review started', 'Retry failed payment webhooks · Opus 5.5', 'run', 'review'],
      [
        '2 defects proven by failing tests',
        'Retry failed payment webhooks · round 1',
        'fail',
        'bug',
      ],
      [
        'Review passed: no defect proven',
        'Retry failed payment webhooks · round 1',
        'ok',
        'review',
      ],
      ['Queued to land in main', 'Retry failed payment webhooks · 7d2e9f1', 'run', 'merge'],
      ['Landed in main, pushed', 'Add a discount code · 20c37bc', 'ok', 'merge'],
      ['Stopped', 'feature/import · The check still fails', 'fail', 'stopped'],
      ['Landing failed: conflict', 'Retry failed payment webhooks', 'fail', 'merge'],
      ['Answered with a report', 'spike/lodash', 'ok', 'answered'],
      ['Paused for usage', 'Retry failed payment webhooks', 'info', 'pause'],
      ['Started from its brief', 'Retry failed payment webhooks', 'idle', 'start'],
    ]);
  });
});
