// HV3: a Hive workspace's Review tab in words — its rounds, verdicts, findings and landing.
import { describe, expect, it } from 'vitest';
import type { HiveReview, WorkspaceHiveDetail } from '@symbiote/core';
import {
  checkWords,
  durationWords,
  findingWords,
  hiveRounds,
  landingWords,
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

  it('says where Hive is, and what landing asks', () => {
    expect(stepWords(detail({ step: 'reviewing', round: 2 }))).toBe(
      'The running reviewer at work, round 2 of 3',
    );
    expect(stepWords(detail({ step: 'landing', reviews: [review({})] }))).toBe(
      'Checked and reviewed: land it',
    );
    expect(stepWords(detail({ step: 'landing', on: false }))).toBe(
      'Hive is off: review and land it as any workspace',
    );
    expect(stepWords(detail({ step: 'checking', on: false }))).toBe(
      'Hive is off: checking, round 1 of 3, waits',
    );
    expect(landingWords({ note: 'the running review failed twice: x; review it yourself' })).toBe(
      'Not reviewed: look, then land it',
    );
    expect(landingWords({})).toBe('Checked: land it');
  });
});
