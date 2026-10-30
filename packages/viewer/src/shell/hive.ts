// Hive mode (V82): kept for this person on this machine by `symbiote view` (decision 611), and
// written on <html> as `data-hive` with the page (decision 612), so the look is there from the
// first paint. This module reads it, turns it on or off from Settings, and keeps the tab's icon in
// step (decision 616).
import { useSyncExternalStore } from 'react';
import { postJson } from '../ui/http.js';
import favicon from './favicon.png';
import faviconHive from './favicon-hive.png';

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

/** Turns Hive mode on or off for every page and window; the look follows once it is kept. */
export async function setHive(on: boolean): Promise<void> {
  const kept = await postJson<{ on: boolean }>('/api/hive', { on });
  if (kept.on) document.documentElement.dataset.hive = 'on';
  else delete document.documentElement.dataset.hive;
  showTabIcon(kept.on);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether Hive mode is on, updated when Settings turns it on or off. */
export function useHive(): boolean {
  return useSyncExternalStore(subscribe, isHive);
}
