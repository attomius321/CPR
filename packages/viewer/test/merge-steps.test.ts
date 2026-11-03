// V93 (decisions 880, 881): a merge's page as proof 05-merge draws it — its pill, its steps
// (Approved, Merge, Check, Land), the queue and the time, the check's commands against the last
// passing check's.
import type { MergeEntry } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { expectedCheck, mergePage } from '../src/workspaces/merge-steps.js';

// 3 November 2026, 12:50:14 local time.
const OK = new Date(2026, 10, 3, 12, 50, 0).getTime();
const NOW = OK + 14_000;
const iso = (t: number) => new Date(t).toISOString();
const sha = (c: string) => c.repeat(40);

const entry = (over: Partial<MergeEntry> = {}): MergeEntry => ({
  id: 'm1',
  branch: 'fix/order-total-rounding',
  head: 'c54655f'.padEnd(40, '0'),
  into: 'main',
  title: 'Merge fix/order-total-rounding: Fix order total rounding',
  state: 'queued',
  queued: iso(OK + 1000),
  updated: iso(OK + 2000),
  ...over,
});
const verdict = {
  at: iso(OK),
  number: 2,
  summary: 'The rounding now matches the receipt. Ship it.',
};

describe('mergePage', () => {
  it('checking: the pill, Approved and Merge done, Check now against the last pass, Land to come', () => {
    const checking = entry({
      state: 'checking',
      base: '7017d22'.padEnd(40, '0'),
      merge: '7aeb0ad'.padEnd(40, '0'),
      mergeMs: 400,
      check: {
        commands: ['npm test'],
        source: 'symbiote/config.json (merge.checks)',
        started: iso(NOW - 12_000),
        steps: [],
      },
    });
    const page = mergePage(checking, {
      queue: [checking],
      verdict,
      expected: [20_000],
      push: true,
      now: NOW,
    });
    expect(page.pill).toEqual({ word: 'Checking the merge', tone: 'run' });
    expect(page.title).toBe('Fix order total rounding');
    expect(page.line).toEqual(['approved by you at 12:50', 'first in the queue']);
    expect(page.steps.map((s) => [s.name, s.state, s.detail])).toEqual([
      ['Approved', 'done', 'by you · 12:50'],
      ['Merge', 'done', 'into main at 7017d22 · 0.4 s'],
      ['Check', 'now', 'npm test · 0:12 of ~0:20'],
      ['Land', 'todo', 'main fast-forwards, then push'],
    ]);
    // The Steps card's Land: where the target goes, and that it is pushed.
    expect(page.landWords).toBe('main to 7aeb0ad, then pushed');
    expect(page.steps[2]?.progress).toBeCloseTo(0.6);
    expect(page.queue).toEqual({ value: '1', of: 'of 1', words: 'nothing behind it' });
    expect(page.time).toEqual({ value: '0:14', words: 'since your OK' });
    expect(page.commands).toEqual([
      { command: 'npm test', mark: 'running', time: '0:12', share: 0.6 },
    ]);
    expect(page.approval).toEqual({
      words: 'your review, 2nd',
      at: '12:50',
      quote: 'The rounding now matches the receipt. Ship it.',
    });
    expect(page.checkTime).toBe('0:12 of ~0:20');
  });

  it('queued second: Merge and Check to come, two of two', () => {
    const first = entry({ id: 'm0', branch: 'feature/a', state: 'checking', queued: iso(OK) });
    const second = entry({ queued: iso(OK + 5000) });
    const page = mergePage(second, { queue: [first, second], now: NOW });
    expect(page.pill).toEqual({ word: 'Queued', tone: 'idle' });
    expect(page.line).toEqual(['2nd in the queue']);
    expect(page.queue).toEqual({ value: '2', of: 'of 2', words: 'nothing behind it' });
    expect(page.steps.map((s) => s.state)).toEqual(['done', 'todo', 'todo', 'todo']);
    expect(page.steps[0]?.detail).toBe('queued · 12:50');
    // Not pushed (no merge.push), and no merge commit yet.
    expect(page.steps[3]?.detail).toBe('main fast-forwards');
    expect(page.landWords).toBe('main fast-forwards');
  });

  it('a check that failed: its command red, those after not run, the pill red', () => {
    const failed = entry({
      state: 'failed',
      merge: sha('e'),
      check: {
        commands: ['pnpm install', 'pnpm test', 'pnpm build'],
        source: 's',
        started: iso(NOW - 60_000),
        ok: false,
        failed: 'pnpm test',
        steps: [
          { command: 'pnpm install', ms: 5_000, ok: true },
          { command: 'pnpm test', ms: 41_000, ok: false },
        ],
      },
    });
    const page = mergePage(failed, { queue: [failed], now: NOW });
    expect(page.pill).toEqual({ word: 'Check failed', tone: 'fail' });
    expect(page.steps[2]).toMatchObject({ state: 'bad', detail: 'pnpm test failed' });
    expect(page.commands.map((c) => [c.mark, c.time])).toEqual([
      ['passed', '0:05'],
      ['failed', '0:41'],
      ['skipped', undefined],
    ]);
  });

  it('landed: every step done, when and where, the time from the OK to landed', () => {
    const landed = entry({
      state: 'landed',
      base: sha('1'),
      merge: '7aeb0ad'.padEnd(40, '0'),
      landed: iso(OK + 20_000),
      pushed: { ok: true, remote: 'origin' },
      check: { commands: ['npm test'], source: 's', ok: true, ms: 18_000 },
    });
    const page = mergePage(landed, { queue: [landed], verdict, now: NOW + 60_000 });
    expect(page.pill).toEqual({ word: 'Landed', tone: 'ok' });
    expect(page.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done']);
    expect(page.steps[2]?.detail).toBe('passed in 0:18');
    expect(page.steps[3]?.detail).toBe('main at 7aeb0ad · pushed to origin');
    expect(page.queue).toEqual({ value: '—', of: '', words: 'landed at 12:50' });
    expect(page.time).toEqual({ value: '0:20', words: 'from your OK to landed' });
    // A check from before V93 has no steps: its commands without their times.
    expect(page.commands).toEqual([{ command: 'npm test', mark: 'passed' }]);
  });

  it('ready to land, conflicts for you, merging, resolving', () => {
    expect(mergePage(entry({ state: 'ready' }), { queue: [], now: NOW }).pill).toEqual({
      word: 'Ready to land',
      tone: 'you',
    });
    const conflicts = mergePage(entry({ state: 'needs-you', conflicts: ['a.ts', 'b.ts'] }), {
      queue: [],
      now: NOW,
    });
    expect(conflicts.pill).toEqual({ word: 'Needs you', tone: 'you' });
    expect(conflicts.steps[1]).toMatchObject({ state: 'bad', detail: '2 conflicts with main' });
    expect(mergePage(entry({ state: 'merging' }), { queue: [], now: NOW }).steps[1]).toMatchObject({
      state: 'now',
      detail: 'into main',
    });
    expect(
      mergePage(entry({ state: 'resolving', conflicts: ['a.ts'] }), { queue: [], now: NOW }).pill,
    ).toEqual({ word: 'Resolving conflicts', tone: 'run' });
  });

  it("Hive's: approved by Hive", () => {
    const page = mergePage(entry({ by: 'hive' }), { queue: [], verdict, now: NOW });
    expect(page.steps[0]?.detail).toBe('by Hive · 12:50');
    expect(page.line[0]).toBe('approved by Hive at 12:50');
  });
});

describe('expectedCheck', () => {
  it("is the newest passing check's times with the same commands", () => {
    const pass = (at: number, ms: number[]) =>
      entry({
        id: `p${at}`,
        state: 'landed',
        landed: iso(at),
        check: {
          commands: ['a', 'b'],
          source: 's',
          ok: true,
          steps: ms.map((m, i) => ({ command: i ? 'b' : 'a', ms: m, ok: true })),
        },
      });
    const other = entry({
      id: 'x',
      state: 'landed',
      landed: iso(OK + 9),
      check: { commands: ['c'], source: 's', ok: true, steps: [{ command: 'c', ms: 1, ok: true }] },
    });
    expect(expectedCheck([pass(OK, [1, 2]), pass(OK + 5, [3, 4]), other], ['a', 'b'])).toEqual([
      3, 4,
    ]);
    expect(expectedCheck([other], ['a', 'b'])).toBeUndefined();
  });
});
