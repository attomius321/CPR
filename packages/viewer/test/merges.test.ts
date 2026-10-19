import type { MergeEntry } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { mergeActions, mergeLive, mergeState } from '../src/merges.js';

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
const check = { commands: ['pnpm check'], source: 'cpr/config.json (merge.checks)' };

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
