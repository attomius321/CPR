import type { Graph } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { Diffs, type Pair, type RunDiff } from '../src/diffs.js';

const pair = (n: number): Pair => ({ base: `${n}`.repeat(40), head: `${n + 1}`.repeat(40) });
const graphOf = (p: Pair) => ({ revisions: { base: { sha: p.base } } }) as unknown as Graph;

/** A runner whose analyses end when the test says so. */
function fakeRunner() {
  const runs: {
    pair: Pair;
    onPhase: (phase: string) => void;
    signal: AbortSignal;
    resolve: (graph: Graph) => void;
    reject: (error: Error) => void;
  }[] = [];
  const run: RunDiff = (pair, { onPhase, signal }) =>
    new Promise((resolve, reject) => {
      runs.push({ pair, onPhase, signal, resolve, reject });
      signal.addEventListener('abort', () => reject(new Error('stopped')));
    });
  return { run, runs };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Diffs', () => {
  it('runs one analysis at a time, in the order asked, and reports its phase', async () => {
    const { run, runs } = fakeRunner();
    let now = 1000;
    const diffs = new Diffs(run, { now: () => now });
    diffs.start(pair(1));
    diffs.start(pair(3));
    diffs.start(pair(1)); // already asked: nothing new
    expect(runs.map((r) => r.pair)).toEqual([pair(1)]);
    expect(diffs.status(pair(1))).toEqual({ status: 'running', phase: null, elapsedMs: 0 });
    expect(diffs.status(pair(3))).toEqual({ status: 'queued', queued: 1, elapsedMs: 0 });

    now = 3500;
    runs[0]?.onPhase('loadHead');
    expect(diffs.status(pair(1))).toEqual({
      status: 'running',
      phase: 'loadHead',
      elapsedMs: 2500,
    });

    runs[0]?.resolve(graphOf(pair(1)));
    await settle();
    expect(diffs.status(pair(1))).toEqual({ status: 'done', graph: graphOf(pair(1)) });
    expect(runs.map((r) => r.pair)).toEqual([pair(1), pair(3)]);
    expect(diffs.status(pair(3))).toMatchObject({ status: 'running', phase: null });
  });

  it('keeps a failure until asked again', async () => {
    const { run, runs } = fakeRunner();
    const diffs = new Diffs(run);
    diffs.start(pair(1));
    runs[0]?.reject(new Error("cpr: unknown revision 'x'"));
    await settle();
    expect(diffs.status(pair(1))).toEqual({ status: 'failed', error: "cpr: unknown revision 'x'" });
    diffs.start(pair(1));
    expect(runs).toHaveLength(2);
    expect(diffs.status(pair(1))).toMatchObject({ status: 'running' });
  });

  it('stops a running or queued analysis and forgets it', async () => {
    const { run, runs } = fakeRunner();
    const diffs = new Diffs(run);
    diffs.start(pair(1));
    diffs.start(pair(3));
    diffs.start(pair(5));

    expect(diffs.stop(pair(3))).toBe(true);
    expect(diffs.status(pair(3))).toBeUndefined();
    expect(diffs.stop(pair(1))).toBe(true);
    expect(runs[0]?.signal.aborted).toBe(true);
    expect(diffs.status(pair(1))).toBeUndefined();
    expect(diffs.stop(pair(7))).toBe(false);

    // The next starts once the stopped one has ended.
    await settle();
    expect(runs.map((r) => r.pair)).toEqual([pair(1), pair(5)]);
  });

  it('stops everything when closed', async () => {
    const { run, runs } = fakeRunner();
    const diffs = new Diffs(run);
    diffs.start(pair(1));
    diffs.start(pair(3));
    diffs.close();
    expect(runs[0]?.signal.aborted).toBe(true);
    expect(diffs.status(pair(1))).toBeUndefined();
    expect(diffs.status(pair(3))).toBeUndefined();
    await settle();
    expect(runs).toHaveLength(1);
  });

  it('keeps the last graphs used, and those added', async () => {
    const { run, runs } = fakeRunner();
    const diffs = new Diffs(run, { keep: 2 });
    diffs.add(pair(1), graphOf(pair(1)));
    for (const n of [3, 5]) {
      diffs.start(pair(n));
      runs.at(-1)?.resolve(graphOf(pair(n)));
      await settle();
    }
    // 1 was dropped when 5 was done: two kept.
    expect(diffs.status(pair(1))).toBeUndefined();
    expect(diffs.status(pair(3))).toMatchObject({ status: 'done' });

    // 3 was just used, so 5 goes when 7 is done.
    diffs.start(pair(7));
    runs.at(-1)?.resolve(graphOf(pair(7)));
    await settle();
    expect(diffs.status(pair(5))).toBeUndefined();
    expect(diffs.status(pair(3))).toMatchObject({ status: 'done' });
    expect(diffs.status(pair(7))).toMatchObject({ status: 'done' });
  });
});
