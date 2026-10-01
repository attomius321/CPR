import { useState } from 'react';
import type { Finding, Graph } from '@cpr/core';
import { label, tone } from './flow.js';
import type { FileChanges } from './review.js';

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

interface Props {
  graph: Graph;
  changes: FileChanges[];
  reviewed: ReadonlySet<string>;
  selected: string | null;
  onSelect: (id: string) => void;
  onToggleReviewed: (id: string) => void;
}

/** The review checklist (changed symbols by file) and the findings, side by side in tabs. */
export function Sidebar({ graph, changes, reviewed, selected, onSelect, onToggleReviewed }: Props) {
  const [tab, setTab] = useState<'changes' | 'findings'>(
    graph.findings.length > 0 ? 'findings' : 'changes',
  );
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
      </div>
      <div className="progress" aria-label={`${done} of ${total} reviewed`}>
        <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>

      {tab === 'changes' ? (
        <div className="list">
          {changes.map(({ file, symbols }) => (
            <div key={file} className="list-file">
              <div className="list-file-name" title={file}>
                {file}
              </div>
              {symbols.map((node) => (
                <div
                  key={node.id}
                  className={`list-item tone-${tone(node)}${node.id === selected ? ' current' : ''}${reviewed.has(node.id) ? ' done' : ''}`}
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
                </div>
              ))}
            </div>
          ))}
          {total === 0 && <p className="muted pad">No symbol changed.</p>}
        </div>
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
