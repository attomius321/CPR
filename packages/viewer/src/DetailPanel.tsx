import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Finding, Graph, GraphNode, Project } from '@cpr/core';
import {
  anchorFor,
  defaultAnchor,
  describeAnchor,
  describeDraft,
  type Anchor,
  type Draft,
  type Side,
} from './comments.js';
import { diffRows, excerpt, symbolDetail, type DiffRow, type Neighbour } from './detail.js';
import { groupOf, label, tone } from './flow.js';
import {
  anchorTarget,
  describeOpen,
  openInEditor,
  rowTarget,
  symbolTarget,
  type OpenTarget,
} from './open.js';
import { OpenIcon } from './OpenIcon.js';
import { pathInProject, projectOf } from './projects.js';

const sources = new Map<string, Promise<string>>();

/** How long "Opened in VS Code …" stays; an error stays until the next open. */
const NOTE_MS = 8000;
/** The key that opens a row in VS Code with a click. */
const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';

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

function useSymbolDiff(node: GraphNode | undefined, enabled: boolean): SourceState {
  const [state, setState] = useState<SourceState>({ status: 'loading' });
  useEffect(() => {
    if (!node || !enabled || (!node.base && !node.head)) {
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
  /** The graph's projects, when the change spans two or more: the file line names its project. */
  projects?: readonly Project[];
  /** Whether `/api/source` exists (opened with `cpr view`). */
  sources: boolean;
  /** Whether the server opens files in VS Code (`/api/open`). */
  canOpen: boolean;
  /** Whether the reviewer marked it reviewed; only changed symbols can be. */
  reviewed: boolean;
  /** Reviewed before, but changed since. */
  stale: boolean;
  onToggleReviewed: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Present when the review can be posted to the forge (`cpr pr`). */
  comments?: Comments | undefined;
}

export interface Comments {
  /** This symbol's drafts. */
  drafts: Draft[];
  onAdd: (anchor: Anchor | null, body: string) => void;
  onRemove: (id: string) => void;
}

/** The panel is keyed by symbol, so its state (picked line, comment text) starts fresh per symbol. */
export function DetailPanel({
  graph,
  id,
  projects,
  sources: hasSources,
  canOpen,
  reviewed,
  stale,
  onToggleReviewed,
  onSelect,
  onClose,
  comments,
}: Props) {
  const detail = useMemo(() => symbolDetail(graph, id), [graph, id]);
  const shown = detail?.node;
  // A class's members are symbols of their own: its code would repeat them.
  const showsCode =
    !!shown && !!(shown.base || shown.head) && shown.kind !== 'class' && shown.kind !== 'namespace';
  const diff = useSymbolDiff(shown, hasSources && showsCode);
  /** The line picked for the next comment; undefined: the first changed line. */
  const [picked, setPicked] = useState<Anchor | null>();
  /** What the last open in VS Code said. */
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!note || note.error) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);
  if (!detail) return null;
  const { node, users, callees, findings, mentions } = detail;
  const rows = diff.status === 'ready' ? diff.rows : [];
  const anchor = picked !== undefined ? picked : defaultAnchor(graph, node, rows);
  const members = graph.nodes.filter((n) => n.container === node.id && n.status !== 'unchanged');
  const moved = node.previousId ? ` (from ${node.previousId})` : '';
  const signatures = [node.base?.signature, node.head?.signature].filter(Boolean);
  const open = (target: OpenTarget | null) => {
    if (!target) return;
    void openInEditor(target).then((answer) =>
      setNote({ text: describeOpen(target, answer), error: !answer.ok }),
    );
  };
  // The button (and `o`): the line picked for a comment, else the symbol's first line.
  const openTarget = canOpen ? (picked ? anchorTarget(picked) : symbolTarget(node)) : null;

  return (
    <aside className="panel" aria-label="Symbol detail">
      <header className="panel-head">
        <div>
          <div className="panel-kind">
            {node.kind} · <span className={`status tone-${tone(node)}`}>{tone(node)}</span>
            {(node.since === 'new' || node.since === 'updated') && (
              <span className="tag tag-since">
                {node.since} since {graph.since?.sha.slice(0, 7)}
              </span>
            )}
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
          {openTarget ? (
            <div className="panel-where">
              <FileLine node={node} projects={projects} moved={moved} />
              <button
                id="open-in-editor"
                type="button"
                className="open-editor"
                title={`Open line ${openTarget.line} of ${openTarget.side} in VS Code (o)`}
                onClick={() => open(openTarget)}
              >
                <OpenIcon />
                Open in VS Code
                <kbd aria-hidden="true">o</kbd>
              </button>
            </div>
          ) : (
            <FileLine node={node} projects={projects} moved={moved} />
          )}
          {canOpen && (
            <div className={`open-note${note?.error ? ' open-error' : ''}`} role="status">
              {note?.text}
            </div>
          )}
          {stale && <div className="stale-note">↻ Changed since you reviewed it</div>}
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

      {showsCode && (
        <section>
          <h3>Code</h3>
          <SymbolDiff
            state={diff}
            anchor={comments ? anchor : null}
            {...(comments
              ? { onPick: (row: DiffRow) => setPicked(anchorFor(graph, node, row)) }
              : {})}
            {...(canOpen
              ? { onOpen: (row: DiffRow, side?: Side) => open(rowTarget(node, row, side)) }
              : {})}
          />
        </section>
      )}

      {comments && (
        <CommentBox
          comments={comments}
          anchor={anchor}
          ready={!showsCode || !hasSources || diff.status !== 'loading'}
          pickable={rows.some((r) => r.type !== 'same')}
        />
      )}

      <Neighbours title="Used by" items={users} onSelect={onSelect} />
      <Neighbours title="Uses" items={callees} onSelect={onSelect} />
    </aside>
  );
}

/** Long symbols show this many rows until expanded. */
const MAX_ROWS = 300;

interface SymbolDiffProps {
  state: SourceState;
  /** The line the next comment goes on, highlighted. */
  anchor: Anchor | null;
  /** Picks a changed line for the next comment. */
  onPick?: (row: DiffRow) => void;
  /** Opens a row in VS Code: Ctrl/⌘+click, or its line number (that side). */
  onOpen?: (row: DiffRow, side?: Side) => void;
}

function SymbolDiff({ state, anchor, onPick, onOpen }: SymbolDiffProps) {
  const [all, setAll] = useState(false);
  if (state.status === 'loading') return <p className="muted">Loading source…</p>;
  if (state.status === 'none') {
    return <p className="muted">Source is available when the graph is opened with cpr view.</p>;
  }
  const rows = all ? state.rows : state.rows.slice(0, MAX_ROWS);
  return (
    <div className="code" role="table">
      {/* As wide as the longest line, so every row's colour spans it when the code scrolls. */}
      <div className="code-rows">
        {rows.map((row, i) => {
          const pick = onPick && row.type !== 'same' ? () => onPick(row) : undefined;
          const title = [pick && 'Comment on this line', onOpen && `${MOD}+click: open in VS Code`]
            .filter(Boolean)
            .join(' · ');
          const onClick = (event: MouseEvent) => {
            if (onOpen && (event.ctrlKey || event.metaKey)) onOpen(row);
            else pick?.();
          };
          return (
            <div
              key={i}
              className={`row row-${row.type}${pick ? ' pickable' : ''}${isAnchor(row, anchor) ? ' anchored' : ''}`}
              role="row"
              {...(pick || onOpen ? { onClick, title } : {})}
            >
              <LineNumber row={row} side="base" onOpen={onOpen} />
              <LineNumber row={row} side="head" onOpen={onOpen} />
              <span className="mark">
                {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}
              </span>
              <span className="text">{row.text}</span>
            </div>
          );
        })}
      </div>
      {rows.length < state.rows.length && (
        <button className="more" onClick={() => setAll(true)}>
          Show all {state.rows.length} lines
        </button>
      )}
    </div>
  );
}

/** A row's line number on one side; a button that opens that line when the server can. */
function LineNumber({
  row,
  side,
  onOpen,
}: {
  row: DiffRow;
  side: Side;
  onOpen: ((row: DiffRow, side?: Side) => void) | undefined;
}) {
  const line = row[side];
  if (line === undefined || !onOpen) return <span className="ln">{line ?? ''}</span>;
  return (
    <button
      type="button"
      className="ln ln-open"
      title={`Open line ${line} of ${side} in VS Code`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(row, side);
      }}
    >
      {line}
    </button>
  );
}

function isAnchor(row: DiffRow, anchor: Anchor | null): boolean {
  if (!anchor) return false;
  return anchor.side === 'head'
    ? row.type === 'add' && row.head === anchor.line
    : row.type === 'del' && row.base === anchor.line;
}

function CommentBox({
  comments,
  anchor,
  ready,
  pickable,
}: {
  comments: Comments;
  anchor: Anchor | null;
  /** False while the code (and so the default line) is loading. */
  ready: boolean;
  pickable: boolean;
}) {
  const [text, setText] = useState('');
  const add = () => {
    if (!ready || !text.trim()) return;
    comments.onAdd(anchor, text);
    setText('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      add();
    }
  };
  return (
    <section className="comments">
      <h3>
        Comments <span className="muted">({comments.drafts.length})</span>
      </h3>
      {comments.drafts.map((draft) => (
        <div key={draft.id} className="draft">
          <div className="draft-where">
            <span className="muted">{describeDraft(draft)}</span>
            <button className="link" onClick={() => comments.onRemove(draft.id)}>
              Delete
            </button>
          </div>
          <p className="draft-body">{draft.body}</p>
        </div>
      ))}
      <textarea
        id="comment-input"
        className="comment-input"
        aria-label="Comment"
        placeholder="Leave a comment (sent with the review)"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="comment-actions">
        <span className="muted">
          {describeAnchor(anchor)}
          {pickable ? ' · click a +/− line to move it' : ''}
        </span>
        <button className="review" onClick={add} disabled={!ready || !text.trim()}>
          Add comment
        </button>
      </div>
    </section>
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
              {item.possible ? ' · possible' : ''}
              {item.side === 'base' ? ' · removed' : item.side === 'head' ? ' · new' : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Where a symbol is: `web › src/app/foo.ts` when the change spans projects, else the path. */
function FileLine({
  node,
  projects,
  moved,
}: {
  node: GraphNode;
  projects: readonly Project[] | undefined;
  moved: string;
}) {
  const file = (node.head ?? node.base)?.file ?? node.id;
  // Packages and dynamic calls are in no project.
  const project = projects && groupOf(node).file ? projectOf(file, projects) : undefined;
  return (
    <div className="panel-file" {...(project ? { title: file } : {})}>
      {project ? (
        <>
          <span className="panel-project">{project.name}</span> › {pathInProject(file, project)}
        </>
      ) : (
        file
      )}
      {moved}
    </div>
  );
}
