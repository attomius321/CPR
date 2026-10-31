// Hive mode (V82): kept for this repository by its `symbiote view` (decision 621), and written on
// <html> as `data-hive` with the page (decision 612), so the look is there from the first paint.
// This module reads it, turns it on or off from Settings, and keeps the tab's icon in step
// (decision 616). On, the Hive Mind and a hex shutter take the page (decision 673,
// `hive-arrival.ts`); off, a short fade.
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { postJson } from '../ui/http.js';
import favicon from './favicon.png';
import faviconHive from './favicon-hive.png';
import { arrive, lessMotion, type Origin } from './hive-arrival.js';

/** Whether Hive mode is on, as the page says. */
export function isHive(): boolean {
  return document.documentElement.dataset.hive === 'on';
}

const listeners = new Set<() => void>();

/** The tab's icon for the mode: the crimson S while Hive mode is on. */
export function showTabIcon(on = isHive()): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = on ? faviconHive : favicon;
}

/** The page in the mode's look, every listener told, all drawn before it returns. */
function show(on: boolean, then?: () => void): void {
  flushSync(() => {
    if (on) document.documentElement.dataset.hive = 'on';
    else delete document.documentElement.dataset.hive;
    showTabIcon(on);
    for (const listener of listeners) listener();
    then?.();
  });
}

/**
 * Turns Hive mode on or off for this repository's pages; the look follows once it is kept, and
 * `then` runs as it changes (the question closing under the shutter). On, the Hive Mind grows
 * from `from` (the question's; the window's middle without one); off, the page fades. Resolves once
 * the look has changed; the arrival goes on to its end.
 */
export async function setHive(
  on: boolean,
  { from, then }: { from?: Origin; then?: () => void } = {},
): Promise<void> {
  const kept = await postJson<{ on: boolean }>('/api/hive', { on });
  if (kept.on === isHive() || lessMotion()) return show(kept.on, then);
  if (kept.on) {
    const origin = from ?? { x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 1 };
    return new Promise((resolve) => {
      void arrive(origin, () => {
        show(true, then);
        resolve();
      });
    });
  }
  if (!document.startViewTransition) return show(false, then);
  const root = document.documentElement;
  root.dataset.hiveLeaving = '';
  const fade = document.startViewTransition(() => show(false, then));
  void fade.finished.finally(() => delete root.dataset.hiveLeaving);
  await fade.updateCallbackDone;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether Hive mode is on, updated when Settings turns it on or off. */
export function useHive(): boolean {
  return useSyncExternalStore(subscribe, isHive);
}
