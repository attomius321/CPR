// A diff's head (V60, V72, V76c): its name, its facts, Files and Graph, its findings' counts.
import { Fragment, type ReactNode } from 'react';
import type { BranchReviewInfo, Finding, Graph, ReviewFile, Severity } from '@symbiote/core';
import { FileTotals, reviewSince } from './DiffProgress.js';
import { StatusLabel } from '../ui/StatusLabel.js';
import { diffName, type DiffView } from '../shell/pages.js';
import { briefTip, workspaceHref, workspaceName } from '../workspaces/workspaces.js';
import { useWorkspaces } from '../workspaces/useWorkspaces.js';
import { HelpIcon, SpinIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';
import { findingPills } from './review.js';

/**
 * The diff's two pages (V60, decision 431): Files and Graph, `g` between them; while it is
 * analyzed (`building`, V90) Graph is its steps, a spinner beside its name.
 */
export function PageSwitch({
  page,
  onPage,
  building = false,
}: {
  page: DiffView;
  onPage: (page: DiffView) => void;
  building?: boolean;
}) {
  const views: [DiffView, string, string][] = [
    ['files', 'Files', 'The changed files and their diffs'],
    ['graph', 'Graph', 'The changed symbols and the calls between them'],
  ];
  return (
    <div className="scopes page-switch" role="tablist" aria-label="Page">
      {views.map(([view, name, words]) => (
        <button
          key={view}
          type="button"
          role="tab"
          aria-selected={page === view}
          className={`scope${page === view ? ' active' : ''}`}
          {...tip(words, { keys: 'g' })}
          onClick={() => onPage(view)}
        >
          {building && view === 'graph' && <SpinIcon />}
          {name}
        </button>
      ))}
    </div>
  );
}

/**
 * What a diff's page reviews, its head's title (V72): "Review of wip" (V15), else its pull or merge
 * request, else its revisions — the window's title without "Symbiote" (`diffName`).
 */
export function DiffName({
  graph,
  review,
}: {
  graph: Graph;
  review: BranchReviewInfo | undefined;
}) {
  const request = graph.changeRequest;
  if (request) {
    return (
      <a className="request" href={request.url} target="_blank" rel="noreferrer">
        {diffName(graph)}
        {request.draft && <span className="chip">draft</span>}
        {request.state !== 'open' && <span className="chip">{request.state}</span>}
      </a>
    );
  }
  if (review) {
    return (
      <span className="review-of" {...tip(review.note)}>
        Review of <strong>{review.branch}</strong>
      </span>
    );
  }
  return <span className="revisions">{diffName(graph)}</span>;
}

/**
 * The head's line (V90, decision 839): the workspace this branch is (a link to it, V18b), the
 * branch it goes into, how it stands against the last review (V15), the commits compared, and the
 * change in git's files and lines (else its symbols, for a graph with no server).
 */
export function HeadFacts({
  review,
  revisions,
  files,
  graph,
}: {
  review: BranchReviewInfo | undefined;
  revisions: string | undefined;
  files: readonly ReviewFile[];
  graph?: Graph;
}) {
  const lines = files.some((f) => f.added !== undefined);
  const parts: [string, ReactNode][] = [];
  if (review?.into) parts.push(['into', <span>into {review.into}</span>]);
  if (review)
    parts.push(['since', <span className="review-after">{reviewSince(review.since)}</span>]);
  if (revisions) parts.push(['revisions', <span className="revisions">{revisions}</span>]);
  const count = graph?.stats.filesChanged ?? files.length;
  if (count > 0 || graph) {
    parts.push([
      'change',
      <span className="summary">
        <span className="summary-files">
          {count} file{count === 1 ? '' : 's'}
        </span>
        {lines ? (
          <FileTotals files={files} />
        ) : (
          graph && (
            <>
              <span className="chip-added">+{graph.stats.symbols.added}</span>
              <span className="chip-removed">−{graph.stats.symbols.removed}</span>
              <span className="chip-modified">~{graph.stats.symbols.modified}</span>
            </>
          )
        )}
        {graph?.since && <SinceChip graph={graph} />}
      </span>,
    ]);
  }
  return (
    <span className="diff-facts">
      {/* Only a review reads the workspaces: a diff of two commits asks nothing more. */}
      {review && <WorkspaceLink branch={review.branch} />}
      {parts.map(([key, part], i) => (
        <Fragment key={key}>
          {i > 0 && (
            <span className="facts-sep" aria-hidden="true">
              ·
            </span>
          )}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

/** The workspace a reviewed branch is, a link to it (V18b), then the line's next separator. */
function WorkspaceLink({ branch }: { branch: string }) {
  const workspace = useWorkspaces().list?.workspaces.find((f) => f.branch === branch);
  if (!workspace) return null;
  return (
    <>
      <a
        className="review-workspace"
        href={workspaceHref(branch)}
        aria-label={`Workspace: ${workspaceName(workspace)}`}
        {...tip(briefTip(workspace.brief))}
      >
        {workspaceName(workspace)}
      </a>
      <span className="facts-sep" aria-hidden="true">
        ·
      </span>
    </>
  );
}

/**
 * The change's findings in the head (V90; V100, decision 968, amending 839): a pill per severity
 * the Findings tab lists, infos as notes, each its icon and words. The settled signature changes
 * folded in the tab are counted there, not here. A pill opens the tab at its severity.
 */
export function FindingPills({
  shown,
  onPick,
}: {
  /** The findings the tab lists (`foldFindings`' `shown`). */
  shown: readonly Finding[];
  onPick: (severity: Severity) => void;
}) {
  return (
    <>
      {findingPills(shown).map(({ severity, words }) => (
        <button
          key={severity}
          type="button"
          className="finding-pill-button"
          onClick={() => onPick(severity)}
          {...tip('Show them in the Findings tab')}
        >
          <StatusLabel
            tone={severity}
            // A note's icon is its row's in the tab, not a paused state's.
            icon={severity === 'info' ? <HelpIcon /> : undefined}
            className={`finding-pill pill-${severity}`}
          >
            {words}
          </StatusLabel>
        </button>
      ))}
    </>
  );
}

/** How this version compares with the earlier one (`--since`). */
function SinceChip({ graph }: { graph: Graph }) {
  const since = graph.since;
  if (!since) return null;
  const count = (status: string) => graph.nodes.filter((n) => n.since === status).length;
  const parts = [
    ['new', count('new')],
    ['updated', count('updated')],
    ['same', count('same')],
    ['dropped', since.dropped.length],
  ].filter(([, n]) => n !== 0);
  return (
    <span
      className="chip chip-since"
      {...tip(
        since.dropped.length
          ? `No longer changed\n${since.dropped.join(', ')}`
          : `Compared with ${since.ref}`,
      )}
    >
      since {since.sha.slice(0, 7)}: {parts.map(([word, n]) => `${n} ${word}`).join(' · ')}
    </span>
  );
}
