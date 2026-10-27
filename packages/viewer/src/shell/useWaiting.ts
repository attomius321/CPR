import { useEffect, useMemo } from 'react';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { desktop } from './desktop.js';
import { useAsks } from './useAsks.js';
import { whatWaits, type Waiting } from './waiting.js';

/**
 * What waits for the person (N2), from the page's reads of the workspaces and of the asks; null
 * until the workspaces are first read, so a page that just opened does not say "nothing".
 */
export function useWaiting(): Waiting | null {
  const { list, reviews, merges, scout, scribe } = useWorkspaces();
  const asks = useAsks();
  return useMemo(
    () => (list ? whatWaits({ list, reviews, merges, scout, scribe }, asks) : null),
    [list, reviews, merges, scout, scribe, asks],
  );
}

/** Tells the app how many things wait (N2): the dot on its window's icon. Nothing in a browser. */
export function useTellApp(count: number | null): void {
  useEffect(() => {
    if (count !== null) desktop?.waiting?.(count);
  }, [count]);
}
