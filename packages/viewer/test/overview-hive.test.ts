// V91 (decisions 856–857): Hive mode's Overview from what Hive records — in flight, stopped, landed
// today, the five figures; spend today by the local day: each review's cost by its event's time,
// the writer by its transcripts' totals since local midnight.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CostPoint,
  DayEvent,
  HiveDayRecord,
  WorkspaceDay,
  WorkspaceHive,
  WorkspaceSummary,
} from '@symbiote/core';
import {
  flightRows,
  hiveFigures,
  landedRows,
  spendSince,
  stoppedRows,
  writerSpendSince,
  type HiveFigures,
  type LandedRow,
} from '../src/overview/hive-overview.js';

const zone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Bucharest';
});
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

// 3 November 2026, 13:00 local (UTC+2); its midnight is 2 November, 22:00 UTC.
const NOW = Date.parse('2026-11-03T11:00:00.000Z');
const MIDNIGHT = Date.parse('2026-11-02T22:00:00.000Z');
const today = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 3, (h ?? 0) - 2, m ?? 0)).toISOString();
};
const yesterday = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 2, (h ?? 0) - 2, m ?? 0)).toISOString();
};

const summary = (
  branch: string,
  hive: Partial<WorkspaceHive>,
  title = branch,
): WorkspaceSummary => ({
  branch,
  title,
  kind: 'feature',
  base: 'a'.repeat(40),
  from: 'main',
  created: today('08:00'),
  planFirst: false,
  brief: 'A brief',
  worktree: { path: `/work/${branch}`, exists: true, changed: 0 },
  tip: 'b'.repeat(40),
  ahead: 1,
  merged: false,
  agent: { state: 'working', kind: 'claude' },
  hive: { step: 'writing', round: 1, rounds: 3, ...hive },
});

const record = (branch: string, over: Partial<HiveDayRecord> = {}): HiveDayRecord => ({
  branch,
  started: today('08:00'),
  step: 'writing',
  round: 1,
  rounds: 3,
  reviews: [],
  spend: { reviews: 0, reviewed: 0, total: 0 },
  ...over,
});

const event = (
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

const landing = (over: Record<string, unknown>) => ({
  round: 1,
  at: 'c'.repeat(40),
  into: 'main',
  entry: 'm1',
  queued: today('08:00'),
  outcome: 'landed' as const,
  ...over,
});

const list: WorkspaceSummary[] = [
  summary(
    'fix/payment-webhook-retry',
    { step: 'checking', round: 2 },
    'Retry failed payment webhooks',
  ),
  summary('feature/search-cache', { step: 'reviewing' }),
  summary('feature/stock-levels', { step: 'writing' }),
  summary('feature/orders-csv', { step: 'landing' }),
  summary(
    'feature/import-feed',
    { step: 'stuck', round: 3, note: 'The check still fails: pnpm test:e2e' },
    'Import products from a supplier feed',
  ),
  summary('feature/discount-code', { step: 'landed', round: 2 }, 'Add a discount code'),
  // Hive off (a workspace whose step waits): not in flight.
  summary('feature/off', { step: 'writing', off: true, paused: true }),
];

const writer = (...points: [number, string, number][]): CostPoint[] =>
  points.map(([transcript, at, total]) => ({ transcript, at, total }));

const day: WorkspaceDay = {
  since: '2026-10-27T22:00:00.000Z',
  into: 'main',
  started: {},
  merges: [],
  events: [
    event('feature/discount-code', today('12:20'), 'review', {
      round: 1,
      verdict: 'changes',
      kept: 1,
      cost: 0.3,
    }),
    event('feature/discount-code', today('12:40'), 'review', {
      round: 2,
      verdict: 'approved',
      kept: 0,
      cost: 0.2,
    }),
    event('fix/tax', today('11:50'), 'review', {
      round: 1,
      verdict: 'approved',
      kept: 0,
      cost: 0.1,
    }),
    event('fix/payment-webhook-retry', today('10:30'), 'review', {
      round: 1,
      verdict: 'changes',
      kept: 2,
      cost: 0.25,
    }),
    event('feature/paginate', yesterday('10:00'), 'review', {
      round: 1,
      verdict: 'changes',
      kept: 2,
      cost: 0.5,
    }),
    event('spike/lodash', today('09:12'), 'answered', { commits: 0 }),
    // A thread's event is never Hive's spend.
    { at: today('09:00'), branch: 'spike/lodash', source: 'thread', kind: 'report', text: 'Yes' },
  ],
  hive: [
    record('feature/discount-code', {
      title: 'Add a discount code',
      started: today('12:26'),
      step: 'landed',
      round: 2,
      landings: [
        landing({
          round: 2,
          ended: today('12:44'),
          merge: '20c37bc'.padEnd(40, '0'),
          pushed: { ok: true, remote: 'origin' },
        }),
      ],
      reviews: [
        { round: 1, kept: 1, cost: 0.3 },
        { round: 2, kept: 0, cost: 0.2 },
      ],
      spend: { writer: 0.34, reviews: 0.5, reviewed: 2, total: 0.84 },
      writer: writer([0, yesterday('23:00'), 0.1], [0, today('12:30'), 0.34]),
    }),
    record('fix/tax', {
      title: 'Fix tax rounding on invoices',
      started: today('11:30'),
      step: 'landed',
      landings: [
        landing({
          via: 'request',
          entry: '#12',
          ended: today('11:58'),
          merge: '8f3e1a2'.padEnd(40, '0'),
        }),
      ],
      request: {
        forge: 'github',
        number: 12,
        url: 'https://github.com/acme/shop/pull/12',
        into: 'main',
        at: 'c'.repeat(40),
        opened: today('11:52'),
        state: 'merged',
      },
      reviews: [{ round: 1, kept: 0, cost: 0.1 }],
      spend: { writer: 0.41, reviews: 0.1, reviewed: 1, total: 0.51 },
      writer: writer([0, today('11:50'), 0.41]),
    }),
    record('feature/unpushed', {
      started: today('09:00'),
      step: 'landed',
      landings: [
        landing({
          ended: today('10:00'),
          merge: 'd'.repeat(40),
          pushed: { ok: false, remote: 'origin', error: 'rejected' },
        }),
      ],
      spend: { reviews: 0, reviewed: 0, total: 0.5 },
    }),
    record('spike/lodash', {
      title: 'Can we drop lodash?',
      kind: 'spike',
      started: today('09:00'),
      step: 'answered',
      spend: { writer: 0.31, reviews: 0, reviewed: 0, total: 0.31 },
      writer: writer([0, today('09:10'), 0.31]),
    }),
    record('feature/paginate', {
      title: 'Paginate the order history',
      started: yesterday('09:00'),
      step: 'landed',
      round: 3,
      landings: [
        landing({ round: 3, ended: yesterday('10:27'), pushed: { ok: true, remote: 'origin' } }),
      ],
      reviews: [{ round: 1, kept: 2, cost: 0.5 }],
      spend: { reviews: 0.5, reviewed: 1, total: 2.1 },
    }),
    record('fix/payment-webhook-retry', {
      step: 'checking',
      round: 2,
      reviews: [{ round: 1, kept: 2, cost: 0.25 }],
      spend: { writer: 1.7, reviews: 0.25, reviewed: 1, total: 1.92 },
      // Two transcripts: the first from yesterday evening, a resume today.
      writer: writer(
        [0, yesterday('22:00'), 1.0],
        [0, today('10:00'), 1.5],
        [1, today('12:00'), 0.2],
      ),
    }),
  ],
};

describe("the writer's spend by day", () => {
  it('is each transcript’s growth since midnight: its last total less its last before', () => {
    expect(writerSpendSince([], MIDNIGHT)).toBe(0);
    // Only before midnight: nothing today.
    expect(writerSpendSince(writer([0, yesterday('20:00'), 2]), MIDNIGHT)).toBe(0);
    expect(
      writerSpendSince(
        writer([0, yesterday('22:00'), 1.0], [0, today('10:00'), 1.5], [1, today('12:00'), 0.2]),
        MIDNIGHT,
      ),
    ).toBeCloseTo(0.7, 10);
    // A total at midnight itself is today's.
    expect(writerSpendSince(writer([0, today('00:00'), 0.4]), MIDNIGHT)).toBeCloseTo(0.4, 10);
  });

  it('adds the reviews whose events are today', () => {
    const payment = day.hive.find((r) => r.branch === 'fix/payment-webhook-retry');
    const paginate = day.hive.find((r) => r.branch === 'feature/paginate');
    if (!payment || !paginate) throw new Error('fixture');
    expect(spendSince(payment, day.events, MIDNIGHT)).toBeCloseTo(0.95, 10);
    expect(spendSince(paginate, day.events, MIDNIGHT)).toBe(0);
  });
});

describe('the workspaces', () => {
  it('lists those in flight with their spend, and not one Hive is off for', () => {
    const rows = flightRows(list, day);
    expect(rows.map((r) => [r.workspace.branch, r.hive.step, r.spend?.total])).toEqual([
      ['fix/payment-webhook-retry', 'checking', 1.92],
      ['feature/search-cache', 'reviewing', undefined],
      ['feature/stock-levels', 'writing', undefined],
      ['feature/orders-csv', 'landing', undefined],
    ]);
  });

  it('calls out a stopped one with why', () => {
    expect(stoppedRows(list)).toEqual([
      {
        branch: 'feature/import-feed',
        title: 'Import products from a supplier feed',
        note: 'The check still fails: pnpm test:e2e',
        round: 3,
        rounds: 3,
      },
    ]);
  });

  it('lists what landed and what was answered, the newest first', () => {
    const rows: LandedRow[] = landedRows(day, list);
    expect(rows.map((r) => r.branch)).toEqual([
      'feature/discount-code',
      'fix/tax',
      'feature/unpushed',
      'spike/lodash',
      'feature/paginate',
    ]);
    expect(rows[0]).toEqual({
      branch: 'feature/discount-code',
      title: 'Add a discount code',
      kind: 'feature',
      at: today('12:44'),
      rounds: 2,
      defects: 1,
      answered: false,
      merge: '20c37bc'.padEnd(40, '0'),
      pushed: true,
      spend: 0.84,
    });
    expect(rows[1]).toMatchObject({
      request: '#12 on GitHub',
      pushed: true,
      rounds: 1,
      defects: 0,
    });
    expect(rows[2]).toMatchObject({ pushed: false });
    expect(rows[3]).toMatchObject({
      title: 'Can we drop lodash?',
      kind: 'spike',
      answered: true,
      at: today('09:12'),
      spend: 0.31,
    });
    expect(rows[3]?.merge).toBeUndefined();
  });
});

describe('the five figures', () => {
  let figures: HiveFigures;
  beforeAll(() => {
    figures = hiveFigures(list, day, NOW);
  });

  it('counts those in flight by stage', () => {
    expect(figures.inFlight).toEqual({
      count: 4,
      byStage: { write: 1, check: 1, review: 1, land: 1 },
    });
  });

  it('counts landings by local day (not the answered spike), and those not pushed', () => {
    expect(figures.landed).toEqual({ today: 3, perDay: [0, 0, 0, 0, 0, 1, 3], notPushed: 1 });
  });

  it('counts today’s defects proven by failing tests, and those of workspaces landed since', () => {
    expect(figures.defects).toEqual({ today: 3, fixed: 1 });
  });

  it('takes the median from brief to landed over today’s landings', () => {
    // 18, 28 and 60 minutes.
    expect(figures.timeToLand).toEqual({ medianMs: 28 * 60_000, count: 3 });
  });

  it('spends today what was spent since local midnight; per landing, today’s rows on average', () => {
    expect(figures.spend.today).toBeCloseTo(0.74 + 0.51 + 0.31 + 0.95, 10);
    expect(figures.spend.workspaces).toBe(4);
    expect(figures.spend.perLanding).toBeCloseTo((0.84 + 0.51 + 0.5 + 0.31) / 4, 10);
  });

  it('is all nought before the day read, and none in flight', () => {
    const empty = hiveFigures([], null, NOW);
    expect(empty).toEqual({
      inFlight: { count: 0, byStage: { write: 0, check: 0, review: 0, land: 0 } },
      landed: { today: 0, perDay: [0, 0, 0, 0, 0, 0, 0], notPushed: 0 },
      defects: { today: 0, fixed: 0 },
      timeToLand: { medianMs: null, count: 0 },
      spend: { today: 0, perLanding: null, workspaces: 0 },
    });
  });
});
