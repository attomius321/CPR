import type { FinishedWorkspace } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  byDay,
  historyView,
  kindsOf,
  matching,
  outcomeText,
  ranFor,
  withHistoryView,
} from '../src/workspaces/history.js';

const row = (over: Partial<FinishedWorkspace> & { branch: string }): FinishedWorkspace => ({
  brief: `# Feature: ${over.branch}\n\n## Goal\nDo it.\n`,
  created: '2026-10-27T18:00:00.000Z',
  finished: '2026-10-27T20:00:00.000Z',
  planFirst: true,
  outcome: 'merged',
  into: 'main',
  ...over,
});

describe('outcomeText (V77)', () => {
  it('says what became of its branch: merged into the default branch, kept, or not merged', () => {
    expect(outcomeText(row({ branch: 'a' }))).toBe('Merged into main');
    expect(outcomeText(row({ branch: 'a', into: undefined }))).toBe('Merged');
    expect(outcomeText(row({ branch: 'a', outcome: 'kept', into: undefined }))).toBe('Branch kept');
    expect(outcomeText(row({ branch: 'a', outcome: 'gone', into: undefined }))).toBe('Not merged');
  });
});

describe('ranFor (V77)', () => {
  it('says how long it ran, from its start to its clean-up, in words', () => {
    const at = (minutes: number) => new Date(Date.parse('2026-10-27T18:00:00Z') + minutes * 60_000);
    const from = '2026-10-27T18:00:00.000Z';
    expect(ranFor(from, at(0.5).toISOString())).toBe('under a minute');
    expect(ranFor(from, at(1).toISOString())).toBe('1 min');
    expect(ranFor(from, at(48).toISOString())).toBe('48 min');
    expect(ranFor(from, at(60).toISOString())).toBe('1 h');
    expect(ranFor(from, at(130).toISOString())).toBe('2 h 10 min');
    expect(ranFor(from, at(26 * 60 + 5).toISOString())).toBe('1 day 2 h');
    expect(ranFor(from, at(24 * 60).toISOString())).toBe('1 day');
    expect(ranFor(from, at(3 * 24 * 60 + 300).toISOString())).toBe('3 days');
  });

  it('says nothing for times it cannot read, or a clean-up before the start', () => {
    expect(ranFor('', '2026-10-27T18:00:00.000Z')).toBe('');
    expect(ranFor('2026-10-27T18:00:00.000Z', '2026-10-27T17:00:00.000Z')).toBe('');
  });
});

describe('matching (V77)', () => {
  const rows = [
    row({ branch: 'feature/done-workspace', title: 'done workspace', kind: 'feature' }),
    row({
      branch: 'fix/scout-effort',
      title: 'Scout effort',
      kind: 'fix',
      brief: '# Fix: Scout effort\n\n## What happens\nScout starts at the wrong LEVEL.\n',
    }),
    row({ branch: 'spike/old' }),
  ];
  const branches = (found: FinishedWorkspace[]) => found.map((w) => w.branch);

  it('keeps every row without a search or a kind', () => {
    expect(branches(matching(rows, '', null))).toEqual(branches(rows));
    expect(branches(matching(rows, '   ', null))).toEqual(branches(rows));
  });

  it('keeps the rows with every word of the search in their title, branch or brief', () => {
    expect(branches(matching(rows, 'Workspace', null))).toEqual(['feature/done-workspace']);
    expect(branches(matching(rows, 'scout level', null))).toEqual(['fix/scout-effort']);
    expect(branches(matching(rows, 'spike/', null))).toEqual(['spike/old']);
    expect(branches(matching(rows, 'scout workspace', null))).toEqual([]);
  });

  it('keeps one kind; a row without a kind is in none', () => {
    expect(branches(matching(rows, '', 'fix'))).toEqual(['fix/scout-effort']);
    expect(branches(matching(rows, 'done', 'fix'))).toEqual([]);
  });

  it('offers the kinds the rows have, in the start page order', () => {
    expect(kindsOf(rows)).toEqual(['feature', 'fix']);
    expect(kindsOf([])).toEqual([]);
  });
});

describe('byDay (V77)', () => {
  const now = new Date('2026-10-29T15:00:00');
  const at = (local: string) => new Date(local).toISOString();

  it('groups the rows by the day they finished, newest first: today, yesterday, then dates', () => {
    const rows = [
      row({ branch: 'c', finished: at('2026-10-29T09:00:00') }),
      row({ branch: 'b', finished: at('2026-10-28T23:30:00') }),
      row({ branch: 'a', finished: at('2026-10-28T08:00:00') }),
      row({ branch: 'z', finished: at('2026-10-20T08:00:00') }),
      row({ branch: 'y', finished: at('2025-12-31T08:00:00') }),
    ];
    const days = byDay(rows, now);
    expect(days.map((d) => [d.label, d.rows.map((r) => r.branch)])).toEqual([
      ['Today', ['c']],
      ['Yesterday', ['b', 'a']],
      [
        new Date('2026-10-20T12:00:00').toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }),
        ['z'],
      ],
      [
        new Date('2025-12-31T12:00:00').toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
        ['y'],
      ],
    ]);
    expect(new Set(days.map((d) => d.key)).size).toBe(days.length);
  });
});

describe("History's tab in the address (V77)", () => {
  it('reads the tab, Activity without one', () => {
    expect(historyView('?branch=x')).toBe('activity');
    expect(historyView('?branch=x&brief')).toBe('brief');
    expect(historyView('?branch=x&thread')).toBe('thread');
    expect(historyView('?branch=x&changes')).toBe('changes');
    expect(historyView('?branch=x&terminal')).toBe('activity');
  });

  it('writes the tab after the branch, Activity as none', () => {
    expect(withHistoryView('/workspace-history?branch=feature%2Fx', 'brief')).toBe(
      '/workspace-history?branch=feature%2Fx&brief',
    );
    expect(withHistoryView('/workspace-history?branch=feature%2Fx&brief', 'activity')).toBe(
      '/workspace-history?branch=feature%2Fx',
    );
    expect(withHistoryView('/workspace-history?branch=x&thread', 'changes')).toBe(
      '/workspace-history?branch=x&changes',
    );
  });
});
