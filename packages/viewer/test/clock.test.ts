import { describe, expect, it, vi } from 'vitest';
import { longAge, makeClock } from '../src/workspaces/clock.js';

// The page's one clock for elapsed times (V48): one timer for every reader, none without readers,
// no tick while the page is hidden.
describe('makeClock (V48)', () => {
  const fake = () => {
    let time = 1_000;
    let visible = true;
    const timers = new Map<number, () => void>();
    let next = 1;
    const clock = makeClock(30_000, {
      now: () => time,
      visible: () => visible,
      setTimer: (tick) => {
        timers.set(next, tick);
        return next++;
      },
      clearTimer: (id) => timers.delete(id),
    });
    return {
      clock,
      timers,
      advance: (ms: number) => {
        time += ms;
        for (const tick of timers.values()) tick();
      },
      hide: (hidden: boolean) => (visible = !hidden),
    };
  };

  it('starts one timer for its first reader and stops it with its last', () => {
    const { clock, timers } = fake();
    const a = clock.subscribe(() => {});
    const b = clock.subscribe(() => {});
    expect(timers.size).toBe(1);
    a();
    expect(timers.size).toBe(1);
    b();
    expect(timers.size).toBe(0);
  });

  it('tells every reader the new time at each tick', () => {
    const { clock, advance } = fake();
    const card = vi.fn();
    const header = vi.fn();
    clock.subscribe(card);
    clock.subscribe(header);
    advance(30_000);
    expect([card.mock.calls.length, header.mock.calls.length]).toEqual([1, 1]);
    expect(clock.snapshot()).toBe(31_000);
  });

  it('does not tick while the page is hidden', () => {
    const { clock, advance, hide } = fake();
    const told = vi.fn();
    clock.subscribe(told);
    hide(true);
    advance(30_000);
    expect(told).not.toHaveBeenCalled();
    hide(false);
    advance(30_000);
    expect(told).toHaveBeenCalledOnce();
    expect(clock.snapshot()).toBe(61_000);
  });
});

describe('longAge (V48)', () => {
  const now = Date.parse('2026-10-25T14:00:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('says how long, in minutes, hours and days', () => {
    expect(longAge(ago(20_000), now)).toBe('under a minute');
    expect(longAge(ago(60_000), now)).toBe('1 min');
    expect(longAge(ago(12 * 60_000), now)).toBe('12 min');
    expect(longAge(ago(60 * 60_000), now)).toBe('1 h');
    expect(longAge(ago(125 * 60_000), now)).toBe('2 h 5 min');
    expect(longAge(ago(26 * 60 * 60_000), now)).toBe('1 d 2 h');
    expect(longAge(ago(3 * 24 * 60 * 60_000), now)).toBe('3 d');
    // A time ahead of the page's clock (another machine's): now.
    expect(longAge(ago(-90_000), now)).toBe('under a minute');
  });
});
