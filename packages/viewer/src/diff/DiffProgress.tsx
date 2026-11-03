// A diff's page while its analysis runs, failed or was stopped (V9), and its way back (V25). Since
// V90 (decision 846) the six steps as a timeline with their times, and beside them what needs no
// graph: the files, and for a workspace's branch its agent's report, its commits and its brief.
import { useEffect, useState, type ReactNode } from 'react';
import type {
  BranchReviewInfo,
  ReviewFile,
  WorkspaceChanges,
  WorkspaceCommit,
  WorkspaceThread,
} from '@symbiote/core';
import { stopDiff } from '../history/api.js';
import { shortSha, type Loaded, type Pair } from '../history/commits.js';
import { backLink } from '../shell/pages.js';
import {
  AlertIcon,
  BackIcon,
  CheckIcon,
  FailedIcon,
  FileIcon,
  IdleIcon,
  ResetIcon,
  RunningIcon,
  StopIcon,
  StoppedIcon,
  ReviewIcon,
  HistoryIcon,
} from '../ui/icons.js';
import { markdownNodes, useMarkdown } from '../ui/markdown.js';
import { FileRow } from '../workspaces/ChangesPanel.js';
import { fileFacts } from '../workspaces/changes.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { AGENT_NAMES } from '../workspaces/workspaces.js';
import {
  analysisSteps,
  clockTime,
  endedSteps,
  stepTime,
  type AnalysisStep,
  type Seen,
  type StepMark,
} from './analysis-steps.js';

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

export const pairLabel = ({ base, head }: Pair) => `${shortSha(base)} → ${shortSha(head)}`;

type Analyzing = Exclude<Loaded, { kind: 'graph' }>;

/** The steps the page shows for `loaded`: running, ended where it was last seen, or none. */
export function stepsOf(loaded: Analyzing, seen: Seen, now: number): AnalysisStep[] {
  const pair = loaded.pair;
  if (loaded.kind === 'progress') {
    return analysisSteps(loaded.phase, loaded.queued, { seen, now, ...(pair ? { pair } : {}) });
  }
  return endedSteps(seen, loaded.kind === 'failed' ? 'failed' : 'stopped', pair);
}

/** The head's state while it is analyzed (V90): "Analyzing · step 4 of 6", Failed, Stopped. */
export function analysisState(
  loaded: Analyzing,
  seen: Seen,
): { tone: 'run' | 'error' | 'info'; words: string } {
  const steps = stepsOf(loaded, seen, 0);
  const at = steps.findIndex((step) => step.mark !== 'done');
  const named = steps[at];
  if (loaded.kind === 'progress') {
    if (loaded.queued > 0) return { tone: 'run', words: 'Waiting to analyze' };
    return { tone: 'run', words: `Analyzing · step ${at + 1} of ${steps.length}` };
  }
  if (loaded.kind === 'failed') {
    return { tone: 'error', words: named ? `Failed at ${named.name}` : 'Failed' };
  }
  return { tone: 'info', words: named ? `Stopped at ${named.name}` : 'Stopped' };
}

const MARK_ICONS: Record<StepMark, () => ReactNode> = {
  done: CheckIcon,
  running: RunningIcon,
  next: IdleIcon,
  failed: FailedIcon,
  stopped: StoppedIcon,
};

/** A workspace's branch: what it records that needs no graph (V90, decision 847). */
interface FromWorkspace {
  title?: string;
  brief: string;
  agent?: string;
  report?: { at: string; text: string };
  /** Its commits, when they are the review's range. */
  commits?: { count: number; listed: WorkspaceCommit[] };
}

/**
 * The workspace whose branch this review is, read once: its brief from the list, its newest
 * report in full from its thread, its commits when they start where the review does.
 */
function useFromWorkspace(review: BranchReviewInfo | undefined): FromWorkspace | null {
  const summary = useWorkspaces().list?.workspaces.find((w) => w.branch === review?.branch);
  const branch = summary?.branch;
  const [thread, setThread] = useState<WorkspaceThread | null>(null);
  const [changes, setChanges] = useState<WorkspaceChanges | null>(null);
  useEffect(() => {
    if (!branch) return;
    let live = true;
    const read = <T,>(path: string, set: (value: T) => void) =>
      fetch(`/api/workspaces/${path}?branch=${encodeURIComponent(branch)}`)
        .then((response) => (response.ok ? (response.json() as Promise<T>) : null))
        .then((value) => live && value && set(value))
        .catch(() => {});
    void read<WorkspaceThread>('thread', setThread);
    void read<WorkspaceChanges>('changes', setChanges);
    return () => {
      live = false;
    };
  }, [branch]);
  if (!summary || !review) return null;
  const report = thread?.entries.findLast((entry) => entry.kind === 'report');
  return {
    ...(summary.title ? { title: summary.title } : {}),
    brief: summary.brief,
    ...(summary.agent.kind ? { agent: AGENT_NAMES[summary.agent.kind] } : {}),
    ...(report?.kind === 'report' ? { report: { at: report.at, text: report.text } } : {}),
    ...(changes && changes.base === review.base ? { commits: changes.commits } : {}),
  };
}

const timeOf = (at: string) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * A diff being analyzed, failed or stopped (V90): the steps with their times, Stop or Analyze
 * again; the agent's report and commits; ready now, the files (Read the files opens the Files
 * page), the brief and what waits for the graph.
 */
export function DiffProgress({
  loaded,
  seen,
  review,
  files,
  onRetry,
  onReadFiles,
}: {
  loaded: Analyzing;
  seen: Seen;
  /** A branch review's page (V15). */
  review?: BranchReviewInfo | undefined;
  /** The pair's files, git's (`./api/files`); empty while they are read or where none is served. */
  files: readonly ReviewFile[];
  onRetry: (pair: Pair) => void;
  /** Opens the Files page, at a file or the first. */
  onReadFiles: (path?: string) => void;
}) {
  const [stopping, setStopping] = useState(false);
  const from = useFromWorkspace(review);
  const lexer = useMarkdown();
  const pair = loaded.pair;
  if (!pair) return null;
  const running = loaded.kind === 'progress';
  const steps = stepsOf(loaded, seen, performance.now());
  const now = steps.find((step) => step.mark === 'running');
  const done = steps.filter((step) => step.mark === 'done').length;
  const toCome = steps.filter((step) => step.mark === 'next').length;
  const waits = [
    files.length > 0 && 'The files',
    from?.commits && 'the commits',
    from?.report && "the agent's report",
  ].filter(Boolean);

  return (
    <section className={`opening ${running ? 'running' : 'ended'}`} aria-labelledby="opening-title">
      <div className="opening-main">
        <article className="opening-card opening-progress">
          <header className="opening-head">
            <h2 id="opening-title">
              {running
                ? 'Reading the change'
                : loaded.kind === 'failed'
                  ? 'The analysis failed'
                  : 'The analysis was stopped'}
            </h2>
            {running && (
              <span className="opening-why">
                so the graph can show what changed, who uses it and what is risky
              </span>
            )}
            {running && (
              <span className="opening-clock" aria-label="Time so far">
                {clockTime(loaded.elapsedMs)}
              </span>
            )}
          </header>
          {steps.length > 0 && (
            <div className="opening-bar" aria-hidden="true">
              {steps.map((step) => (
                <span key={step.key} className={`opening-segment mark-${step.mark}`} />
              ))}
            </div>
          )}
          <div className="opening-now">
            {/* The live region: the running step and how far it is; the clock stays out of it. */}
            <span {...(running ? { role: 'status' } : {})}>
              {now ? (
                <>
                  <strong>{now.name}</strong>
                  {now.key !== 'queue' && ` · ${done} done, ${toCome} to come`}
                </>
              ) : loaded.kind === 'failed' ? (
                'It ended with an error: analyze it again, or go back.'
              ) : (
                'Its analysis was stopped.'
              )}
            </span>
            <span className="opening-actions">
              {running ? (
                <button
                  type="button"
                  className="button secondary small"
                  disabled={stopping}
                  onClick={() => {
                    setStopping(true);
                    void stopDiff(pair).finally(() =>
                      window.location.assign(
                        backLink(document.referrer, window.location.origin).href,
                      ),
                    );
                  }}
                >
                  <StopIcon /> Stop
                </button>
              ) : (
                <>
                  <BackLink className="button ghost small" />
                  <button type="button" className="button small" onClick={() => onRetry(pair)}>
                    <ResetIcon /> Analyze again
                  </button>
                </>
              )}
            </span>
          </div>
          {steps.length > 0 && (
            <ol className="opening-steps">
              {steps.map((step) => {
                const Icon = MARK_ICONS[step.mark];
                return (
                  <li
                    key={step.key}
                    className={`opening-step mark-${step.mark}`}
                    {...(step.mark === 'running' ? { 'aria-current': 'step' as const } : {})}
                  >
                    <span className="opening-dot" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="opening-step-name">{step.name}</span>
                    <span className="opening-step-detail">{step.detail}</span>
                    <span className="opening-step-time">
                      {step.ms === undefined
                        ? ''
                        : step.mark === 'running'
                          ? clockTime(step.ms)
                          : stepTime(step.ms)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {loaded.kind === 'failed' && <pre className="opening-error">{loaded.error}</pre>}
          {running && (
            <p className="opening-note">
              <HistoryIcon />
              <span>
                Both sides are read as whole TypeScript programs, so a larger repository takes
                longer.
                {waits.length > 0 &&
                  ` ${waits.join(', ').replace(/, ([^,]*)$/, ' and $1')} do not wait for it: start with them.`}
              </span>
            </p>
          )}
        </article>
        {from && (from.report || from.commits) && (
          <article className="opening-card opening-agent" aria-labelledby="opening-agent">
            <header className="card-head opening-agent-head">
              <h2 id="opening-agent">From the agent</h2>
              {from.agent && (
                <span className="opening-faint">
                  {from.agent}
                  {from.report && ` · ${timeOf(from.report.at)}`}
                </span>
              )}
            </header>
            {from.report && (
              <section className="opening-section">
                <h3 className="opening-label">Its report</h3>
                <div className="markdown opening-report">
                  {lexer ? markdownNodes(lexer(from.report.text)) : <p>{from.report.text}</p>}
                </div>
              </section>
            )}
            {from.commits && (
              <section className="opening-section">
                <h3 className="opening-label">
                  Its commits <span className="count">{from.commits.count}</span>
                </h3>
                <ul className="opening-commits">
                  {from.commits.listed.map((commit) => (
                    <li key={commit.sha}>
                      <code>{commit.sha.slice(0, 7)}</code>
                      <span className="opening-commit-subject">{commit.subject}</span>
                      <span className="opening-faint">{timeOf(commit.date)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </article>
        )}
      </div>
      <aside className="opening-card opening-ready" aria-labelledby="opening-ready">
        <header className="opening-ready-head">
          <h2 id="opening-ready">
            <CheckIcon /> Ready now
          </h2>
          <p>Start with these while the graph is built.</p>
        </header>
        {files.length > 0 && (
          <section className="opening-section">
            <h3 className="opening-label">
              Files <span className="count">{files.length}</span>
              <FileTotals files={files} />
            </h3>
            <ul className="changes-list opening-files">
              {files.map((file) => (
                <li key={file.path}>
                  <FileRow
                    file={file}
                    label={`Read the changes to ${file.path}`}
                    hover={fileFacts(file)}
                    onOpen={() => onReadFiles(file.path)}
                  />
                </li>
              ))}
            </ul>
            <button type="button" className="button opening-read" onClick={() => onReadFiles()}>
              <FileIcon /> Read the files
            </button>
          </section>
        )}
        {from?.brief && (
          <section className="opening-section">
            <h3 className="opening-label">The brief</h3>
            <div className="markdown opening-brief">
              {lexer ? markdownNodes(lexer(from.brief)) : <p>{from.brief}</p>}
            </div>
          </section>
        )}
        <section className="opening-section">
          <h3 className="opening-label">Waits for the graph</h3>
          <ul className="opening-waits">
            <li>
              <AlertIcon /> Findings
            </li>
            <li>
              <ReviewIcon /> The graph, and who uses what changed
            </li>
          </ul>
        </section>
      </aside>
    </section>
  );
}

/** The files' lines in all, git's: "+47 −2". */
export function FileTotals({ files }: { files: readonly ReviewFile[] }) {
  const added = files.reduce((n, f) => n + (f.added ?? 0), 0);
  const removed = files.reduce((n, f) => n + (f.removed ?? 0), 0);
  if (!files.some((f) => f.added !== undefined)) return null;
  return (
    <span className="file-totals">
      <span className="lines-added">+{added}</span>{' '}
      <span className="lines-removed">−{removed}</span>
    </span>
  );
}
