// V92 (decisions 868, 869): the sidenav in Hive mode — In flight, Stopped, Landed today, Earlier —
// and each row's second line.
import type { HiveLanding, WorkspaceHive, WorkspaceSummary } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { hiveGroups, hiveRowWords } from '../src/workspaces/workspaces.js';

const TIP = 'c'.repeat(40);
const summary = (branch: string, over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  branch,
  base: 'a'.repeat(40),
  from: 'main',
  created: '2026-11-03T08:00:00.000Z',
  planFirst: false,
  brief: 'A goal',
  worktree: { path: `/w/${branch}`, exists: true, changed: 0 },
  tip: TIP,
  ahead: 1,
  merged: false,
  agent: { state: 'working', kind: 'claude', id: 's1' },
  ...over,
});
const hive = (over: Partial<WorkspaceHive> = {}): WorkspaceHive => ({
  step: 'writing',
  round: 1,
  rounds: 3,
  ...over,
});
const landed = (ended: string): HiveLanding => ({
  round: 2,
  at: TIP,
  into: 'main',
  entry: 'm1',
  queued: ended,
  ended,
  outcome: 'landed',
});
// 3 November 2026, 14:00 local time: today began at local midnight.
const NOW = new Date(2026, 10, 3, 14, 0).getTime();
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).toISOString();

describe("Hive's sidenav groups (decision 868)", () => {
  const list = [
    summary('feature/writing', { hive: hive() }),
    summary('feature/checking', {
      agent: { state: 'ready', kind: 'claude' },
      hive: hive({ step: 'checking', round: 2 }),
    }),
    summary('feature/paused', {
      agent: { state: 'ready', kind: 'claude' },
      hive: hive({
        pause: {
          reason: 'usage',
          pauseAt: 90,
          percent: 92,
          minutes: 300,
          since: at(3, 13),
          until: at(3, 15),
        },
      }),
    }),
    summary('feature/cap', {
      agent: { state: 'ready', kind: 'claude' },
      hive: hive({ step: 'stuck', round: 3, note: 'the check failed 3 times: pnpm test:e2e' }),
    }),
    summary('feature/landed-today', {
      merged: true,
      agent: { state: 'done', kind: 'claude' },
      hive: hive({ step: 'landed', landing: landed(at(3, 11)) }),
    }),
    summary('feature/landed-later', {
      merged: true,
      agent: { state: 'done', kind: 'claude' },
      hive: hive({ step: 'landed', landing: landed(at(3, 12)) }),
    }),
    summary('spike/answered', {
      kind: 'spike',
      lastAction: at(3, 9),
      agent: { state: 'done', kind: 'claude' },
      hive: hive({ step: 'answered' }),
    }),
    summary('feature/yesterday', {
      merged: true,
      agent: { state: 'done', kind: 'claude' },
      hive: hive({ step: 'landed', landing: landed(at(2, 23)) }),
    }),
  ];

  it('puts each workspace in In flight, Stopped, Landed today or Earlier', () => {
    const groups = hiveGroups(list, null, NOW);
    const names = (rows: { workspace: WorkspaceSummary }[]) => rows.map((r) => r.workspace.branch);
    expect(names(groups.flight)).toEqual(['feature/writing', 'feature/checking', 'feature/paused']);
    expect(names(groups.stopped)).toEqual(['feature/cap']);
    // Landed today: the newest first, each with when.
    expect(groups.today.map((r) => [r.workspace.branch, r.at])).toEqual([
      ['feature/landed-later', at(3, 12)],
      ['feature/landed-today', at(3, 11)],
      ['spike/answered', at(3, 9)],
    ]);
    expect(names(groups.earlier)).toEqual(['feature/yesterday']);
  });

  it('counts today from the local midnight: 23:00 yesterday is Earlier, 00:00 today is today', () => {
    const edge = [
      summary('a', { merged: true, hive: hive({ step: 'landed', landing: landed(at(3, 0)) }) }),
      summary('b', {
        merged: true,
        hive: hive({
          step: 'landed',
          landing: landed(new Date(2026, 10, 2, 23, 59).toISOString()),
        }),
      }),
    ];
    const groups = hiveGroups(edge, null, NOW);
    expect(groups.today.map((r) => r.workspace.branch)).toEqual(['a']);
    expect(groups.earlier.map((r) => r.workspace.branch)).toEqual(['b']);
  });

  it('lists a workspace whose branch is gone under Stopped', () => {
    const groups = hiveGroups([summary('gone', { tip: null, hive: hive() })], null, NOW);
    expect(groups.stopped.map((r) => r.workspace.branch)).toEqual(['gone']);
  });
});

describe("a Hive row's second line (decision 869)", () => {
  const words = (w: WorkspaceSummary) => hiveRowWords(w, NOW);

  it('says the step in its tone, then the round and what runs, faint', () => {
    expect(words(summary('w', { hive: hive({ round: 1 }) }))).toEqual({
      word: 'Writing',
      tone: 'run',
      detail: 'round 1',
    });
    const started = new Date(NOW - (7 * 60 + 23) * 1000).toISOString();
    expect(
      words(
        summary('c', {
          agent: { state: 'ready', kind: 'claude' },
          hive: hive({
            step: 'checking',
            round: 2,
            live: {
              kind: 'check',
              started,
              commands: ['a', 'b', 'c', 'd'],
              step: 3,
              since: started,
              done: [],
            },
          }),
        }),
      ),
    ).toEqual({ word: 'Checking 4/4', tone: 'run', detail: 'round 2 · 7:23' });
    expect(
      words(
        summary('r', {
          agent: { state: 'ready', kind: 'claude' },
          hive: hive({ step: 'reviewing' }),
        }),
      ),
    ).toEqual({ word: 'Reviewing', tone: 'run', detail: 'round 1' });
  });

  it('says landing, paused, stopped and landed in their own words and tones', () => {
    expect(
      words(
        summary('l', {
          agent: { state: 'ready', kind: 'claude' },
          hive: hive({
            step: 'landing',
            landing: {
              ...landed(at(3, 13)),
              ended: undefined,
              outcome: undefined,
              state: 'checking',
            },
          }),
        }),
      ),
    ).toEqual({ word: 'Landing', tone: 'run', detail: 'checking the merge' });
    expect(
      words(
        summary('p', {
          agent: { state: 'ready', kind: 'claude' },
          hive: hive({
            pause: {
              reason: 'usage',
              pauseAt: 90,
              percent: 92,
              minutes: 300,
              since: at(3, 13),
              until: at(3, 15),
            },
          }),
        }),
      ).word,
    ).toBe('Paused');
    expect(
      words(
        summary('p', {
          agent: { state: 'ready', kind: 'claude' },
          hive: hive({
            pause: {
              reason: 'usage',
              pauseAt: 90,
              percent: 92,
              minutes: 300,
              since: at(3, 13),
              until: at(3, 15),
            },
          }),
        }),
      ).tone,
    ).toBe('info');
    expect(
      words(
        summary('s', {
          agent: { state: 'ready', kind: 'claude' },
          hive: hive({ step: 'stuck', round: 3, note: 'the check failed 3 times: pnpm test:e2e' }),
        }),
      ),
    ).toEqual({ word: 'Stopped', tone: 'fail', detail: '3 of 3 rounds' });
    expect(
      words(
        summary('b', {
          agent: { state: 'ready', kind: 'claude' },
          hive: hive({
            step: 'stuck',
            note: 'its spend reached its budget: $5.02 of $5.00 (writer $4.10, reviews $0.92). Raise the budget',
          }),
        }),
      ),
    ).toEqual({ word: 'Stopped', tone: 'fail', detail: 'budget reached' });
    expect(
      words(
        summary('d', {
          merged: true,
          hive: hive({ step: 'landed', landing: landed(at(3, 12)) }),
        }),
      ),
    ).toEqual({ word: 'Landed', tone: 'ok', detail: 'into main' });
  });

  it("says a request waiting for the person's merge in the person's violet (HV8)", () => {
    expect(
      words(
        summary('q', {
          agent: { state: 'ready', kind: 'claude' },
          hive: hive({
            step: 'landing',
            landing: { ...landed(at(3, 13)), ended: undefined, outcome: undefined, via: 'request' },
            request: {
              forge: 'github',
              number: 12,
              url: 'https://github.com/acme/app/pull/12',
              into: 'main',
              at: TIP,
              opened: at(3, 13),
              state: 'open',
            },
          }),
        }),
      ),
    ).toEqual({ word: 'Waiting for your merge', tone: 'you', detail: '#12 on GitHub' });
  });
});
