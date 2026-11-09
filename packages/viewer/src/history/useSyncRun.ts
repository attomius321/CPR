// Git's fetch, pull and push (V66e).
import { useCallback, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { PullMode } from '@symbiote/core';
import { fetchRemotes, pull, push } from './git-api.js';
import type { SyncRun } from './SyncBar.js';
import { useShell, type Notice } from '../shell/shell-context.js';

/** Fetch, pull or push (V66e): the status bar says how it ended; the page lists again. */
export function useSyncRun({
  setSyncing,
  onRelist,
  shell,
  relistRef,
  readChanges,
}: {
  setSyncing: Dispatch<SetStateAction<SyncRun | null>>;
  onRelist: (notice: Notice | null, branch?: string) => void;
  shell: ReturnType<typeof useShell>;
  relistRef: RefObject<() => Promise<void>>;
  readChanges: () => void;
}) {
  return useCallback(
    (run: SyncRun, mode: PullMode = 'ff-only') => {
      setSyncing(run);
      const said =
        run === 'fetch'
          ? fetchRemotes().then(() => ({ text: 'Fetched every remote' }))
          : run === 'pull'
            ? pull(mode).then(({ stopped }) =>
                stopped ? { text: 'Pulled, with conflicts', warning: stopped } : { text: 'Pulled' },
              )
            : push().then(({ upstream, set }) => ({
                text: set ? `Pushed to ${upstream}, now its upstream` : `Pushed to ${upstream}`,
              }));
      said.then(
        (notice) => {
          // A pull moves the branch checked out: afresh, on HEAD. Fetch and push move only
          // remote branches: in place (decision 634).
          if (run === 'pull') return onRelist(notice);
          shell?.notify(notice);
          void relistRef.current().finally(() => setSyncing(null));
        },
        (e: unknown) => {
          setSyncing(null);
          shell?.notify({ text: `Could not ${run}`, warning: (e as Error).message, error: true });
          readChanges();
        },
      );
    },
    [onRelist, shell, readChanges],
  );
}
