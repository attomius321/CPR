// The page's one clock for elapsed times (V48): every "12m" on a card and "12 min" in a header
// reads it, so a tick renders those times alone, not the sidenav or the panel around them.
import { useSyncExternalStore } from 'react';

/** How often the times move: they say minutes. */
const EVERY_MS = 30_000;

export interface Clock {
  subscribe: (listener: () => void) => () => void;
  snapshot: () => number;
}

/**
 * A clock ticking every `every` ms while it has readers and the page is shown: one timer for them
 * all, started by the first and stopped by the last; no tick while the page is hidden.
 */
export function makeClock(
  every: number,
  {
    now = Date.now,
    visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    setTimer = (tick: () => void) => setInterval(tick, every) as unknown as number,
    clearTimer = (id: number) => clearInterval(id),
  }: {
    now?: () => number;
    visible?: () => boolean;
    setTimer?: (tick: () => void) => number;
    clearTimer?: (id: number) => void;
  } = {},
): Clock {
  let current = now();
  let timer: number | undefined;
  const listeners = new Set<() => void>();
  const tick = () => {
    if (!visible()) return;
    current = now();
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (timer === undefined) {
        current = now();
        timer = setTimer(tick);
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', tick);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || timer === undefined) return;
        clearTimer(timer);
        timer = undefined;
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', tick);
      };
    },
    snapshot: () => current,
  };
}

const minutes = makeClock(EVERY_MS);

/** The page's time, moved every 30 s while it is shown (V48). */
export function useNow(): number {
  return useSyncExternalStore(minutes.subscribe, minutes.snapshot);
}

/** How long since `iso`, in words for a heading: "12 min", "2 h 5 min", "1 d 2 h". */
export function longAge(iso: string, now: number): string {
  const total = Math.floor((now - Date.parse(iso)) / 60_000);
  if (total < 1) return 'under a minute';
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  if (hours < 24) return total % 60 === 0 ? `${hours} h` : `${hours} h ${total % 60} min`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`;
}

const seconds = makeClock(1000);

/**
 * The time, moved every second while it is shown (V73): only the Activity tab's live strip reads
 * it, for how long the call running has run; the rest of the page keeps the 30 s clock.
 */
export function useSeconds(): number {
  return useSyncExternalStore(seconds.subscribe, seconds.snapshot);
}

const still: Clock = { subscribe: () => () => undefined, snapshot: () => 0 };

/**
 * The time each second while `on` (Hive's live progress, decision 699: a card's tip that ticks),
 * else 0 and no timer: a component that ticks only while something runs.
 */
export function useSecondsWhile(on: boolean): number {
  const clock = on ? seconds : still;
  return useSyncExternalStore(clock.subscribe, clock.snapshot);
}
