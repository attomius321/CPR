import { useCallback, useState, type ReactNode } from 'react';
import type { FeatureOptions, FeatureRequest, FeatureStart, RefList } from '@cpr/core';
import { getJson, postJson } from './http.js';
import { StartFeatureDialog } from './StartFeatureDialog.js';
import { reloadFeatures } from './useFeatures.js';

/**
 * Starting a feature (V18), from any page: `open(sha?)` shows the dialog — at a row's commit, or
 * at the default branch's tip — and `dialog` is what to draw. `onStarted` gets the new feature;
 * `onError` why the dialog could not open.
 */
export function useFeatureStarter(
  onStarted: (start: FeatureStart) => void,
  onError: (message: string) => void,
): { open: (sha?: string) => void; dialog: ReactNode; isOpen: boolean } {
  const [shown, setShown] = useState<{
    options: FeatureOptions;
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
        getJson<FeatureOptions>('/api/features/options'),
        getJson<RefList>('/api/refs'),
        // No draft is no reason not to open.
        getJson<unknown>('/api/features/draft').catch(() => null),
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
    async (request: FeatureRequest) => {
      setRunning(true);
      setError(null);
      try {
        const started = await postJson<FeatureStart>('/api/features', request);
        setShown(null);
        setRunning(false);
        void reloadFeatures();
        onStarted(started);
      } catch (e) {
        setError((e as Error).message);
        setRunning(false);
      }
    },
    [onStarted],
  );

  const dialog = shown && (
    <StartFeatureDialog
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
