import { useCallback, useState, type ReactNode } from 'react';
import type { WorkspaceOptions, WorkspaceRequest, WorkspaceStart, RefList } from '@cpr/core';
import { getJson, postJson } from './http.js';
import { StartWorkspaceDialog } from './StartWorkspaceDialog.js';
import { reloadWorkspaces } from './useWorkspaces.js';

/**
 * Starting a workspace (V18), from any page: `open(sha?)` shows the dialog — at a row's commit, or
 * at the default branch's tip — and `dialog` is what to draw. `onStarted` gets the new workspace;
 * `onError` why the dialog could not open.
 */
export function useWorkspaceStarter(
  onStarted: (start: WorkspaceStart) => void,
  onError: (message: string) => void,
): { open: (sha?: string) => void; dialog: ReactNode; isOpen: boolean } {
  const [shown, setShown] = useState<{
    options: WorkspaceOptions;
    base: { sha: string; from?: string };
    taken: ReadonlySet<string>;
    /** The draft `cpr view` keeps (V24c), as saved. */
    draft: unknown;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    (sha?: string) => {
      setError(null);
      Promise.all([
        getJson<WorkspaceOptions>('/api/workspaces/options'),
        getJson<RefList>('/api/refs'),
        // No draft is no reason not to open.
        getJson<unknown>('/api/workspaces/draft').catch(() => null),
      ])
        .then(([options, refs, draft]) => {
          const base = sha ? { sha } : options.base;
          if (!base) {
            onError(
              'No default branch to start from: start the workspace from a commit (its menu: Start a workspace here).',
            );
            return;
          }
          setShown({
            options,
            base,
            taken: new Set([
              ...refs.branches.map((b) => b.name),
              ...refs.remotes.map((r) => r.branch),
            ]),
            draft,
          });
        })
        .catch((e: unknown) => onError(`Could not start a workspace: ${(e as Error).message}`));
    },
    [onError],
  );

  const start = useCallback(
    async (request: WorkspaceRequest) => {
      setRunning(true);
      setError(null);
      try {
        const started = await postJson<WorkspaceStart>('/api/workspaces', request);
        setShown(null);
        setRunning(false);
        void reloadWorkspaces();
        onStarted(started);
      } catch (e) {
        setError((e as Error).message);
        setRunning(false);
      }
    },
    [onStarted],
  );

  const dialog = shown && (
    <StartWorkspaceDialog
      options={shown.options}
      base={shown.base}
      taken={shown.taken}
      draft={shown.draft}
      running={running}
      error={error}
      onStart={(request) => void start(request)}
      onCancel={() => setShown(null)}
    />
  );
  return { open, dialog, isOpen: shown !== null };
}
