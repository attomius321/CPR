import { describe, expect, it } from 'vitest';
import { analysisSteps } from '../src/diff/analysis-steps.js';

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
});
