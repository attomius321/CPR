// A diff's page while its analysis runs, failed or was stopped (V9), and its way back (V25).
import { useState } from 'react';
import { stopDiff } from '../history/api.js';
import { shortSha, type Loaded, type Pair } from '../history/commits.js';
import { backLink } from '../shell/pages.js';
import { BackIcon } from '../ui/icons.js';

/** "Back to Git" or "Back to Workspaces", on a diff's page: where it was opened from (V25). */
export function BackLink() {
  const { href, label } = backLink(document.referrer, window.location.origin);
  return (
    <a className="back" href={href} aria-label={`Back to ${label}`}>
      <BackIcon /> {label}
    </a>
  );
}

const PHASES: Record<string, string> = {
  checkout: 'checking out',
  loadBase: 'loading base',
  loadHead: 'loading head',
  extract: 'extracting symbols',
  references: 'finding references',
  findings: 'looking for findings',
};

const pairLabel = ({ base, head }: Pair) => `${shortSha(base)} → ${shortSha(head)}`;

/** A diff being analyzed, failed or stopped: what is happening, and the ways out. */
export function DiffProgress({
  loaded,
  onRetry,
}: {
  loaded: Exclude<Loaded, { kind: 'graph' }>;
  onRetry: (pair: Pair) => void;
}) {
  const [stopping, setStopping] = useState(false);
  const pair = loaded.pair;
  if (!pair) return null;

  if (loaded.kind === 'progress') {
    const seconds = Math.round(loaded.elapsedMs / 1000);
    const what =
      loaded.queued > 0
        ? `waiting for ${loaded.queued} other analysis${loaded.queued === 1 ? '' : 'es'}`
        : (PHASES[loaded.phase ?? ''] ?? 'starting');
    return (
      <div className="diff-progress" role="status">
        <p>
          Analyzing {pairLabel(pair)} — <span className="diff-phase">{what}</span> · {seconds} s
        </p>
        <button
          type="button"
          className="button"
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            void stopDiff(pair).finally(() =>
              window.location.assign(backLink(document.referrer, window.location.origin).href),
            );
          }}
        >
          Stop
        </button>{' '}
        <BackLink />
      </div>
    );
  }
  return (
    <div className="diff-progress">
      {loaded.kind === 'failed' ? (
        <>
          <p>Analyzing {pairLabel(pair)} failed:</p>
          <pre className="error">{loaded.error}</pre>
        </>
      ) : (
        <p>{pairLabel(pair)} is not analyzed: its analysis was stopped.</p>
      )}
      <button type="button" className="button" onClick={() => onRetry(pair)}>
        Analyze again
      </button>{' '}
      <BackLink />
    </div>
  );
}
