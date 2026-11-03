// V91 (decision 850): "today" is the local calendar day, from local midnight, and a week's days are
// stepped by the calendar: a 25-hour day (Bucharest, 25 October 2026, summer time ends) is one day.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DAYS,
  clockOf,
  dayStart,
  dayStarts,
  isToday,
  median,
  nextMidnight,
  perDay,
  sinceOf,
} from '../src/overview/day.js';

const ms = (iso: string) => Date.parse(iso);
const zone = process.env.TZ;

/** Runs `body` with the process in time zone `tz` (Node reads `TZ` again when it is set). */
function inZone(tz: string, body: () => void) {
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });
  body();
}

describe('in Bucharest (UTC+2, +3 until 25 October 2026)', () => {
  inZone('Europe/Bucharest', () => {
    // 3 November 2026, 10:00 local.
    const now = ms('2026-11-03T08:00:00.000Z');

    it('starts the day at local midnight, not UTC', () => {
      expect(new Date(dayStart(now)).toISOString()).toBe('2026-11-02T22:00:00.000Z');
    });

    it('takes 00:00 local as today and 23:59:59.999 the night before as yesterday', () => {
      expect(isToday('2026-11-02T22:00:00.000Z', now)).toBe(true);
      expect(isToday('2026-11-02T21:59:59.999Z', now)).toBe(false);
      // Tomorrow is not today either.
      expect(isToday('2026-11-03T22:00:00.000Z', now)).toBe(false);
      expect(isToday(now, now)).toBe(true);
    });

    it('steps the week back by calendar days over the 25-hour day', () => {
      const monday = ms('2026-10-27T08:00:00.000Z');
      const starts = dayStarts(monday).map((t) => new Date(t).toISOString());
      expect(starts).toEqual([
        '2026-10-20T21:00:00.000Z',
        '2026-10-21T21:00:00.000Z',
        '2026-10-22T21:00:00.000Z',
        '2026-10-23T21:00:00.000Z',
        '2026-10-24T21:00:00.000Z',
        '2026-10-25T22:00:00.000Z',
        '2026-10-26T22:00:00.000Z',
      ]);
      expect(starts).toHaveLength(DAYS);
      expect(sinceOf(monday)).toBe('2026-10-20T21:00:00.000Z');
    });

    it('counts a time early on the 25-hour day in that day, where 24-hour steps would not', () => {
      const monday = ms('2026-10-27T08:00:00.000Z');
      // 25 October, 00:30 local (21:30 UTC the day before); 24-hour steps back from 27 October's
      // midnight start that day at 01:00 local, and would place it on the 24th.
      const early = '2026-10-24T21:30:00.000Z';
      expect(perDay([early, monday, '2026-10-26T22:00:00.000Z'], monday)).toEqual([
        0, 0, 0, 0, 1, 0, 2,
      ]);
      // Before the first day, and after now's day: in no day.
      expect(perDay(['2026-10-20T20:59:59.999Z', '2026-10-27T22:00:00.000Z'], monday)).toEqual([
        0, 0, 0, 0, 0, 0, 0,
      ]);
    });

    it('finds the next midnight after a 25-hour day', () => {
      expect(new Date(nextMidnight(ms('2026-10-25T07:00:00.000Z'))).toISOString()).toBe(
        '2026-10-25T22:00:00.000Z',
      );
      // At midnight itself: the next one.
      expect(new Date(nextMidnight(ms('2026-11-02T22:00:00.000Z'))).toISOString()).toBe(
        '2026-11-03T22:00:00.000Z',
      );
    });

    it('says a time of day in local hours and minutes', () => {
      expect(clockOf('2026-11-03T07:41:00.000Z')).toBe('09:41');
      expect(clockOf(ms('2026-11-02T22:05:00.000Z'))).toBe('00:05');
    });
  });
});

describe('in Los Angeles (UTC−8)', () => {
  inZone('America/Los_Angeles', () => {
    it('keeps the evening on its own local day, though UTC has turned', () => {
      // 2 November, 22:00 local: 3 November in UTC.
      const now = ms('2026-11-03T06:00:00.000Z');
      expect(new Date(dayStart(now)).toISOString()).toBe('2026-11-02T08:00:00.000Z');
      expect(isToday('2026-11-02T08:00:00.000Z', now)).toBe(true);
      expect(isToday('2026-11-02T07:59:59.999Z', now)).toBe(false);
    });
  });
});

describe('median', () => {
  it('is null without values, the middle one, or the mean of the two middle ones', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
