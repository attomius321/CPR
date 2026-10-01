import { useEffect, useMemo, useState } from 'react';
import type { Finding, Graph, GraphNode } from '@cpr/core';
import { diffRows, excerpt, symbolDetail, type DiffRow, type Neighbour } from './detail.js';
import { label, tone } from './flow.js';

const sources = new Map<string, Promise<string>>();

/** Fetches a file once per side; `cpr view` serves them, a dropped file has none. */
function fetchSource(side: 'base' | 'head', file: string): Promise<string> {
  const key = `${side}:${file}`;
  let source = sources.get(key);
  if (!source) {
    source = fetch(`./api/source?side=${side}&file=${encodeURIComponent(file)}`).then((r) =>
      r.ok ? r.text() : Promise.reject(new Error(`${r.status}`)),
    );
    sources.set(key, source);
  }
  return source;
}

type SourceState =
  { status: 'loading' } | { status: 'none' } | { status: 'ready'; rows: DiffRow[] };

function useSymbolDiff(node: GraphNode, enabled: boolean): SourceState {
  const [state, setState] = useState<SourceState>({ status: 'loading' });
  useEffect(() => {
    if (!enabled || (!node.base && !node.head)) {
      setState({ status: 'none' });
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    const side = async (which: 'base' | 'head') => {
      const decl = node[which];
      return decl ? excerpt(await fetchSource(which, decl.file), decl.range) : undefined;
    };
    Promise.all([side('base'), side('head')])
      .then(([base, head]) => live && setState({ status: 'ready', rows: diffRows(base, head) }))
      .catch(() => live && setState({ status: 'none' }));
    return () => {
      live = false;
    };
  }, [node, enabled]);
  return state;
}

interface Props {
  graph: Graph;
  id: string;
  /** Whether `/api/source` exists (opened with `cpr view`). */
  sources: boolean;
  /** Whether the reviewer marked it reviewed; only changed symbols can be. */
  reviewed: boolean;
  onToggleReviewed: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function DetailPanel({
  graph,
  id,
  sources: hasSources,
  reviewed,
  onToggleReviewed,
  onSelect,
  onClose,
}: Props) {
  const detail = useMemo(() => symbolDetail(graph, id), [graph, id]);
  if (!detail) return null;
  const { node, users, callees, findings, mentions } = detail;
  const members = graph.nodes.filter((n) => n.container === node.id && n.status !== 'unchanged');
  const moved = node.previousId ? ` (from ${node.previousId})` : '';
  const signatures = [node.base?.signature, node.head?.signature].filter(Boolean);

  return (
    <aside className="panel" aria-label="Symbol detail">
      <header className="panel-head">
        <div>
          <div className="panel-kind">
            {node.kind} · <span className={`status tone-${tone(node)}`}>{tone(node)}</span>
            {node.delta &&
              Object.entries(node.delta)
                .filter(([, on]) => on)
                .map(([tag]) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
          </div>
          <h2 className="panel-title">{label(node)}</h2>
          <div className="panel-file">
            {(node.head ?? node.base)?.file ?? node.id}
            {moved}
          </div>
        </div>
        <div className="panel-actions">
          {node.status !== 'unchanged' && (
            <button className={`review${reviewed ? ' done' : ''}`} onClick={onToggleReviewed}>
              {reviewed ? '✓ Reviewed' : 'Mark reviewed'}
            </button>
          )}
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </header>

      {findings.length + mentions.length > 0 && (
        <section>
          <h3>Findings</h3>
          {findings.map((f) => (
            <FindingItem key={f.id} finding={f} onSelect={onSelect} />
          ))}
          {mentions.map((f) => (
            <FindingItem key={f.id} finding={f} onSelect={onSelect} mention />
          ))}
        </section>
      )}

      {signatures.length > 0 && (
        <section>
          <h3>Signature</h3>
          {node.base && node.head && node.base.signature !== node.head.signature ? (
            <>
              <code className="sig sig-del">{node.base.signature}</code>
              <code className="sig sig-add">{node.head.signature}</code>
            </>
          ) : (
            <code className="sig">{signatures[0]}</code>
          )}
        </section>
      )}

      {members.length > 0 && (
        <section>
          <h3>
            Changed members <span className="muted">({members.length})</span>
          </h3>
          <ul className="neighbours">
            {members.map((member) => (
              <li key={member.id}>
                <button className="link" onClick={() => onSelect(member.id)}>
                  {label(member)}
                </button>
                <span className="muted"> {tone(member)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* A class's members are symbols of their own: its code would repeat them. */}
      {(node.base || node.head) && node.kind !== 'class' && node.kind !== 'namespace' && (
        <section>
          <h3>Code</h3>
          <SymbolDiff node={node} enabled={hasSources} />
        </section>
      )}

      <Neighbours title="Used by" items={users} onSelect={onSelect} />
      <Neighbours title="Uses" items={callees} onSelect={onSelect} />
    </aside>
  );
}

/** Long symbols show this many rows until expanded. */
const MAX_ROWS = 300;

function SymbolDiff({ node, enabled }: { node: GraphNode; enabled: boolean }) {
  const state = useSymbolDiff(node, enabled);
  const [all, setAll] = useState(false);
  if (state.status === 'loading') return <p className="muted">Loading source…</p>;
  if (state.status === 'none') {
    return <p className="muted">Source is available when the graph is opened with cpr view.</p>;
  }
  const rows = all ? state.rows : state.rows.slice(0, MAX_ROWS);
  return (
    <div className="code" role="table">
      {rows.map((row, i) => (
        <div key={i} className={`row row-${row.type}`} role="row">
          <span className="ln">{row.base ?? ''}</span>
          <span className="ln">{row.head ?? ''}</span>
          <span className="mark">{row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}</span>
          <span className="text">{row.text}</span>
        </div>
      ))}
      {rows.length < state.rows.length && (
        <button className="more" onClick={() => setAll(true)}>
          Show all {state.rows.length} lines
        </button>
      )}
    </div>
  );
}

function FindingItem({
  finding,
  onSelect,
  mention = false,
}: {
  finding: Finding;
  onSelect: (id: string) => void;
  mention?: boolean;
}) {
  return (
    <div className={`finding finding-${finding.severity}`}>
      <div className="finding-rule">
        <span className={`badge badge-${finding.severity}`}>{finding.severity}</span> {finding.rule}
        {mention && (
          <>
            {' '}
            on{' '}
            <button className="link" onClick={() => onSelect(finding.symbol)}>
              {finding.symbol.slice(finding.symbol.indexOf('#') + 1)}
            </button>
          </>
        )}
      </div>
      <p>{finding.message}</p>
    </div>
  );
}

function Neighbours({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: Neighbour[];
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3>
        {title} <span className="muted">({items.length})</span>
      </h3>
      <ul className="neighbours">
        {items.map((item) => (
          <li key={`${item.id}|${item.kind}`}>
            <button className="link" onClick={() => onSelect(item.id)} disabled={!item.node}>
              {item.node ? label(item.node) : item.id}
            </button>
            <span className="muted">
              {' '}
              {item.kind}
              {item.side === 'base' ? ' · removed' : item.side === 'head' ? ' · new' : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
