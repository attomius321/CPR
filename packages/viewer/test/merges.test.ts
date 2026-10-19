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
