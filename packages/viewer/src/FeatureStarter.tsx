import { useCallback, useState, type ReactNode } from 'react';
import type { FeatureOptions, FeatureRequest, FeatureStart, RefList } from '@cpr/core';
import { StartFeatureDialog } from './StartFeatureDialog.js';
import { reloadFeatures } from './useFeatures.js';

const WRITE_HEADERS = { 'content-type': 'application/json', 'x-cpr': '1' };

/** A write's answer, or the server's words (`{ error }` or text) as an error. */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: WRITE_HEADERS,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (response.ok) return JSON.parse(text) as T;
  let message = text;
  try {
    message = (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    // a plain-text refusal
  }
  throw new Error(message);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

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
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    (sha?: string) => {
      setError(null);
      Promise.all([getJson<FeatureOptions>('/api/features/options'), getJson<RefList>('/api/refs')])
        .then(([options, refs]) => {
          const base = sha ? { sha } : options.base;
          if (!base) {
            onError(
              'No default branch to start from: start the feature from a commit (its menu: Start a feature here).',
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
          });
        })
        .catch((e: unknown) => onError(`Could not start a feature: ${(e as Error).message}`));
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
      running={running}
      error={error}
      onStart={(request) => void start(request)}
      onCancel={() => setShown(null)}
    />
  );
  return { open, dialog, isOpen: shown !== null };
}
