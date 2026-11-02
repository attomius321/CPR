import { mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HiveReview, ThreadEntry, UsageSubscription } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { parseHivePacing } from '../src/server-requests.js';
import {
  costIn,
  hivePacing,
  hivePacingService,
  readPacingConfig,
  setPacing,
  spendOf,
  transcriptCosts,
  usagePause,
  writerTranscripts,
} from '../src/hive-pacing.js';
import type { ClaudeUsageRead } from '../src/usage.js';

// Hive paces itself (HV5, decisions 796–801): the threshold and the budget in the project's config,
// the pause a read of Claude's windows gives, and what a workspace spent by Claude Code's count.
const NOW = Date.parse('2026-11-02T14:00:00Z');
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

let root: string;
beforeEach(() => {
  root = tempDir();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const config = (value: unknown) => {
  mkdirSync(join(root, 'symbiote'), { recursive: true });
  writeFileSync(join(root, 'symbiote', 'config.json'), JSON.stringify(value));
};
const written = () =>
  JSON.parse(readFileSync(join(root, 'symbiote', 'config.json'), 'utf8')) as unknown;

/** Claude's numbers read at `at`: the 5-hour window and the week. */
const claude = (
  session: number,
  week: number,
  at = NOW,
  more: UsageSubscription['windows'] = [],
): UsageSubscription => ({
  agent: 'claude',
  windows: [
    { minutes: 300, usedPercent: session, resetsAt: '2026-11-02T16:10:00.000Z' },
    { minutes: 10_080, usedPercent: week, resetsAt: '2026-11-08T22:00:00.000Z' },
    ...more,
  ],
  at: iso(at),
  source: 'live',
});

describe('the settings', () => {
  it('pauses at 90 % with no budget unless the project says otherwise', () => {
    expect(readPacingConfig(root)).toEqual({ pauseAt: 90, budget: null });
    config({ hive: { usage: { pauseAt: 75 }, budget: 20 } });
    expect(readPacingConfig(root)).toEqual({ pauseAt: 75, budget: 20 });
    config({ hive: { usage: { pauseAt: false }, budget: 12.5 } });
    expect(readPacingConfig(root)).toEqual({ pauseAt: false, budget: 12.5 });
    // What is not a threshold or a budget is the default.
    for (const [pauseAt, budget] of [
      [0, 0],
      [101, -1],
      ['80', '20'],
      [null, null],
    ]) {
      config({ hive: { usage: { pauseAt }, budget } });
      expect(readPacingConfig(root)).toEqual({ pauseAt: 90, budget: null });
    }
    writeFileSync(join(root, 'symbiote', 'config.json'), '{ not json');
    expect(readPacingConfig(root)).toEqual({ pauseAt: 90, budget: null });
  });

  it('writes them next to the other hive keys; the defaults as no key', async () => {
    config({ hive: { lands: 'request' } });
    await setPacing(root, { pauseAt: 80, budget: 25 });
    expect(written()).toEqual({ hive: { lands: 'request', usage: { pauseAt: 80 }, budget: 25 } });
    await setPacing(root, { pauseAt: false });
    expect(written()).toEqual({
      hive: { lands: 'request', usage: { pauseAt: false }, budget: 25 },
    });
    await setPacing(root, { pauseAt: 90, budget: null });
    expect(written()).toEqual({ hive: { lands: 'request' } });
  });

  it('refuses what is not a threshold or a budget', async () => {
    for (const change of [{ pauseAt: 0 }, { pauseAt: 100.5 }, { pauseAt: '80' }, { budget: 0 }]) {
      await expect(setPacing(root, change as never)).rejects.toMatchObject({ status: 400 });
    }
    await expect(setPacing(root, { budget: 1_000_001 })).rejects.toMatchObject({ status: 400 });
  });
});

describe('the pause a read gives', () => {
  const read = (subscription: UsageSubscription | null, failed?: string): ClaudeUsageRead => ({
    subscription,
    ...(failed ? { failed } : {}),
  });

  it('none under the threshold; at it, the window and its reset', () => {
    expect(usagePause(read(claude(89, 40)), 90, NOW)).toBeNull();
    expect(usagePause(read(claude(90, 40)), 90, NOW)).toEqual({
      reason: 'usage',
      minutes: 300,
      percent: 90,
      pauseAt: 90,
      until: '2026-11-02T16:10:00.000Z',
    });
  });

  it('of the windows over, the one that resets last; a reset window says nothing', () => {
    expect(usagePause(read(claude(95, 91)), 90, NOW)).toMatchObject({
      minutes: 10_080,
      percent: 91,
      until: '2026-11-08T22:00:00.000Z',
    });
    const scoped = claude(20, 40, NOW, [
      { minutes: 10_080, usedPercent: 93, resetsAt: '2026-11-07T10:00:00.000Z', scope: 'opus' },
    ]);
    expect(usagePause(read(scoped), 90, NOW)).toMatchObject({ scope: 'opus', percent: 93 });
    // Read at 16:05, asked at 16:11: the 5-hour window has reset since.
    const later = Date.parse('2026-11-02T16:11:00Z');
    expect(usagePause(read(claude(97, 40, later - 6 * MIN)), 90, later)).toBeNull();
    // A window that does not say when it resets is the last to.
    const unsaid = claude(95, 92, NOW, [{ minutes: 10_080, usedPercent: 99 }]);
    const pause = usagePause(read(unsaid), 90, NOW);
    expect(pause).toMatchObject({ percent: 99 });
    expect(pause?.until).toBeUndefined();
  });

  it('the last read stands for 15 minutes; after that, or with none, usage is unknown', () => {
    expect(usagePause(read(claude(40, 40, NOW - 15 * MIN), '429'), 90, NOW)).toBeNull();
    expect(
      usagePause(
        read(claude(40, 40, NOW - 15 * MIN - 1), "Claude's usage asked to wait (429)"),
        90,
        NOW,
      ),
    ).toEqual({
      reason: 'unknown',
      pauseAt: 90,
      why: "Claude's usage asked to wait (429)",
    });
    expect(usagePause(read(null, "Claude Code's token could not be read"), 90, NOW)).toEqual({
      reason: 'unknown',
      pauseAt: 90,
      why: "Claude Code's token could not be read",
    });
    expect(usagePause(read(null), 90, NOW)).toMatchObject({
      reason: 'unknown',
      why: "Claude's usage has not been read",
    });
    expect(usagePause({ subscription: null, off: true }, 90, NOW)).toBeNull();
  });
});

describe("Hive's gate", () => {
  /** A usage function whose answers the test sets, and how often it was asked. */
  function usage(first: ClaudeUsageRead) {
    let answer = first;
    let reads = 0;
    return {
      read: (maxAgeMs: number) => {
        reads += 1;
        expect(maxAgeMs).toBe(5 * MIN);
        return Promise.resolve(answer);
      },
      set: (next: ClaudeUsageRead) => {
        answer = next;
      },
      reads: () => reads,
    };
  }

  it('holds a pause until the window resets without reading again, then reads and goes on', async () => {
    let now = NOW;
    const fake = usage({ subscription: claude(92, 40) });
    const gate = hivePacing({ root, usage: fake.read, now: () => new Date(now) });
    const pause = await gate.usage();
    expect(pause).toEqual({
      reason: 'usage',
      minutes: 300,
      percent: 92,
      pauseAt: 90,
      until: '2026-11-02T16:10:00.000Z',
      since: iso(NOW),
    });
    now += 30 * MIN;
    expect(await gate.usage()).toEqual(pause);
    expect(fake.reads()).toBe(1);
    expect(gate.current()).toEqual(pause);
    now = Date.parse('2026-11-02T16:10:01Z');
    fake.set({ subscription: claude(3, 40, now) });
    expect(await gate.usage()).toBeNull();
    expect(fake.reads()).toBe(2);
    expect(gate.current()).toBeNull();
  });

  it('reads again once the threshold is raised past the pause', async () => {
    const fake = usage({ subscription: claude(92, 40) });
    const gate = hivePacing({ root, usage: fake.read, now: () => new Date(NOW) });
    expect(await gate.usage()).toMatchObject({ percent: 92 });
    config({ hive: { usage: { pauseAt: 95 } } });
    expect(await gate.usage()).toBeNull();
    expect(fake.reads()).toBe(2);
  });

  it('asks again at each look while usage is unknown, keeping when it paused', async () => {
    let now = NOW;
    const fake = usage({ subscription: null, failed: "Claude's usage answered 500" });
    const gate = hivePacing({ root, usage: fake.read, now: () => new Date(now) });
    expect(await gate.usage()).toMatchObject({ reason: 'unknown', since: iso(NOW) });
    now += 5 * MIN;
    expect(await gate.usage()).toMatchObject({ reason: 'unknown', since: iso(NOW) });
    expect(fake.reads()).toBe(2);
    fake.set({ subscription: claude(30, 40, now) });
    expect(await gate.usage()).toBeNull();
  });

  it('reads nothing with pauseAt false; a usage function that throws is usage unknown', async () => {
    config({ hive: { usage: { pauseAt: false } } });
    const fake = usage({ subscription: claude(99, 99) });
    const gate = hivePacing({ root, usage: fake.read, now: () => new Date(NOW) });
    expect(await gate.usage()).toBeNull();
    expect(fake.reads()).toBe(0);
    rmSync(join(root, 'symbiote'), { recursive: true });
    const failing = hivePacing({
      root,
      usage: () => Promise.reject(new Error('no answer')),
      now: () => new Date(NOW),
    });
    expect(await failing.usage()).toMatchObject({ reason: 'unknown', why: 'no answer' });
  });

  it('is primed with the pauses Hive recorded: a restart holds them without a read', async () => {
    const fake = usage({ subscription: claude(10, 10) });
    const gate = hivePacing({ root, usage: fake.read, now: () => new Date(NOW) });
    const recorded = {
      reason: 'usage' as const,
      minutes: 300,
      percent: 93,
      pauseAt: 90,
      until: '2026-11-02T16:10:00.000Z',
      since: '2026-11-02T13:40:00.000Z',
    };
    gate.prime([
      { ...recorded, until: '2026-11-02T13:59:00.000Z', percent: 99 },
      recorded,
      { reason: 'unknown', pauseAt: 90, why: 'x', since: '2026-11-02T13:00:00.000Z' },
    ]);
    expect(await gate.usage()).toEqual(recorded);
    expect(fake.reads()).toBe(0);
  });
});

describe('what a workspace spent', () => {
  const state = (total: number) =>
    JSON.stringify({ type: 'cost-state', sessionId: 's', totalCostUSD: total, modelUsage: {} });

  it("reads Claude Code's own count: the last cost-state line", () => {
    const lines = [
      '{"type":"user","message":{"content":"go"}}',
      state(1.78),
      '{"type":"assistant","message":{"content":[]}}',
      state(14.87),
      '{"type":"system","subtype":"turn_duration"}',
    ];
    expect(costIn(lines.join('\n'))).toBe(14.87);
    expect(costIn('{"type":"user"}\n')).toBeUndefined();
    expect(costIn('{"type":"cost-state","totalCostUSD":"1"}')).toBeUndefined();
  });

  it('reads a transcript again only when it changed; its whole once when its end has none', async () => {
    const path = join(root, 'session.jsonl');
    writeFileSync(
      path,
      `${state(2)}\n${'{"type":"assistant","x":"' + 'y'.repeat(300_000) + '"}'}\n`,
    );
    let windows = 0;
    const costs = transcriptCosts({
      window: async (file, bytes) => {
        windows += 1;
        const { fileWindow } = await import('../src/thread.js');
        return fileWindow(file, bytes);
      },
    });
    // Past the end's 256 KB: the whole file, once.
    expect(await costs.of(path)).toBe(2);
    expect(windows).toBe(2);
    expect(await costs.of(path)).toBe(2);
    expect(windows).toBe(2);
    appendFileSync(path, `${state(3.5)}\n`);
    expect(await costs.of(path)).toBe(3.5);
    expect(windows).toBe(3);
    appendFileSync(path, '{"type":"user"}\n');
    // An end without one keeps the count read before.
    expect(await costs.of(path)).toBe(3.5);
    expect(await costs.of(join(root, 'gone.jsonl'))).toBeUndefined();
  });

  it("the writer's transcripts are those its thread names, absolute .jsonl files, once each", () => {
    const thread: ThreadEntry[] = [
      {
        at: '1',
        kind: 'start',
        source: 'startup',
        transcript: '/home/a/.claude/projects/w/s1.jsonl',
      },
      { at: '2', kind: 'prompt', text: 'go', transcript: '/home/a/.claude/projects/w/s1.jsonl' },
      { at: '3', kind: 'start', source: 'resume', transcript: 'relative/s2.jsonl' },
      {
        at: '4',
        kind: 'start',
        source: 'resume',
        transcript: '/home/a/.claude/projects/w/s3.json',
      },
      {
        at: '5',
        kind: 'start',
        source: 'resume',
        transcript: '/home/a/.claude/projects/w/s4.jsonl',
      },
    ] as ThreadEntry[];
    expect(writerTranscripts(thread)).toEqual([
      '/home/a/.claude/projects/w/s1.jsonl',
      '/home/a/.claude/projects/w/s4.jsonl',
    ]);
  });

  it('adds the writer and the reviews that have a cost', () => {
    const review = (cost?: number): HiveReview => ({
      round: 1,
      at: 'a',
      verdict: 'approved',
      ms: 1,
      findings: [],
      ...(cost === undefined ? {} : { cost }),
    });
    expect(spendOf({ reviews: [review(3.07), review(), review(1.35)] }, 29.18, null)).toEqual({
      writer: 29.18,
      reviews: 4.42,
      reviewed: 2,
      total: 33.6,
    });
    expect(spendOf({ reviews: [] }, undefined, 20)).toEqual({
      reviews: 0,
      reviewed: 0,
      total: 0,
      budget: 20,
    });
  });
});

describe("Settings' pacing", () => {
  it('says the threshold, the budget, whether usage is read and the pause now; writes a change', async () => {
    const pause = {
      reason: 'usage' as const,
      minutes: 300,
      percent: 92,
      pauseAt: 90,
      until: '2026-11-02T16:10:00.000Z',
      since: '2026-11-02T14:00:00.000Z',
    };
    const service = hivePacingService(root, { current: () => pause }, { read: true });
    expect(await service.read()).toEqual({ pauseAt: 90, budget: null, read: true, pause });
    expect(await service.set({ pauseAt: 80, budget: 30 })).toMatchObject({
      pauseAt: 80,
      budget: 30,
    });
    expect(written()).toEqual({ hive: { usage: { pauseAt: 80 }, budget: 30 } });
    // SYMBIOTE_USAGE=off: nothing read, no pause said.
    const off = hivePacingService(root, { current: () => pause }, { read: false });
    expect(await off.read()).toEqual({ pauseAt: 80, budget: 30, read: false });
  });

  it("reads a request's change: a percent or false, dollars or null", () => {
    expect(parseHivePacing('{"pauseAt":80}')).toEqual({ pauseAt: 80 });
    expect(parseHivePacing('{"pauseAt":false,"budget":null}')).toEqual({
      pauseAt: false,
      budget: null,
    });
    for (const body of ['{}', '{"pauseAt":"80"}', '{"budget":"5"}', 'null', '{"pauseAt":true}']) {
      expect(() => parseHivePacing(body)).toThrow();
    }
  });
});
