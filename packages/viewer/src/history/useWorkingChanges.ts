// Git's reads of the checkout: its changes, its upstream and its stashes.
import { useCallback, useEffect, useState } from 'react';
import type { StashEntry, SyncState, WorkingChanges } from '@symbiote/core';
import { fetchChanges, fetchStashes, fetchSync } from './git-api.js';
import type { SyncRun } from './SyncBar.js';

/** The checkout's changes, its upstream and its stashes, read; `working` the uncommitted row's. */
export function useWorkingChanges() {
  // The checkout's uncommitted changes (V66c) and the branch's upstream (V66e), read as the page
  // lists and again when it is back in view.
  const [changes, setChanges] = useState<WorkingChanges | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [syncing, setSyncing] = useState<SyncRun | null>(null);
  // The stashes (decision 639), in the branches panel.
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const readChanges = useCallback(() => {
    fetchChanges()
      .then(setChanges)
      .catch(() => {});
    fetchSync()
      .then(setSync)
      .catch(() => {});
    fetchStashes()
      .then(setStashes)
      .catch(() => {});
  }, []);
  useEffect(readChanges, [readChanges]);
  // The uncommitted row: files changed, or an operation in progress (decision 636: its Continue
  // and Abort are in the row's pane, even with every file committed).
  const working =
    changes !== null &&
    (changes.staged.length + changes.unstaged.length > 0 || changes.operation !== null)
      ? changes
      : null;
  return { changes, setChanges, sync, syncing, setSyncing, stashes, readChanges, working };
}
