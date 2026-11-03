import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Finding, Graph, GraphNode, Project } from '@symbiote/core';
import {
  anchorFor,
  defaultAnchor,
  describeAnchor,
  describeDraft,
  type Anchor,
  type Draft,
  type Side,
} from './comments.js';
import {
  diffRows,
  excerpt,
  neighbourGroups,
  symbolDetail,
  type DiffRow,
  type NeighbourGroup,
} from './detail.js';
import { groupOf, label, tone, type Tone } from '../graph/flow.js';
import {
  anchorTarget,
  describeOpen,
  openInEditor,
  rowTarget,
  symbolTarget,
  type OpenTarget,
} from './open.js';
import { OpenIcon } from './OpenIcon.js';
import { pathInProject, projectOf } from '../graph/projects.js';
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  ExternalIcon,
  FailedIcon,
  HelpIcon,
} from '../ui/icons.js';
import { CodeText, useTokens } from '../ui/CodeText.js';
import { tip } from '../ui/tip.js';
import { Loading } from '../ui/Loading.js';

const sources = new Map<string, Promise<string>>();

/** How long "Opened in VS Code …" stays; an error stays until the next open. */
const NOTE_MS = 8000;
/** The key that opens a row in VS Code with a click. */
const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';

/** Fetches a file once per side; `symbiote view` serves them, a dropped file has none. */
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
  /** Whether `/api/source` exists (opened with `symbiote view`). */
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
  /** Present when the review can be posted to the forge (`symbiote pr`). */
  comments?: Comments | undefined;
}

export interface Comments {
  /** This symbol's drafts. */
  drafts: Draft[];
  onAdd: (anchor: Anchor | null, body: string) => void;
  onRemove: (id: string) => void;
}

/** The panel is keyed by symbol, so its state (picked line, comment text) starts fresh per symbol.
 * */
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
  const { node, findings, mentions } = detail;
  const groups = neighbourGroups(detail);
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

  const kind = tone(node);
  const where = (node.head ?? node.base)?.range.start.line;
  const at = node.head ? graph.revisions.head.sha : graph.revisions.base.sha;
  const codeWord =
    node.status === 'removed'
      ? 'Its code, removed'
      : node.status === 'added'
        ? 'Its code, added'
        : node.status === 'unchanged'
          ? 'Its code'
          : 'Its code, changed';

  // The proof's order (V90, decision 841): what it is and where, its findings, who uses it and
  // what it uses, its signature and members, its code, then the comment box and Mark reviewed.
  return (
    <aside className="panel" aria-label="Symbol detail">
      <header className="panel-head">
        <div className="panel-head-line">
          <span className="panel-kind">{node.kind}</span>
          <h2 className={`panel-title${node.status === 'removed' ? ' removed' : ''}`}>
            {label(node)}
          </h2>
          <span className={`kind-pill tone-${kind}`}>{KIND_PILLS[kind]}</span>
          <button className="close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="panel-where">
          <FileLine node={node} projects={projects} moved={moved} />
          {where !== undefined && (
            <span className="panel-at">
              {' '}
              · line {where}
              {at ? ` at ${at.slice(0, 7)}` : ''}
            </span>
          )}
        </div>
        {(node.since === 'new' || node.since === 'updated' || node.delta) && (
          <div className="panel-tags">
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
        )}
        {openTarget && (
          <button
            id="open-in-editor"
            type="button"
            className="open-editor"
            {...tip(`Open line ${openTarget.line} of ${openTarget.side} in VS Code`, {
              keys: 'o',
            })}
            onClick={() => open(openTarget)}
          >
            <OpenIcon />
            Open in VS Code
            <kbd aria-hidden="true">o</kbd>
          </button>
        )}
        {canOpen && (
          <div className={`open-note${note?.error ? ' open-error' : ''}`} role="status">
            {note?.text}
          </div>
        )}
        {stale && <div className="stale-note">↻ Changed since you reviewed it</div>}
      </header>

      {findings.length + mentions.length > 0 && (
        <section className="panel-block">
          {findings.map((f) => (
            <FindingItem key={f.id} finding={f} onSelect={onSelect} />
          ))}
          {mentions.map((f) => (
            <FindingItem key={f.id} finding={f} onSelect={onSelect} mention />
          ))}
        </section>
      )}

      {groups.length > 0 && (
        <section className="panel-block">
          {groups.map((group) => (
            <Neighbours
              key={group.title}
              group={group}
              onSelect={onSelect}
              {...(canOpen ? { onOpen: (target: OpenTarget | null) => open(target) } : {})}
            />
          ))}
        </section>
      )}

      {signatures.length > 0 && (
        <section className="panel-block">
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
        <section className="panel-block">
          <h3>
            Changed members <span className="neighbours-count">{members.length}</span>
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
        <section className="panel-block">
          <h3>{codeWord}</h3>
          <SymbolDiff
            state={diff}
            path={(node.head ?? node.base)?.file}
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

      <section className="panel-block panel-actions">
        {comments && (
          <CommentBox
            comments={comments}
            anchor={anchor}
            name={label(node)}
            ready={!showsCode || !hasSources || diff.status !== 'loading'}
            pickable={rows.some((r) => r.type !== 'same')}
          />
        )}
        {node.status !== 'unchanged' && (
          <button
            className={`button secondary mark-reviewed${reviewed ? ' done' : ''}`}
            onClick={onToggleReviewed}
            {...tip(reviewed ? 'Mark it not reviewed' : 'Mark it reviewed', { keys: 'r' })}
          >
            <CheckIcon />
            {reviewed ? 'Reviewed' : 'Mark reviewed'}
            <kbd aria-hidden="true">r</kbd>
          </button>
        )}
      </section>
    </aside>
  );
}

/** A symbol's kind of change in its pill (V90): its word. */
const KIND_PILLS: Record<Tone, string> = {
  added: 'Added',
  removed: 'Removed',
  modified: 'Modified',
  moved: 'Moved',
  context: 'Unchanged',
  external: 'Package',
  unknown: 'Dynamic',
};

/** Long symbols show this many rows until expanded. */
const MAX_ROWS = 300;

interface SymbolDiffProps {
  state: SourceState;
  /** Its file: the language its colours are read in (V93). */
  path?: string | undefined;
  /** The line the next comment goes on, highlighted. */
  anchor: Anchor | null;
  /** Picks a changed line for the next comment. */
  onPick?: (row: DiffRow) => void;
  /** Opens a row in VS Code: Ctrl/⌘+click, or its line number (that side). */
  onOpen?: (row: DiffRow, side?: Side) => void;
}

const NO_ROWS: DiffRow[] = [];

function SymbolDiff({ state, anchor, onPick, onOpen, path }: SymbolDiffProps) {
  const [all, setAll] = useState(false);
  const tokens = useTokens(state.status === 'ready' ? state.rows : NO_ROWS, path);
  if (state.status === 'loading') return <Loading className="muted">Loading source…</Loading>;
  if (state.status === 'none') {
    return (
      <p className="muted">Source is available when the graph is opened with symbiote view.</p>
    );
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
              <CodeText text={row.text} tokens={tokens?.get(row)} />
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
export function LineNumber({
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
      {...tip(`Open line ${line} of ${side} in VS Code`)}
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
  name,
  ready,
  pickable,
}: {
  comments: Comments;
  anchor: Anchor | null;
  /** The symbol's name, in the box's placeholder. */
  name: string;
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
        placeholder={`Comment on ${name}…`}
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
        <button
          className="button secondary"
          onClick={add}
          disabled={!ready || !text.trim()}
          {...tip('Add the comment, sent with the review', { keys: 'Ctrl+Enter' })}
        >
          Add comment
        </button>
      </div>
    </section>
  );
}

const SEVERITY_ICONS = { error: FailedIcon, warning: AlertIcon, info: HelpIcon } as const;

/** A finding as an alert in its severity's tint (V90): its icon and message, its rule quiet. */
function FindingItem({
  finding,
  onSelect,
  mention = false,
}: {
  finding: Finding;
  onSelect: (id: string) => void;
  mention?: boolean;
}) {
  const Icon = SEVERITY_ICONS[finding.severity];
  return (
    <div className={`finding finding-${finding.severity}`}>
      <p className="finding-message">
        <span className="finding-icon" aria-label={finding.severity}>
          <Icon />
        </span>
        <span>{finding.message}</span>
      </p>
      <div className="finding-rule">
        {finding.rule}
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
    </div>
  );
}

/**
 * A group of neighbours (V90, decision 841): still used by (red), used before by (green, no
 * longer), used by and uses; each its name, its file and line.
 */
function Neighbours({
  group,
  onSelect,
  onOpen,
}: {
  group: NeighbourGroup;
  onSelect: (id: string) => void;
  /** Opens a use in VS Code (V93, decision 888: proof 03's Open ↗ beside each). */
  onOpen?: (target: OpenTarget | null) => void;
}) {
  const { title, tone: groupTone, items } = group;
  return (
    <div className={`neighbours-group${groupTone ? ` group-${groupTone}` : ''}`}>
      <h3>
        {title} <span className="neighbours-count">{items.length}</span>
      </h3>
      <ul className="neighbours">
        {items.map((item) => {
          const decl = item.node && (item.node.head ?? item.node.base);
          return (
            <li key={`${item.id}|${item.kind}`}>
              {groupTone && (
                <span className="neighbour-icon" aria-hidden="true">
                  {groupTone === 'error' ? <FailedIcon /> : <CheckIcon />}
                </span>
              )}
              <button className="link" onClick={() => onSelect(item.id)} disabled={!item.node}>
                {item.node ? label(item.node) : item.id}
              </button>
              <span className="muted">
                {/* Where it is, then how it is used when not a call; the kind alone without a place. */}
                {decl ? `${decl.file}:${decl.range.start.line}` : item.kind}
                {decl && item.kind !== 'call' ? ` · ${item.kind}` : ''}
                {item.side === 'head' ? ' · new' : ''}
                {item.possible ? ' · possible' : ''}
              </span>
              {onOpen && item.node && symbolTarget(item.node) && (
                <button
                  type="button"
                  className="neighbour-open"
                  {...tip(`Open ${label(item.node)} in VS Code`)}
                  onClick={() => item.node && onOpen(symbolTarget(item.node))}
                >
                  Open
                  <ExternalIcon />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
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
    <div className="panel-file" {...(project ? tip(file, { code: true }) : {})}>
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
