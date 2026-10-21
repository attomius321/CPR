import type { MergeEntry } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  mergeActions,
  mergeLabel,
  mergeLive,
  mergeState,
  regionFlags,
  reviewRegion,
} from '../src/merges.js';

const C = 'c'.repeat(40);
const M = 'm'.repeat(40);
const entry = (fields: Partial<MergeEntry>): MergeEntry => ({
  id: 'm1',
  branch: 'feature/csv',
  head: C,
  into: 'main',
  title: 'Merge feature/csv: CSV',
  state: 'queued',
  queued: '2026-10-19T12:00:00.000Z',
  updated: '2026-10-19T12:00:00.000Z',
  ...fields,
});
const check = { commands: ['pnpm check'], source: 'symbiote/config.json (merge.checks)' };

describe('mergeState (V26a)', () => {
  it('says where a merge is, in words and a tone', () => {
    expect(mergeState(entry({}))).toEqual({ text: 'Queued: ccccccc into main', tone: 'wait' });
    expect(mergeState(entry({ state: 'merging' })).text).toBe('Merging into main');
    expect(mergeState(entry({ state: 'checking', check })).text).toBe('Checking: pnpm check');
    expect(
      mergeState(entry({ state: 'ready', check: { ...check, ok: true, ms: 81_400 } })),
    ).toEqual({ text: 'Checked in 1 min 21 s: ready to land', tone: 'you' });
    expect(
      mergeState(entry({ state: 'ready', message: 'no check to run: set merge.checks' })),
    ).toEqual({ text: 'Merged, not checked: no check to run: set merge.checks', tone: 'you' });
    expect(
      mergeState(entry({ state: 'landed', merge: M, check: { ...check, ok: true, ms: 4_200 } })),
    ).toEqual({ text: 'Landed: main is at mmmmmmm · checked in 4.2 s', tone: 'done' });
    expect(
      mergeState(
        entry({ state: 'landed', merge: M, pushed: { ok: false, remote: 'origin', error: 'no' } }),
      ).text,
    ).toBe('Landed: main is at mmmmmmm · not pushed to origin: no');
    expect(
      mergeState(entry({ state: 'failed', check: { ...check, ok: false, failed: 'pnpm check' } })),
    ).toEqual({ text: 'The check failed: pnpm check', tone: 'bad' });
    expect(mergeState(entry({ state: 'needs-you', conflicts: ['a.ts', 'b.ts'] }))).toEqual({
      text: 'Conflicts with main in 2 files',
      tone: 'bad',
    });
  });
});

describe('a resolution to review (V26c)', () => {
  const region = {
    path: 'src/a.ts',
    line: 1,
    ours: ['a = 1'],
    base: ['a = 0'],
    theirs: ['a = 2'],
    text: 'a = 3',
  };
  const resolution = { agent: 'claude' as const, model: 'sonnet', regions: [region], ms: 4000 };

  it('says the agent is resolving, then what it resolved and how the check went', () => {
    expect(mergeState(entry({ state: 'resolving', conflicts: ['src/a.ts'] }))).toEqual({
      text: 'Resolving 1 conflicting file: the merger agent answers each region',
      tone: 'wait',
    });
    expect(
      mergeState(
        entry({
          state: 'needs-you',
          merge: M,
          resolution: { ...resolution, usage: { input: 3100, output: 120 } },
          check: { ...check, ok: true, ms: 4200 },
        }),
      ),
    ).toEqual({
      text: 'Resolved 1 region (sonnet, 3.2K tokens) · checked in 4.2 s: review it',
      tone: 'you',
    });
    expect(
      mergeState(
        entry({
          state: 'needs-you',
          merge: M,
          resolution,
          check: { ...check, ok: false, failed: 'pnpm check' },
        }),
      ).text,
    ).toBe('Resolved 1 region (sonnet) · its check failed: pnpm check');
    expect(
      mergeState(
        entry({
          state: 'needs-you',
          conflicts: ['src/a.ts'],
          resolution: { ...resolution, regions: [], needsYou: 'a: two values' },
          message: 'the merger agent: a: two values',
        }),
      ),
    ).toEqual({ text: 'The merger agent: a: two values', tone: 'bad' });
  });

  it('offers Approve and Request changes on a resolution; no Approve when its check failed', () => {
    const resolved = entry({ state: 'needs-you', merge: M, resolution });
    expect(mergeActions(resolved)).toEqual(['approve', 'change', 'retry', 'remove']);
    expect(mergeActions({ ...resolved, check: { ...check, ok: false } })).toEqual([
      'change',
      'retry',
      'remove',
    ]);
  });
});

describe('mergeActions (V26a)', () => {
  it('offers Land when ready, Retry when stopped, Remove unless it runs', () => {
    expect(mergeActions(entry({}))).toEqual(['remove']);
    expect(mergeActions(entry({ state: 'merging' }))).toEqual([]);
    expect(mergeActions(entry({ state: 'checking' }))).toEqual([]);
    expect(mergeActions(entry({ state: 'ready' }))).toEqual(['land', 'remove']);
    expect(mergeActions(entry({ state: 'failed' }))).toEqual(['retry', 'remove']);
    expect(mergeActions(entry({ state: 'needs-you' }))).toEqual(['retry', 'remove']);
    expect(mergeActions(entry({ state: 'landed' }))).toEqual(['remove']);
  });

  it('reads the queue again while a merge is queued, merging or checking', () => {
    expect(mergeLive([entry({ state: 'landed' }), entry({ state: 'ready' })])).toBe(false);
    expect(mergeLive([entry({ state: 'landed' }), entry({ state: 'checking' })])).toBe(true);
  });
});

describe('a resolution, line by line (the merge page remake)', () => {
  const DOUBLE = 'export const double = (a: number) => a * 2;';
  const SQUARE = ['export function square(a: number): number {', '  return a * a;', '}'];
  const CUBE = ['export function cube(a: number): number {', '  return a * a * a;', '}'];
  const added = {
    path: 'src/math.ts',
    line: 8,
    ours: [DOUBLE],
    base: [],
    theirs: [...SQUARE, '', ...CUBE],
  };

  it('marks the lines a resolution dropped from a side', () => {
    const review = reviewRegion({ ...added, text: DOUBLE });
    expect(review.lines).toEqual([{ text: DOUBLE, from: 'ours' }]);
    expect(review.kept).toEqual({ ours: { kept: 1, of: 1 }, theirs: { kept: 0, of: 6 } });
    expect(review.dropped).toEqual({ ours: [], theirs: [...SQUARE, ...CUBE] });
    expect(review.twice).toBe(0);
    expect(review.written).toBe(0);
    expect(regionFlags(review, 'main', 'agent')).toEqual([
      { tone: 'bad', text: 'Drops all 6 lines from agent' },
    ]);
  });

  it('says a resolution keeps every line of both sides; blank lines are not counted', () => {
    const review = reviewRegion({
      ...added,
      text: [DOUBLE, '', ...SQUARE, '', ...CUBE].join('\n'),
    });
    expect(review.lines.map((l) => l.from)).toEqual([
      'ours',
      'blank',
      'theirs',
      'theirs',
      'theirs',
      'blank',
      'theirs',
      'theirs',
      'theirs',
    ]);
    expect(review.kept).toEqual({ ours: { kept: 1, of: 1 }, theirs: { kept: 6, of: 6 } });
    expect(regionFlags(review, 'main', 'agent')).toEqual([
      { tone: 'ok', text: 'Keeps every line of both sides, nothing new' },
    ]);
  });

  it("finds a line kept twice, a line the agent wrote, and a side's line dropped", () => {
    const review = reviewRegion({
      path: 'docs/PLAN.md',
      line: 441,
      ours: ['| V25 | Workspaces |', '| V27 | Codex |'],
      base: ['| V25 | Workspaces |'],
      theirs: ['| V26 | A merger | built |', '| V27 | Codex |'],
      text: [
        '| V25 | Workspaces |',
        '| V26 | A merger | merged |',
        '| V27 | Codex |',
        '| V27 | Codex |',
      ].join('\n'),
    });
    expect(review.lines).toEqual([
      { text: '| V25 | Workspaces |', from: 'ours' },
      { text: '| V26 | A merger | merged |', from: 'new' },
      { text: '| V27 | Codex |', from: 'both', twice: true },
      { text: '| V27 | Codex |', from: 'both', twice: true },
    ]);
    // The ancestor's line is no side's own: neither side added it.
    expect(review.kept).toEqual({ ours: { kept: 1, of: 1 }, theirs: { kept: 1, of: 2 } });
    expect(review.dropped).toEqual({ ours: [], theirs: ['| V26 | A merger | built |'] });
    expect(regionFlags(review, 'main', 'milestone/v26')).toEqual([
      { tone: 'bad', text: 'Drops 1 of 2 lines from milestone/v26' },
      { tone: 'bad', text: '1 line kept twice' },
      { tone: 'new', text: '1 line written by the agent' },
    ]);
  });

  it('keeps once what both sides added alike, and reads past indentation', () => {
    const review = reviewRegion({
      path: 'a.ts',
      line: 1,
      ours: ['  x();', 'y();'],
      base: null,
      theirs: ['x();'],
      text: 'x();\n  y();',
    });
    expect(review.lines).toEqual([
      { text: 'x();', from: 'both' },
      { text: '  y();', from: 'ours' },
    ]);
    expect(regionFlags(review, 'main', 'b')).toEqual([
      { tone: 'ok', text: 'Keeps every line of both sides, nothing new' },
    ]);
  });

  it('a side that only removed lines leaves nothing to keep', () => {
    const review = reviewRegion({
      path: 'a.ts',
      line: 1,
      ours: [],
      base: ['old();'],
      theirs: ['old();', 'b();'],
      text: 'b();',
    });
    expect(review.kept).toEqual({ ours: { kept: 0, of: 0 }, theirs: { kept: 1, of: 1 } });
    expect(regionFlags(review, 'main', 'b')).toEqual([
      { tone: 'ok', text: 'Keeps every line of both sides, nothing new' },
    ]);
  });
});

describe('mergeLabel (the merge page remake)', () => {
  it('names where a merge is in a word or two', () => {
    const resolution = {
      agent: 'claude' as const,
      regions: [{ path: 'a', line: 1, ours: [], base: null, theirs: [], text: '' }],
      ms: 1,
    };
    expect(mergeLabel(entry({}))).toBe('Queued');
    expect(mergeLabel(entry({ state: 'resolving' }))).toBe('Resolving');
    expect(mergeLabel(entry({ state: 'needs-you', merge: M, resolution }))).toBe(
      'Review resolution',
    );
    expect(mergeLabel(entry({ state: 'needs-you' }))).toBe('Needs you');
    expect(mergeLabel(entry({ state: 'ready' }))).toBe('Ready to land');
    expect(mergeLabel(entry({ state: 'landed' }))).toBe('Landed');
    expect(mergeLabel(entry({ state: 'failed' }))).toBe('Failed');
  });
});
