import type { UsageSubscription } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  resetText,
  shownWindows,
  showsAge,
  usageTitle,
  usageTone,
  windowLabel,
} from '../src/usage.js';

// The status bar's usage (V29c): each window by its length, its tone, and what a hover says.
const NOW = Date.parse('2026-10-20T16:15:00Z');
const MIN = 60_000;

describe('windowLabel', () => {
  it('names a window by its length, as the vendor reports it (decision 173)', () => {
    expect(windowLabel(300)).toBe('5h');
    expect(windowLabel(10_080)).toBe('wk');
    expect(windowLabel(43_200)).toBe('30d');
    expect(windowLabel(1_440)).toBe('1d');
    expect(windowLabel(120)).toBe('2h');
    expect(windowLabel(90)).toBe('90m');
  });
});

describe('usageTone', () => {
  it('is green under 80 %, amber from 80 %, red at 100 % or when the vendor says a limit is reached', () => {
    expect(usageTone(0)).toBe('ok');
    expect(usageTone(79.6)).toBe('ok');
    expect(usageTone(80)).toBe('high');
    expect(usageTone(99)).toBe('high');
    expect(usageTone(100)).toBe('full');
    expect(usageTone(12, true)).toBe('full');
    // The vendor's own warning, where it gives one (Claude: 79 % read "warning").
    expect(usageTone(79, false, true)).toBe('high');
  });
});

describe('resetText', () => {
  it('says when a window starts again, from now', () => {
    expect(resetText('2026-10-20T20:00:00Z', NOW)).toBe('resets in 3 h 45 min');
    expect(resetText('2026-10-20T16:20:30Z', NOW)).toBe('resets in 6 min');
    expect(resetText('2026-10-25T22:00:00Z', NOW)).toBe('resets in 5 days 5 h');
    expect(resetText('2026-10-20T16:00:00Z', NOW)).toBe('has reset');
  });
});

const claude: UsageSubscription = {
  agent: 'claude',
  plan: 'Pro',
  windows: [
    { minutes: 300, usedPercent: 59, resetsAt: '2026-10-20T20:00:00Z' },
    { minutes: 10_080, usedPercent: 66.4, resetsAt: '2026-10-25T22:00:00Z' },
    { minutes: 10_080, usedPercent: 12, resetsAt: '2026-10-25T22:00:00Z', scope: 'opus' },
  ],
  at: new Date(NOW - 30_000).toISOString(),
  source: 'live',
};

describe('shownWindows and usageTitle', () => {
  it("shows the plan's own windows in the bar; a model's own only on hover", () => {
    expect(shownWindows(claude).map((w) => windowLabel(w.minutes))).toEqual(['5h', 'wk']);
  });

  it('says on hover what each window is, when it resets and how old the numbers are', () => {
    expect(usageTitle(claude, NOW)).toBe(
      [
        'Claude Pro',
        '5h: 59 % used, resets in 3 h 45 min',
        'wk: 66 % used, resets in 5 days 5 h',
        'wk (opus): 12 % used, resets in 5 days 5 h',
        'Read just now',
      ].join('\n'),
    );
  });

  it('says a copy is a copy, how old, and why', () => {
    const copy: UsageSubscription = {
      agent: 'claude',
      plan: 'Pro',
      windows: [{ minutes: 10_080, usedPercent: 22 }],
      at: new Date(NOW - 17 * 60 * MIN).toISOString(),
      source: 'cached',
      note: "Claude Code's token has expired",
    };
    expect(usageTitle(copy, NOW)).toBe(
      [
        'Claude Pro',
        'wk: 22 % used',
        "Claude Code's copy, 17 hours ago: Claude Code's token has expired",
      ].join('\n'),
    );
    expect(showsAge(copy)).toBe(true);
  });

  it('says when live numbers were not read again, and why; their age shows in the bar', () => {
    const kept: UsageSubscription = {
      ...claude,
      at: new Date(NOW - 4 * MIN).toISOString(),
      note: "Claude's usage asked to wait (429)",
    };
    expect(usageTitle(kept, NOW).split('\n').at(-1)).toBe(
      "Read 4 minutes ago, not since: Claude's usage asked to wait (429)",
    );
    expect(showsAge(kept)).toBe(true);
    expect(showsAge(claude)).toBe(false);
  });
});
