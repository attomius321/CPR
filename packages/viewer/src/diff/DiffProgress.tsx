// A diff's page while its analysis runs, failed or was stopped (V9), and its way back (V25);
// drawn as a card on the start page's arcs since V71.
import { useState } from 'react';
import type { BranchReviewInfo } from '@symbiote/core';
import { stopDiff } from '../history/api.js';
import { shortSha, type Loaded, type Pair } from '../history/commits.js';
import { backLink } from '../shell/pages.js';
import {
  AlertIcon,
  BackIcon,
  ResetIcon,
  StopIcon,
  StoppedIcon,
  SymbioteMark,
} from '../ui/icons.js';
import { analysisSteps, type StepMark } from './analysis-steps.js';

/** "Back to Git" or "Back to Workspaces", on a diff's page: where it was opened from (V25). */
export function BackLink({ className = 'back' }: { className?: string }) {
  const { href, label } = backLink(document.referrer, window.location.origin);
  return (
    <a className={className} href={href} aria-label={`Back to ${label}`}>
      <BackIcon /> {label}
    </a>
  );
}

/** What a branch review covers, after its branch: the review page's words (V15). */
export function reviewSince(since: number | null): string {
  if (since === null) return 'first review';
  if (since === 0) return 'no commits since your last review';
  return `${since} commit${since === 1 ? '' : 's'} since your last review`;
}

/** A step's mark as the sidenav's state dot (V48, V53): done, working's comet, an empty ring. */
const DOTS: Record<StepMark, string> = {
  done: 'tone-done',
  running: 'tone-working',
  next: 'tone-idle',
};

const pairLabel = ({ base, head }: Pair) => `${shortSha(base)} → ${shortSha(head)}`;

/**
 * A diff being analyzed, failed or stopped (V71): the card — what is analyzed, its steps or why
 * it ended, the ways out — on the start page's arcs, one turning while it runs.
 */
export function DiffProgress({
  loaded,
  review,
  onRetry,
}: {
  loaded: Exclude<Loaded, { kind: 'graph' }>;
  /** A branch review's page (V15): named by its branch (decision 506). */
  review?: BranchReviewInfo | undefined;
  onRetry: (pair: Pair) => void;
}) {
  const [stopping, setStopping] = useState(false);
  const pair = loaded.pair;
  if (!pair) return null;
  const running = loaded.kind === 'progress';
  const steps = running ? analysisSteps(loaded.phase, loaded.queued) : [];
  const now = steps.find((step) => step.mark === 'running');
  const line = review && [
    review.into && `into ${review.into}`,
    reviewSince(review.since),
    pairLabel(pair),
  ];

  return (
    <section
      className={`analysis ${running ? 'running' : 'ended'}`}
      aria-labelledby="analysis-title"
    >
      <div className="ground analysis-ground" aria-hidden="true">
        <div className="ground-ring analysis-orbit" />
      </div>
      <div className="analysis-card">
        <header className="analysis-head">
          <SymbioteMark size={48} />
          {/* The live region: what is analyzed and its running step; the seconds stay out of it. */}
          <div className="analysis-title" {...(running ? { role: 'status' } : {})}>
            <h1 id="analysis-title">
              <span className="analysis-verb">{review ? 'Reviewing' : 'Analyzing'}</span>{' '}
              {review ? review.branch : pairLabel(pair)}
            </h1>
            {line && <p>{line.filter(Boolean).join(' · ')}</p>}
            {now && <span className="analysis-now">{now.name}</span>}
          </div>
          {loaded.kind === 'progress' ? (
            <span className="analysis-chip">{Math.round(loaded.elapsedMs / 1000)} s</span>
          ) : loaded.kind === 'failed' ? (
            <span className="analysis-chip failed">
              <AlertIcon /> Failed
            </span>
          ) : (
            <span className="analysis-chip">
              <StoppedIcon /> Stopped
            </span>
          )}
        </header>
        {running ? (
          <ol className="analysis-steps">
            {steps.map((step) => (
              <li
                key={step.key}
                className={`analysis-step mark-${step.mark}`}
                {...(step.mark === 'running' ? { 'aria-current': 'step' as const } : {})}
              >
                <span className={`state-dot ${DOTS[step.mark]}`} aria-hidden="true" />
                {step.name}
              </li>
            ))}
          </ol>
        ) : loaded.kind === 'failed' ? (
          <pre className="analysis-error">{loaded.error}</pre>
        ) : (
          <p className="analysis-note">Its analysis was stopped.</p>
        )}
        <footer className="analysis-actions">
          <BackLink className="button ghost" />
          {running ? (
            <button
              type="button"
              className="button secondary"
              disabled={stopping}
              onClick={() => {
                setStopping(true);
                void stopDiff(pair).finally(() =>
                  window.location.assign(backLink(document.referrer, window.location.origin).href),
                );
              }}
            >
              <StopIcon /> Stop
            </button>
          ) : (
            <button type="button" className="button" onClick={() => onRetry(pair)}>
              <ResetIcon /> Analyze again
            </button>
          )}
        </footer>
      </div>
    </section>
  );
}
