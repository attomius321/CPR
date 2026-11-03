// "Today" on the Overview (V91, decision 850): the local calendar day, from the browser's midnight;
// the week's days stepped by the calendar, never by 24 hours (a 23- or 25-hour day is one day).
// Pure: the time zone is the browser's, as `Date` reads it.

/** How many days a figure's bars show, today the last. */
export const DAYS = 7;

const time = (at: string | number) => (typeof at === 'number' ? at : Date.parse(at));

/** Local midnight of the day holding `now`. */
export function dayStart(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** The starts of the last `days` local days, oldest first, today's last. */
export function dayStarts(now: number, days = DAYS): number[] {
  const today = new Date(dayStart(now));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(today);
    // By the calendar: setDate keeps local midnight across a change of the clocks.
    day.setDate(today.getDate() - (days - 1 - i));
    return day.getTime();
  });
}

/** What the day read is asked from: local midnight `DAYS - 1` days back, as an ISO time. */
export const sinceOf = (now: number): string => new Date(dayStarts(now)[0] ?? now).toISOString();

/** The next local midnight after `now`. */
export function nextMidnight(now: number): number {
  const next = new Date(dayStart(now));
  next.setDate(next.getDate() + 1);
  return next.getTime();
}

/** Whether `at` falls on `now`'s local day (not after `now`'s day either). */
export function isToday(at: string | number, now: number): boolean {
  const t = time(at);
  return t >= dayStart(now) && t < nextMidnight(now);
}

/** How many of `times` fall on each of the last `days` local days, oldest first. */
export function perDay(times: readonly (string | number)[], now: number, days = DAYS): number[] {
  const starts = dayStarts(now, days);
  const end = nextMidnight(now);
  const counts = starts.map(() => 0);
  for (const at of times) {
    const t = time(at);
    if (!(t >= (starts[0] ?? end)) || t >= end) continue;
    let i = starts.length - 1;
    while (i > 0 && t < (starts[i] ?? 0)) i -= 1;
    counts[i] = (counts[i] ?? 0) + 1;
  }
  return counts;
}

/** The median of `values`; null when there are none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** A time of day as the feed and tables say it: "09:41", local. */
export function clockOf(at: string | number): string {
  const day = new Date(time(at));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(day.getHours())}:${two(day.getMinutes())}`;
}
