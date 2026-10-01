import { useState } from 'react';
import type { Finding, Graph } from '@cpr/core';
import { label, tone } from './flow.js';
import type { FileChanges } from './review.js';
import { ReviewTab, type ReviewProps } from './ReviewTab.js';

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

interface Props {
  graph: Graph;
  changes: FileChanges[];
  reviewed: ReadonlySet<string>;
  /** Reviewed before, but changed since (a new push). */
  stale: ReadonlySet<string>;
  selected: string | null;
  onSelect: (id: string) => void;
  onToggleReviewed: (id: string) => void;
  /** Present when the review can be posted to the forge (`cpr pr`). */
  review?: ReviewProps | undefined;
}

/**
 * The review checklist (changed symbols by file), the findings and, under `cpr pr`, the review
 * to post, in tabs.
 */
export function Sidebar({
  graph,
  changes,
  reviewed,
  stale,
  selected,
  onSelect,
  onToggleReviewed,
  review,
}: Props) {
  const [tab, setTab] = useState<'changes' | 'findings' | 'review'>(
    graph.findings.length > 0 ? 'findings' : 'changes',
  );
  const commented = new Map<string, number>();
  for (const d of review?.draft.drafts ?? []) {
    commented.set(d.symbol, (commented.get(d.symbol) ?? 0) + 1);
  }
  const total = changes.reduce((n, f) => n + f.symbols.length, 0);
  const done = changes.reduce((n, f) => n + f.symbols.filter((s) => reviewed.has(s.id)).length, 0);
  const findings = [...graph.findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  );

  return (
    <nav className="sidebar" aria-label="Review">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
          Changes{' '}
          <span className="count">
            {done}/{total}
          </span>
        </button>
        <button role="tab" aria-selected={tab === 'findings'} onClick={() => setTab('findings')}>
          Findings <span className="count">{graph.findings.length}</span>
        </button>
        {review && (
          <button role="tab" aria-selected={tab === 'review'} onClick={() => setTab('review')}>
            Review <span className="count">{review.draft.drafts.length}</span>
          </button>
        )}
      </div>
      <div className="progress" aria-label={`${done} of ${total} reviewed`}>
        <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>

      {tab === 'changes' ? (
        <div className="list">
          {stale.size > 0 && (
            <p className="stale-note">
              ↻ {stale.size} symbol{stale.size === 1 ? '' : 's'} changed since you reviewed{' '}
              {stale.size === 1 ? 'it' : 'them'}
            </p>
          )}
          {changes.map(({ file, symbols }) => (
            <div key={file} className="list-file">
              <div className="list-file-name" title={file}>
                {file}
              </div>
              {symbols.map((node) => (
                <div
                  key={node.id}
                  className={`list-item tone-${tone(node)}${node.id === selected ? ' current' : ''}${reviewed.has(node.id) ? ' done' : ''}${stale.has(node.id) ? ' stale' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={reviewed.has(node.id)}
                    onChange={() => onToggleReviewed(node.id)}
                    aria-label={`Mark ${label(node)} reviewed`}
                  />
                  <button className="list-link" onClick={() => onSelect(node.id)}>
                    <span className="dot" />
                    {label(node)}
                  </button>
                  {stale.has(node.id) && (
                    <span className="stale-mark" title="Changed since you reviewed it">
                      ↻
                    </span>
                  )}
                  {commented.has(node.id) && (
                    <span className="commented" title="Comments on this symbol">
                      💬 {commented.get(node.id)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
          {total === 0 && <p className="muted pad">No symbol changed.</p>}
        </div>
      ) : tab === 'review' && review ? (
        <ReviewTab graph={graph} review={review} onSelect={onSelect} />
      ) : (
        <div className="list">
          {findings.map((finding) => (
            <FindingRow
              key={finding.id}
              finding={finding}
              current={finding.symbol === selected}
              onSelect={onSelect}
            />
          ))}
          {findings.length === 0 && <p className="muted pad">No findings. 🎉</p>}
        </div>
      )}
      <p className="keys">
        <kbd>j</kbd>/<kbd>k</kbd> next/previous · <kbd>r</kbd> reviewed · <kbd>f</kbd> focus ·{' '}
        {review && (
          <>
            <kbd>c</kbd> comment ·{' '}
          </>
        )}
        <kbd>Esc</kbd> close
      </p>
    </nav>
  );
}

function FindingRow({
  finding,
  current,
  onSelect,
}: {
  finding: Finding;
  current: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      className={`finding-row finding-${finding.severity}${current ? ' current' : ''}`}
      onClick={() => onSelect(finding.symbol)}
    >
      <span className={`badge badge-${finding.severity}`}>{finding.severity}</span>
      <span className="finding-row-rule">{finding.rule}</span>
      <span className="finding-row-message">{finding.message}</span>
    </button>
  );
}
