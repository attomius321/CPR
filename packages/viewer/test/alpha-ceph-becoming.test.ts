import { readFileSync } from 'node:fs';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BECOMING_MS,
  NAME_MS,
  becomeAlphaCeph,
  holdNucleus,
  nucleusPhase,
  scrambled,
  settleNucleus,
  subscribeNucleus,
} from '../src/shell/alpha-ceph.js';
import { iconCells } from '../src/ui/hive-art.js';
import { HiveMindIcon } from '../src/ui/icons.js';

// V86 (decisions 730–734): Nucleus held through Hive's arrival, then becoming Alpha Ceph in the
// sidenav for a moment; never at load.
describe('Nucleus becoming Alpha Ceph: when', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    settleNucleus();
  });
  afterEach(() => {
    settleNucleus();
    vi.useRealTimers();
  });

  it('is nothing at load', () => {
    expect(nucleusPhase()).toBeNull();
  });

  it('holds Nucleus through the arrival, then becomes Alpha Ceph for BECOMING_MS, then is still', () => {
    const told = vi.fn();
    const stop = subscribeNucleus(told);
    holdNucleus();
    expect(nucleusPhase()).toBe('held');
    becomeAlphaCeph();
    expect(nucleusPhase()).toBe('becoming');
    vi.advanceTimersByTime(BECOMING_MS - 1);
    expect(nucleusPhase()).toBe('becoming');
    vi.advanceTimersByTime(1);
    expect(nucleusPhase()).toBeNull();
    expect(told).toHaveBeenCalledTimes(3);
    stop();
  });

  it('plays only after a hold: an arrival this window did not run plays nothing', () => {
    becomeAlphaCeph();
    expect(nucleusPhase()).toBeNull();
  });

  it('turning Hive off ends a hold or a play at once', () => {
    holdNucleus();
    settleNucleus();
    expect(nucleusPhase()).toBeNull();
    becomeAlphaCeph();
    expect(nucleusPhase()).toBeNull();

    holdNucleus();
    becomeAlphaCeph();
    settleNucleus();
    expect(nucleusPhase()).toBeNull();
    // The play's timer, cleared: a new hold is not ended by it.
    holdNucleus();
    vi.advanceTimersByTime(BECOMING_MS);
    expect(nucleusPhase()).toBe('held');
  });

  it('the play outlasts the name and every animation of the icon', () => {
    expect(NAME_MS).toBeLessThan(BECOMING_MS);
    const css = readFileSync(new URL('../src/ui/hive.css', import.meta.url), 'utf8');
    // Every `alpha-ceph-*` animation's end (its delay plus its duration), the last ring cell's
    // delay at k = 6.
    const ends = [
      ...css.matchAll(/animation:\s*alpha-ceph-[\w-]+\s+(\d+)ms[^;]*?(\d+)ms[^;]*;/g),
    ].map(([rule, duration, delay]) => {
      const k = /var\(--k\) \* (\d+)ms/.exec(rule);
      return Number(duration) + Number(delay) + (k ? 6 * Number(k[1]) : 0);
    });
    expect(ends.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...ends)).toBeLessThanOrEqual(BECOMING_MS);
  });
});

describe("Nucleus's name changing over", () => {
  it('starts as Nucleus and ends as Alpha Ceph', () => {
    expect(scrambled('Nucleus', 'Alpha Ceph', 0)).toBe('Nucleus');
    expect(scrambled('Nucleus', 'Alpha Ceph', NAME_MS)).toBe('Alpha Ceph');
    expect(scrambled('Nucleus', 'Alpha Ceph', NAME_MS * 3)).toBe('Alpha Ceph');
  });

  it('scrambles, then locks its letters into the new name left to right', () => {
    const random = () => 0;
    const words = [100, 300, 450, 600, 750].map((ms) =>
      scrambled('Nucleus', 'Alpha Ceph', ms, random),
    );
    let locked = 0;
    for (const word of words) {
      const prefix = [...word].findIndex((letter, i) => letter !== 'Alpha Ceph'[i]);
      const now = prefix < 0 ? word.length : prefix;
      expect(now).toBeGreaterThanOrEqual(locked);
      locked = now;
    }
    expect(words[0]).not.toBe('Nucleus');
    expect(words.at(-1)).not.toBe('Alpha Ceph');
    expect(locked).toBeGreaterThan(5);
  });
});

/** The icon as a component of its props (its props are optional: a list's icons take none). */
const Mind = HiveMindIcon as FunctionComponent<{ becoming?: boolean }>;

describe("Alpha Ceph's icon becoming", () => {
  it('boots the ring cells clockwise from the top, the core first', () => {
    const cells = iconCells();
    expect(cells.map((cell) => cell.order).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(cells.find((cell) => cell.core)?.order).toBe(0);
    const clock = (cell: { x: number; y: number }) =>
      (Math.atan2(cell.x - 12, -(cell.y - 12)) * 180) / Math.PI + 360;
    const ring = cells.filter((cell) => !cell.core).sort((a, b) => a.order - b.order);
    const angles = ring.map((cell) => clock(cell) % 360);
    expect(angles).toEqual([...angles].sort((a, b) => a - b));
    expect(angles[0]).toBeLessThan(60);
  });

  it("draws Nucleus's ring and dot over the Mind's cells while it becomes; still, only the cells", () => {
    const becoming = renderToStaticMarkup(createElement(Mind, { becoming: true }));
    expect(becoming).toContain('class="icon hive-mind-icon becoming"');
    expect(becoming).toMatch(/<circle class="was-ring" cx="12" cy="12" r="10" pathLength="60"/);
    expect(becoming).toMatch(/<circle class="was-dot" cx="12" cy="12" r="1"/);
    expect(becoming).toContain('class="flare"');
    expect(becoming.match(/style="--k:\d"/g)).toHaveLength(7);

    const still = renderToStaticMarkup(createElement(Mind));
    expect(still).toContain('class="icon hive-mind-icon"');
    expect(still).not.toMatch(/was-|flare|--k/);
    expect(still.match(/class="plate"/g)).toHaveLength(7);
  });
});
