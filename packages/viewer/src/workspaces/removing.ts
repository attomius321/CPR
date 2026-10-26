// Workspaces being cleaned up and merges being removed (V57): a clean-up runs ~1.7 s and its card
// goes with the list's next read, ~1 s later; meanwhile the card is disabled and says so. Held
// from the request until that read, or until the server refused it.
import { useSyncExternalStore } from 'react';

/** How many removals of each key are under way: a head's and its card's may overlap. */
const removals = new Map<string, number>();
const listeners = new Set<() => void>();
const tell = () => {
  for (const listener of listeners) listener();
};

/** A workspace's key, by its branch. */
export const workspaceKey = (branch: string): string => `workspace ${branch}`;

/** A merge's key, by its id: a branch may be merged again once its merge is removed. */
export const mergeKey = (id: string): string => `merge ${id}`;

/** A clean-up or a removal sent. */
export function beginRemoval(key: string): void {
  removals.set(key, (removals.get(key) ?? 0) + 1);
  tell();
}

/** One answered and its list read, or refused. */
export function endRemoval(key: string): void {
  const count = removals.get(key);
  if (count === undefined) return;
  if (count > 1) removals.set(key, count - 1);
  else removals.delete(key);
  tell();
}

export const removingNow = (key: string): boolean => removals.has(key);

export function subscribeRemovals(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether `key`'s workspace or merge is being removed, for its card and its head. */
export function useRemoving(key: string): boolean {
  return useSyncExternalStore(subscribeRemovals, () => removingNow(key));
}
