// Nucleus becoming Alpha Ceph (V86, decisions 730–734): as this window turns Hive on, Nucleus keeps
// its name and icon through the arrival (held), then the sidenav's link plays the change for
// BECOMING_MS (becoming), then all is Alpha Ceph and still. Never at load, never in a window that
// did not run the arrival, never with reduced motion: then there is no hold, so nothing plays.
import { useSyncExternalStore } from 'react';

/** Where Nucleus is in its change: held through the arrival, becoming, or neither. */
export type NucleusPhase = 'held' | 'becoming' | null;

/** How long the sidenav plays the change: every `alpha-ceph-*` animation in `hive.css` ends by it. */
export const BECOMING_MS = 1250;

/** When the name has changed over, every letter locked. */
export const NAME_MS = 835;

let phase: NucleusPhase = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: NucleusPhase): void {
  if (next === phase) return;
  phase = next;
  for (const listener of listeners) listener();
}

/** Where Nucleus is now. */
export function nucleusPhase(): NucleusPhase {
  return phase;
}

/** Nucleus kept as it is while Hive's arrival runs. */
export function holdNucleus(): void {
  clearTimeout(timer);
  set('held');
}

/** The arrival is still: a held Nucleus plays its change, then rests as Alpha Ceph. */
export function becomeAlphaCeph(): void {
  if (phase !== 'held') return;
  set('becoming');
  timer = setTimeout(() => set(null), BECOMING_MS);
}

/** No hold and no play (Hive turned off, or the change over). */
export function settleNucleus(): void {
  clearTimeout(timer);
  set(null);
}

/** Calls `listener` whenever the phase changes; returns the unsubscribe. */
export function subscribeNucleus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Where Nucleus is in its change, again as it moves on. */
export function useNucleusPhase(): NucleusPhase {
  return useSyncExternalStore(subscribeNucleus, nucleusPhase, nucleusPhase);
}

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * `from` changing over to `to`, `ms` in: from the left, each letter starts to scramble 30 ms after
 * the one before, and locks into its letter of `to` 65 ms after the one before, the last at
 * `NAME_MS`. Letters `from` lacks appear as they start.
 */
export function scrambled(from: string, to: string, ms: number, random = Math.random): string {
  const length = Math.max(from.length, to.length);
  let word = '';
  for (let i = 0; i < length; i++) {
    const locks = NAME_MS - (length - 1 - i) * 65;
    const starts = 20 + i * 30;
    if (ms >= locks) word += to[i] ?? '';
    else if (ms >= starts) word += GLYPHS[Math.floor(random() * GLYPHS.length)];
    else word += from[i] ?? '';
  }
  return word;
}
