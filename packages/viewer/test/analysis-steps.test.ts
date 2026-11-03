import { describe, expect, it } from 'vitest';
import {
  analysisSteps,
  clockTime,
  endedSteps,
  seePhase,
  stepTime,
} from '../src/diff/analysis-steps.js';

const marks = (phase: string | null, queued = 0) =>
  analysisSteps(phase, queued).map((step) => `${step.mark} ${step.name}`);

describe("an analysis's steps (V71, decision 504)", () => {
  it('runs its first step before a phase is reported', () => {
    expect(marks(null)).toEqual([
      'running Check out both sides',
      'next Load the base',
      'next Load the head',
      'next Extract symbols',
      'next Find references',
      'next Look for findings',
    ]);
  });

  it('marks the steps before the reported phase done: a short one is never seen at 500 ms', () => {
    expect(marks('references')).toEqual([
      'done Check out both sides',
      'done Load the base',
      'done Load the head',
      'done Extract symbols',
      'running Find references',
      'next Look for findings',
    ]);
    expect(marks('loadBase').slice(0, 3)).toEqual([
      'done Check out both sides',
      'running Load the base',
      'next Load the head',
    ]);
    expect(marks('findings').at(-1)).toBe('running Look for findings');
  });

  it('waits for the analyses before it, a row above the six, all to come', () => {
    expect(marks(null, 2)).toEqual([
      'running Waiting for 2 other analyses',
      'next Check out both sides',
      'next Load the base',
      'next Load the head',
      'next Extract symbols',
      'next Find references',
      'next Look for findings',
    ]);
    expect(marks(null, 1)[0]).toBe('running Waiting for 1 other analysis');
  });

  it('claims no progress for a phase it does not know: as before the first', () => {
    expect(marks('somethingNew')).toEqual(marks(null));
  });

  it('gives each step a key of its own', () => {
    const keys = analysisSteps(null, 1).map((step) => step.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('says what each step does, with the commits compared (V90)', () => {
    const steps = analysisSteps('extract', 0, { pair: { base: '7017d22aa', head: 'b3fbfe0bb' } });
    expect(steps.map((step) => step.detail)).toEqual([
      '7017d22 and b3fbfe0, each in a worktree',
      'the TypeScript program at 7017d22',
      'the same at b3fbfe0',
      'functions, classes, methods and types on both sides',
      'who calls what changed, and what it calls',
      'removed but still used, new but unused, changed signatures and APIs',
    ]);
  });
});

describe("each step's time, as the page sees the phases (V90, decision 846)", () => {
  it('notes when a phase was first seen, and keeps the first time', () => {
    let seen = seePhase({}, null, 0);
    expect(seen).toEqual({ checkout: 0 });
    seen = seePhase(seen, 'checkout', 500);
    expect(seen).toEqual({ checkout: 0 });
    seen = seePhase(seen, 'loadBase', 1_000);
    expect(seen).toEqual({ checkout: 0, loadBase: 1_000 });
    // A phase it does not know is as before the first: nothing new.
    expect(seePhase(seen, 'somethingNew', 2_000)).toBe(seen);
  });

  it('notes nothing while it waits in the queue', () => {
    const seen = {};
    expect(seePhase(seen, null, 0, 2)).toBe(seen);
  });

  it('times a done step from when it was seen to when a later one was, the running one to now', () => {
    const seen = { checkout: 0, loadBase: 1_200, loadHead: 6_000, extract: 10_600 };
    const steps = analysisSteps('extract', 0, { seen, now: 19_600 });
    expect(steps.map((step) => step.ms)).toEqual([
      1_200,
      4_800,
      4_600,
      9_000,
      undefined,
      undefined,
    ]);
  });

  it('gives no time to a step it never saw: opened late, or between two polls', () => {
    // Opened while the head loaded: the steps before have no time.
    expect(
      analysisSteps('extract', 0, { seen: { loadHead: 0, extract: 4_000 }, now: 5_000 }).map(
        (step) => step.ms,
      ),
    ).toEqual([undefined, undefined, 4_000, 1_000, undefined, undefined]);
    // The head loaded between two polls: the base's time holds it.
    expect(
      analysisSteps('extract', 0, { seen: { loadBase: 0, extract: 9_000 }, now: 9_500 }).map(
        (step) => step.ms,
      ),
    ).toEqual([undefined, 9_000, undefined, 500, undefined, undefined]);
  });

  it('ends at the last step seen: failed or stopped there, the ones before done', () => {
    const seen = { checkout: 0, loadBase: 1_000, references: 3_000 };
    expect(endedSteps(seen, 'failed').map((step) => `${step.mark} ${step.name}`)).toEqual([
      'done Check out both sides',
      'done Load the base',
      'done Load the head',
      'done Extract symbols',
      'failed Find references',
      'next Look for findings',
    ]);
    expect(endedSteps(seen, 'stopped')[4]?.mark).toBe('stopped');
    expect(endedSteps(seen, 'failed').map((step) => step.ms)).toEqual([
      1_000,
      2_000,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('has no steps to end at when it saw none: opened after the end', () => {
    expect(endedSteps({}, 'failed')).toEqual([]);
  });

  it('says a step in seconds, a running clock in minutes and seconds', () => {
    expect(stepTime(1_234)).toBe('1.2 s');
    expect(stepTime(400)).toBe('0.4 s');
    expect(stepTime(12_600)).toBe('13 s');
    expect(stepTime(75_000)).toBe('1:15');
    expect(clockTime(9_400)).toBe('0:09');
    expect(clockTime(21_000)).toBe('0:21');
    expect(clockTime(3_725_000)).toBe('62:05');
  });
});
