// V93 (decision 884, proofs 02, 03 and 07 of spikes/hive-redesign): a Hive workspace's pipeline
// card in Hive's words — each step's detail from what Hive recorded, the check's progress against
// its last passing run, one mark a round, and the head's pill.
import type { HiveCheck, HiveReview, WorkspaceHiveDetail } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { hivePipeline } from '../src/workspaces/hive-pipeline.js';
import { hiveSteps } from '../src/workspaces/workspace-steps.js';

const T0 = Date.parse('2026-11-03T12:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const check = (round: number, ok: boolean, over: Partial<HiveCheck> = {}): HiveCheck => ({
  round,
  at: `c${round}`.padEnd(40, '0'),
  ok,
  ms: 38_000,
  ...(ok ? {} : { failed: 'pnpm test:e2e' }),
  ...over,
});
const review = (round: number, verdict: HiveReview['verdict'], cost = 0.42): HiveReview => ({
  round,
  at: `c${round}`.padEnd(40, '0'),
  verdict,
  ms: 60_000,
  cost,
  model: 'opus',
  effort: 'high',
  findings: [],
});
const detail = (over: Partial<WorkspaceHiveDetail>): WorkspaceHiveDetail => ({
  branch: 'fix/payment-webhook-retry',
  step: 'checking',
  round: 2,
  rounds: 3,
  on: true,
  checks: [],
  reviews: [],
  tests: '',
  ...over,
});
const words = (d: WorkspaceHiveDetail, commits: number, now = T0) =>
  hivePipeline(hiveSteps({ ...d, ...(d.checks.at(-1) ? { check: d.checks.at(-1) } : {}) }), d, {
    into: 'main',
    commits,
    push: true,
    now,
  });

describe('hivePipeline', () => {
  it('checking (proof 02): the command among the check, its time against the last, a mark a round', () => {
    const live = detail({
      checks: [check(1, true)],
      reviews: [review(1, 'changes')],
      live: {
        kind: 'check',
        started: at(0),
        step: 3,
        since: at(3),
        done: [],
        commands: ['pnpm install', 'pnpm check', 'pnpm build', 'pnpm test:e2e'],
        expected: { ms: 10 * 60_000, steps: [] },
      },
    });
    const pipeline = words(live, 2, T0 + (7 * 60 + 23) * 1000);
    expect(pipeline.steps.map((s) => [s.name, s.state, s.detail])).toEqual([
      ['Write', 'done', '2 commits'],
      ['Check', 'now', '4 of 4 · 7:23 of ~10 min'],
      ['Review', 'todo', 'Opus · high'],
      ['Land', 'todo', 'merge queue → main, push'],
    ]);
    expect(pipeline.steps[1]?.progress).toBeCloseTo(0.738, 2);
    expect(pipeline.rounds).toEqual(['fail', 'run', 'todo']);
    expect(pipeline.pill).toBe('Checking · round 2 of 3');
  });

  it('landed (proof 03): its rounds, the check passed, the review approved and its cost, the merge', () => {
    const landed = detail({
      step: 'landed',
      checks: [check(1, true), check(2, true)],
      reviews: [review(1, 'changes'), review(2, 'approved')],
      landings: [
        {
          round: 2,
          at: 'c2'.padEnd(40, '0'),
          into: 'main',
          entry: 'm',
          queued: at(9),
          ended: at(10),
          outcome: 'landed',
          merge: '20c37bc'.padEnd(40, 'f'),
          pushed: { ok: true, remote: 'origin' },
        },
      ],
    });
    const pipeline = words(landed, 4);
    expect(pipeline.steps.map((s) => [s.state, s.detail])).toEqual([
      ['done', '4 commits · 2 rounds'],
      ['done', 'passed in 38 s'],
      ['done', 'approved · $0.42'],
      ['done', '20c37bc in main · pushed'],
    ]);
    expect(pipeline.rounds).toEqual(['fail', 'ok', 'todo']);
    expect(pipeline.pill).toBe('Landed in main · pushed');
  });

  it('stopped at its check (proof 07): the failing command, what never ran, every round failed', () => {
    const stopped = detail({
      step: 'stuck',
      round: 3,
      checks: [check(1, true), check(2, true), check(3, false)],
      reviews: [review(1, 'changes'), review(2, 'changes')],
    });
    const pipeline = words(stopped, 5);
    expect(pipeline.steps.map((s) => [s.state, s.detail])).toEqual([
      ['done', '5 commits · 3 rounds'],
      ['bad', 'failed: pnpm test:e2e'],
      ['todo', 'not run on round 3'],
      ['todo', 'nothing landed'],
    ]);
    expect(pipeline.rounds).toEqual(['fail', 'fail', 'fail']);
    expect(pipeline.pill).toBe('Stopped · 3 of 3 rounds');
  });

  it("a stop read from Hive's record, the list's summary without its check; its time ends there", () => {
    const stopped = detail({
      step: 'stuck',
      round: 3,
      checks: [check(3, false, { started: at(40), ms: 9 * 60_000 })],
    });
    const pipeline = hivePipeline(hiveSteps({ step: 'stuck', round: 3, rounds: 3 }), stopped, {
      into: 'main',
      commits: 5,
      push: true,
      now: T0,
    });
    expect(pipeline.steps.map((s) => s.state)).toEqual(['done', 'bad', 'todo', 'todo']);
    expect(pipeline.ended).toBe(at(49));
  });

  it('writing its first round: nothing reviewed yet, the reviewer not named', () => {
    const writing = detail({ step: 'writing', round: 1 });
    const pipeline = words(writing, 0);
    expect(pipeline.steps.map((s) => s.detail)).toEqual([
      'writing',
      'the check',
      'proves defects',
      'merge queue → main, push',
    ]);
    expect(pipeline.rounds).toEqual(['run', 'todo', 'todo']);
    expect(pipeline.pill).toBe('Writing · round 1 of 3');
  });
});
