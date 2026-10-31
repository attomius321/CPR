import { describe, expect, it } from 'vitest';
import type { HiveLive } from '@symbiote/core';
import { aboutWords, checkSteps, clockWords, liveWords } from '../src/workspaces/hive-live.js';

const T0 = Date.parse('2026-10-31T10:00:00.000Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const COMMANDS = ['pnpm install --frozen-lockfile', 'pnpm check', 'pnpm build', 'pnpm test:e2e'];

const check = (over: Partial<Extract<HiveLive, { kind: 'check' }>> = {}): HiveLive => ({
  kind: 'check',
  started: at(0),
  commands: COMMANDS,
  step: 3,
  since: at(150),
  done: [
    { ok: true, ms: 20_000 },
    { ok: true, ms: 70_000 },
    { ok: true, ms: 60_000 },
  ],
  ...over,
});

describe('the words of what Hive runs now (decisions 697, 699)', () => {
  it('times on a clock, and an expected time rounded', () => {
    expect(clockWords(0)).toBe('0:00');
    expect(clockWords(42_400)).toBe('0:42');
    expect(clockWords(252_000)).toBe('4:12');
    expect(clockWords(3_723_000)).toBe('1:02:03');
    expect(clockWords(-5)).toBe('0:00');
    expect(aboutWords(40_000)).toBe('~40 s');
    expect(aboutWords(420_000)).toBe('~7 min');
    expect(aboutWords(449_000)).toBe('~7 min');
    expect(aboutWords(3_900_000)).toBe('~1 h 5 min');
    expect(aboutWords(3_600_000)).toBe('~1 h');
  });

  it("a check of several commands: the one running, its place, the check's time against the last one's", () => {
    const live = check({ expected: { ms: 420_000, steps: [20_000, 70_000, 60_000, 270_000] } });
    expect(liveWords({ live }, T0 + 252_000)).toEqual({
      head: 'Checking 4/4',
      time: '4:12 of ~7 min',
      detail: 'pnpm test:e2e',
      line: 'Checking 4/4: pnpm test:e2e · 4:12 of ~7 min',
    });
  });

  it('a first check: the elapsed time only, never a guess', () => {
    expect(
      liveWords({ live: check({ step: 1, done: [{ ok: true, ms: 20_000 }] }) }, T0 + 70_000),
    ).toEqual({
      head: 'Checking 2/4',
      time: '1:10',
      detail: 'pnpm check',
      line: 'Checking 2/4: pnpm check · 1:10',
    });
  });

  it('a check of one command has no place among others', () => {
    const live = check({ commands: ['npm test'], step: 0, since: at(0), done: [] });
    expect(liveWords({ live }, T0 + 42_000)?.line).toBe('Checking: npm test · 0:42');
  });

  it('the running review: its time and what the reviewer runs now; no check found said', () => {
    const review: HiveLive = {
      kind: 'review',
      started: at(0),
      phase: 'review',
      doing: 'Bash: pnpm vitest run x.test.ts',
    };
    expect(liveWords({ live: review }, T0 + 65_000)).toEqual({
      head: 'Reviewing',
      time: '1:05',
      detail: 'Bash: pnpm vitest run x.test.ts',
      line: 'Reviewing · 1:05 · Bash: pnpm vitest run x.test.ts',
    });
    expect(
      liveWords(
        { live: { kind: 'review', started: at(0) }, note: 'no check is set or found: check it' },
        T0 + 35_000,
      )?.line,
    ).toBe('Reviewing · 0:35 · no check found');
    expect(
      liveWords(
        { live: { kind: 'review', started: at(0), phase: 'install', title: 'pnpm install' } },
        T0,
      )?.detail,
    ).toBe('Installing: pnpm install');
    expect(
      liveWords(
        { live: { kind: 'review', started: at(0), phase: 'rerun', title: 'parses a BOM' } },
        T0,
      )?.detail,
    ).toBe('Rerunning parses a BOM');
    expect(
      liveWords({ live: { kind: 'review', started: at(0), phase: 'review' } }, T0)?.detail,
    ).toBe('The reviewer reads the change');
  });

  it('nothing runs: no words', () => {
    expect(liveWords({}, T0)).toBeNull();
  });

  it("the Review tab's steps: each command done, running or waiting, with its time", () => {
    const live = check({ expected: { ms: 420_000, steps: [20_000, 70_000, 60_000, 270_000] } });
    expect(checkSteps(live as Extract<HiveLive, { kind: 'check' }>, T0 + 270_000)).toEqual([
      { command: COMMANDS[0], mark: 'passed', time: '0:20' },
      { command: COMMANDS[1], mark: 'passed', time: '1:10' },
      { command: COMMANDS[2], mark: 'passed', time: '1:00' },
      { command: COMMANDS[3], mark: 'running', time: '2:00 of ~5 min' },
    ]);
    const first = check({ step: 1, since: at(20), done: [{ ok: true, ms: 20_000 }] });
    expect(checkSteps(first as Extract<HiveLive, { kind: 'check' }>, T0 + 30_000)).toEqual([
      { command: COMMANDS[0], mark: 'passed', time: '0:20' },
      { command: COMMANDS[1], mark: 'running', time: '0:10' },
      { command: COMMANDS[2], mark: 'waiting', time: '' },
      { command: COMMANDS[3], mark: 'waiting', time: '' },
    ]);
    const known = check({
      step: 0,
      since: at(0),
      done: [],
      expected: { ms: 420_000, steps: [20_000, 70_000, 60_000, 270_000] },
    });
    expect(
      checkSteps(known as Extract<HiveLive, { kind: 'check' }>, T0 + 5_000).map((s) => s.time),
    ).toEqual(['0:05 of ~20 s', '~1 min', '~1 min', '~5 min']);
  });
});
