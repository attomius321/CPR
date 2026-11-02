// HV5: Hive's pause by usage and a workspace's spend, in words — the card, the workspace page's
// head, the Review tab and the status bar's notices (decision 802).
import { describe, expect, it } from 'vitest';
import type {
  HivePause,
  WorkspaceHive,
  WorkspaceHiveDetail,
  WorkspaceSummary,
} from '@symbiote/core';
import {
  goesOnWords,
  pauseWords,
  spendWords,
  stepWords,
  windowWords,
} from '../src/workspaces/hive-rounds.js';
import { budgetOf, budgetWords, pauseAtWords, pauseChoices } from '../src/settings/hive-switch.js';
import { transitionNotice } from '../src/workspaces/transitions.js';
import { allRows, workspaceGroups, workspaceNext } from '../src/workspaces/workspaces.js';

/** A time in the viewer's own zone: what the person's clock says. */
const local = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min).getTime();
const NOW = local(2026, 11, 2, 14, 5);
const iso = (ms: number) => new Date(ms).toISOString();

const pause = (over: Partial<HivePause> = {}): HivePause => ({
  reason: 'usage',
  minutes: 300,
  percent: 92,
  pauseAt: 90,
  until: iso(local(2026, 11, 2, 16, 10)),
  since: iso(NOW),
  ...over,
});

describe('the pause in words', () => {
  it("says the window, its use and when Hive goes on, in the viewer's time", () => {
    expect(pauseWords(pause(), NOW)).toBe(
      'Paused: usage 92 % of the 5-hour window, goes on at 16:10',
    );
    expect(
      pauseWords(
        pause({ minutes: 10_080, percent: 90.6, until: iso(local(2026, 11, 3, 9, 0)) }),
        NOW,
      ),
    ).toBe('Paused: usage 91 % of the week, goes on tomorrow at 09:00');
    expect(
      pauseWords(
        pause({ minutes: 10_080, scope: 'opus', until: iso(local(2026, 11, 8, 23, 0)) }),
        NOW,
      ),
    ).toBe('Paused: usage 92 % of the week (opus), goes on Sun 8 Nov at 23:00');
    // Its time has come: the next look starts what waits.
    expect(goesOnWords(iso(NOW - 1_000), NOW)).toBe('now');
    // A window that does not say when it resets.
    expect(pauseWords(pause({ until: undefined }), NOW)).toBe(
      'Paused: usage 92 % of the 5-hour window',
    );
  });

  it('says why usage is unknown', () => {
    expect(
      pauseWords(
        { reason: 'unknown', pauseAt: 90, why: "Claude's usage asked to wait (429)", since: '' },
        NOW,
      ),
    ).toBe("Paused: usage unknown (Claude's usage asked to wait (429))");
  });

  it('names windows by their length', () => {
    expect(windowWords(300)).toBe('the 5-hour window');
    expect(windowWords(10_080)).toBe('the week');
    expect(windowWords(43_200)).toBe('the 30-day window');
    expect(windowWords(undefined)).toBe('a window');
  });
});

describe('the spend in words', () => {
  it('the writer and the reviews, and the budget when there is one', () => {
    expect(spendWords({ writer: 29.18, reviews: 18.02, reviewed: 8, total: 47.2 })).toBe(
      'Spent $47.20: the writer $29.18, 8 reviews $18.02',
    );
    expect(spendWords({ writer: 1.2, reviews: 0, reviewed: 0, total: 1.2, budget: 1 })).toBe(
      'Spent $1.20 of a $1.00 budget: the writer $1.20, no review',
    );
    // Nothing ran yet: nothing to say of the writer.
    expect(spendWords({ reviews: 0, reviewed: 0, total: 0, budget: 20 })).toBe(
      'Spent nothing yet of a $20.00 budget',
    );
    expect(spendWords({ reviews: 0.6, reviewed: 1, total: 0.6 })).toBe(
      'Spent $0.60: the writer’s cost not read, 1 review $0.60',
    );
  });
});

describe('the Review tab’s head', () => {
  const detail = (over: Partial<WorkspaceHiveDetail>): WorkspaceHiveDetail => ({
    branch: 'feature/x',
    step: 'writing',
    round: 2,
    rounds: 3,
    on: true,
    checks: [],
    reviews: [],
    tests: '/t',
    ...over,
  });

  it('says the pause while Hive is on; Hive off first', () => {
    expect(stepWords(detail({ pause: pause() }), NOW)).toBe(
      'Paused: usage 92 % of the 5-hour window, goes on at 16:10 (round 2 of 3)',
    );
    expect(stepWords(detail({ pause: pause(), on: false }), NOW)).toBe(
      'Hive is off: writing, round 2 of 3, waits',
    );
    expect(stepWords(detail({}), NOW)).toBe("The writer's turn, round 2 of 3");
  });
});

const summary = (over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  branch: 'feature/halve',
  title: 'Halve it',
  base: 'a'.repeat(40),
  created: '2026-11-02T10:00:00.000Z',
  planFirst: false,
  brief: 'B',
  worktree: { path: '/w/feature/halve', exists: true },
  tip: 'b'.repeat(40),
  ahead: 1,
  merged: false,
  agent: { state: 'ready', kind: 'claude' },
  ...over,
});
const hive = (over: Partial<WorkspaceHive> = {}): WorkspaceHive => ({
  step: 'writing',
  round: 2,
  rounds: 3,
  ...over,
});

describe('the card', () => {
  it("says the pause, from the record, in Hive's group, with no spinner", () => {
    const next = workspaceNext(summary({ hive: hive({ pause: pause() }) }), undefined, NOW);
    expect(next).toMatchObject({
      group: 'hive',
      text: 'Paused: usage 92 % of the 5-hour window, goes on at 16:10',
      paused: true,
      hive: true,
      chip: { tone: 'idle' },
    });
    // A writer held at its start, never started.
    const held = summary({
      agent: { state: 'not-running', kind: 'claude' },
      ahead: 0,
      hive: hive({ round: 1, pause: pause({ reason: 'unknown', why: 'no token' }) }),
    });
    expect(workspaceNext(held, undefined, NOW).text).toBe('Paused: usage unknown (no token)');
    // The writer at work (the person's own message): its words, not the pause.
    const working = summary({
      agent: { state: 'working', kind: 'claude' },
      hive: hive({ pause: pause() }),
    });
    expect(workspaceNext(working, undefined, NOW).text).toBe('Writing');
    // Hive off: off's words, as before.
    const off = summary({ hive: hive({ pause: pause(), paused: true, off: true }) });
    expect(workspaceNext(off, undefined, NOW).text).toBe('Hive off: paused');
    // Stopped by the budget: the stop's words.
    const stuck = summary({
      hive: hive({ step: 'stuck', note: 'its spend reached its budget: $1.20 of $1.00' }),
    });
    expect(workspaceNext(stuck, undefined, NOW).text).toBe(
      'Stopped: its spend reached its budget: $1.20 of $1.00',
    );
  });
});

describe('the notices', () => {
  const rows = (...workspaces: WorkspaceSummary[]) =>
    allRows(workspaceGroups(workspaces, null, { hiveMode: true }));

  it('when Hive pauses a workspace, and when it goes on', () => {
    const reading = rows(summary({ hive: hive() }));
    const paused = rows(summary({ hive: hive({ pause: pause({ until: undefined }) }) }));
    expect(transitionNotice(reading, paused, null)).toEqual({
      text: 'Halve it paused: usage 92 % of the 5-hour window',
      href: '/?branch=feature%2Fhalve',
    });
    // The same pause read again: nothing.
    expect(transitionNotice(paused, paused, null)).toBeNull();
    const writing = rows(summary({ agent: { state: 'working', kind: 'claude' }, hive: hive() }));
    expect(transitionNotice(paused, writing, null)?.text).toBe('Halve it goes on');
    // On screen: the page says it.
    expect(transitionNotice(reading, paused, 'feature/halve')).toBeNull();
  });
});

describe("Settings' pacing", () => {
  it('offers never and the thresholds, the project’s own among them', () => {
    expect(pauseChoices(90).map((c) => c.label)).toEqual([
      'Never: Hive does not pause by usage',
      '50 %',
      '60 %',
      '70 %',
      '80 %',
      '90 % (default)',
      '95 %',
      '100 %',
    ]);
    expect(pauseChoices(75).map((c) => c.value)).toEqual([
      'off',
      '50',
      '60',
      '70',
      '75',
      '80',
      '90',
      '95',
      '100',
    ]);
  });

  it('says what the threshold does, or why nothing pauses Hive', () => {
    expect(pauseAtWords({ pauseAt: 90, read: true })).toMatch(
      /^While any window of your Claude subscription .* is at 90 % or more, Hive starts no agent/,
    );
    expect(pauseAtWords({ pauseAt: false, read: true })).toBe(
      "Hive starts agents whatever your subscription's usage says.",
    );
    expect(pauseAtWords({ pauseAt: 90, read: false })).toBe(
      'Symbiote reads no usage here (SYMBIOTE_USAGE=off): Hive does not pause for it.',
    );
  });

  it('reads a budget as typed: dollars above 0, or none', () => {
    expect(budgetOf('')).toEqual({ value: null });
    expect(budgetOf(' $20 ')).toEqual({ value: 20 });
    expect(budgetOf('12.5')).toEqual({ value: 12.5 });
    for (const text of ['0', '-3', 'ten', '1e3', '2,000'])
      expect(budgetOf(text)).toHaveProperty('problem');
    expect(budgetWords(null)).toBe('No budget: a workspace spends what its rounds take.');
    expect(budgetWords(20)).toMatch(/^A workspace that has spent \$20\.00 /);
  });
});
