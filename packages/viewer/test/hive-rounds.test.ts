// HV3, HV4: a Hive workspace's Review tab in words — its rounds, verdicts, findings and landings.
import { describe, expect, it } from 'vitest';
import type { HiveLanding, HiveReview, WorkspaceHiveDetail } from '@symbiote/core';
import {
  checkWords,
  durationWords,
  findingWords,
  hiveRounds,
  landedLine,
  landingLine,
  landingOutcome,
  stepWords,
  verdictWords,
} from '../src/workspaces/hive-rounds.js';

const TIP = 'b'.repeat(40);
const review = (over: Partial<HiveReview>): HiveReview => ({
  round: 1,
  at: TIP,
  verdict: 'approved',
  ms: 90_000,
  findings: [],
  ...over,
});
const landing = (over: Partial<HiveLanding>): HiveLanding => ({
  round: 1,
  at: TIP,
  into: 'main',
  entry: 'm1',
  queued: '2026-11-02T10:00:00.000Z',
  pushed: { ok: true, remote: 'origin' },
  ...over,
});
const detail = (over: Partial<WorkspaceHiveDetail>): WorkspaceHiveDetail => ({
  branch: 'feature/x',
  step: 'writing',
  round: 1,
  rounds: 3,
  on: true,
  checks: [],
  reviews: [],
  tests: '/s/hive/feature/x',
  ...over,
});

describe("a Hive workspace's Review tab (HV3)", () => {
  it('puts each check and review in its round, the newest round first', () => {
    const rounds = hiveRounds({
      checks: [
        { round: 1, at: TIP, ok: false, ms: 1 },
        { round: 2, at: TIP, ok: true, ms: 1 },
        { round: 3, at: TIP, ok: true, ms: 1 },
      ],
      reviews: [review({ round: 2, verdict: 'changes' }), review({ round: 3 })],
    });
    expect(rounds.map((r) => [r.round, r.checks.length, r.reviews.length])).toEqual([
      [3, 1, 1],
      [2, 1, 1],
      [1, 1, 0],
    ]);
  });

  it('says a verdict, a finding and a check in words', () => {
    const kept = { defect: 'd', test: 't', command: 'c', files: [], kept: true };
    expect(verdictWords(review({ verdict: 'changes', findings: [kept, kept] }))).toEqual({
      text: '2 defects proven',
      tone: 'bad',
    });
    expect(verdictWords(review({}))).toEqual({ text: 'Approved', tone: 'ok' });
    expect(verdictWords(review({ verdict: 'failed' })).text).toBe('No answer');
    expect(verdictWords(review({ verdict: 'unavailable' })).text).toBe('Not run');
    expect(findingWords(kept)).toEqual({ text: 'Proven', why: undefined });
    expect(
      findingWords({ ...kept, kept: false, why: "its test passed on Symbiote's rerun" }),
    ).toEqual({ text: 'Dropped', why: "its test passed on Symbiote's rerun" });
    expect(checkWords({ round: 1, at: TIP, ok: true, ms: 400_000 })).toBe('Passed in 6 min 40 s');
    expect(durationWords(12_400)).toBe('12 s');
    expect(durationWords(3_900_000)).toBe('1 h 5 min');
  });

  it('says where Hive is: its step, its landing, its stop (HV4)', () => {
    expect(stepWords(detail({ step: 'reviewing', round: 2 }))).toBe(
      'The running reviewer at work, round 2 of 3',
    );
    expect(stepWords(detail({ step: 'landing' }))).toBe('Hive: landing it');
    expect(stepWords(detail({ step: 'landing', landings: [landing({ state: 'checking' })] }))).toBe(
      'Landing in main: checking the merge',
    );
    expect(stepWords(detail({ step: 'landed', landings: [landing({ outcome: 'landed' })] }))).toBe(
      'Landed in main · pushed',
    );
    expect(stepWords(detail({ step: 'stuck', note: 'could not land in main 3 times: x' }))).toBe(
      'Stopped: could not land in main 3 times: x',
    );
    expect(stepWords(detail({ step: 'answered' }))).toBe('Answered: read its report');
    expect(stepWords(detail({ step: 'landing', on: false }))).toBe(
      'Hive is off: review and land it as any workspace',
    );
    expect(stepWords(detail({ step: 'checking', on: false }))).toBe(
      'Hive is off: checking, round 1 of 3, waits',
    );
  });

  it("says a landing's place in the queue, and how it ended", () => {
    expect(landingLine(undefined)).toBe('Hive: landing it');
    expect(landingLine(landing({}))).toBe('Landing in main: queued');
    expect(landingLine(landing({ state: 'merging' }))).toBe('Landing in main: merging');
    expect(landingLine(landing({ state: 'ready' }))).toBe(
      'Landing in main: waiting for your checkout',
    );
    // A landing that ended: the next one is not queued yet.
    expect(landingLine(landing({ outcome: 'conflict' }))).toBe('Hive: landing it');
    expect(landedLine(landing({ outcome: 'landed' }))).toBe('Landed in main · pushed');
    expect(
      landedLine(
        landing({ outcome: 'landed', pushed: { ok: false, remote: 'origin', error: 'no' } }),
      ),
    ).toBe('Landed in main · not pushed: no');
    expect(landedLine(undefined)).toBe('Merged');
    expect(landingOutcome(landing({ outcome: 'conflict', files: ['a.ts', 'b.ts'] }))).toBe(
      'Conflicts with main: a.ts, b.ts',
    );
    expect(landingOutcome(landing({ outcome: 'check-failed', failed: 'pnpm check' }))).toBe(
      'The check failed on the merge: pnpm check',
    );
  });
});
