import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import type { Graph } from '@cpr/core';
import {
  draftId,
  draftsKey,
  loadDrafts,
  saveDrafts,
  type Anchor,
  type ReviewDraft,
} from './comments.js';
import { DetailPanel } from './DetailPanel.js';
import { FileNode } from './FileNode.js';
import { toFlow, type FlowEdge, type FlowNode, type SymbolData } from './flow.js';
import {
  changeList,
  loadReviewed,
  neighbourhood,
  reviewKey,
  saveReviewed,
  stepChange,
} from './review.js';
import { Sidebar } from './Sidebar.js';
import { SymbolNode } from './SymbolNode.js';

const nodeTypes = { symbol: SymbolNode, file: FileNode };

type State =
  | { status: 'loading' }
  | { status: 'empty'; error?: string }
  /**
   * `sources`: opened through `cpr view`, so `/api/source` exists. `forge`: opened through
   * `cpr pr`, which posts reviews there.
   */
  | { status: 'ready'; graph: Graph; sources: boolean; forge: Forge | null };

type Forge = 'github' | 'gitlab';

interface Capabilities {
  sources: boolean;
  review: { forge: Forge } | null;
}

/** Where the graph comes from: `?graph=<url>`, else `cpr view`'s API. */
function graphUrl(): string {
  return new URLSearchParams(window.location.search).get('graph') ?? './api/graph';
}

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [typeReferences, setTypeReferences] = useState(false);
  const [context, setContext] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState<ReviewDraft>({ drafts: [], body: '' });

  const graph = state.status === 'ready' ? state.graph : undefined;
  const forge = state.status === 'ready' ? state.forge : null;
  const changes = useMemo(() => (graph ? changeList(graph) : []), [graph]);
  useEffect(() => {
    if (!graph) return;
    setReviewed(loadReviewed(reviewKey(graph)));
    setDraft(loadDrafts(draftsKey(graph)));
  }, [graph]);

  const updateDraft = useCallback(
    (change: (current: ReviewDraft) => ReviewDraft) => {
      if (!graph) return;
      setDraft((current) => {
        const next = change(current);
        saveDrafts(draftsKey(graph), next);
        return next;
      });
    },
    [graph],
  );

  const toggleReviewed = useCallback(
    (id: string) => {
      if (!graph) return;
      setReviewed((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        saveReviewed(reviewKey(graph), next);
        return next;
      });
    },
    [graph],
  );

  // Keyboard review: j/k walk the changes, r marks reviewed, f focuses, c comments, Esc closes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const typing =
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLInputElement && !['checkbox', 'radio'].includes(target.type));
      if (typing) {
        // Esc leaves the field (keeping what was typed) instead of closing the panel.
        if (event.key === 'Escape') target.blur();
        return;
      }
      if (event.key === 'c' && document.getElementById('comment-input')) {
        event.preventDefault();
        document.getElementById('comment-input')?.focus();
      } else if (event.key === 'j') setSelected((id) => stepChange(changes, id, 1));
      else if (event.key === 'k') setSelected((id) => stepChange(changes, id, -1));
      else if (event.key === 'r' && selected) toggleReviewed(selected);
      else if (event.key === 'f') setFocus((on) => !on);
      else if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [changes, selected, toggleReviewed]);

  useEffect(() => {
    const url = graphUrl();
    const served = url === './api/graph';
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const graph = (await response.json()) as Graph;
        const capabilities = served ? await fetchCapabilities() : null;
        setState({
          status: 'ready',
          graph,
          sources: served,
          forge: capabilities?.review?.forge ?? null,
        });
      })
      .catch(() => setState({ status: 'empty' }));
  }, []);

  const load = useCallback(async (file: File) => {
    try {
      const graph = JSON.parse(await file.text()) as Graph;
      setState({ status: 'ready', graph, sources: false, forge: null });
      setSelected(null);
    } catch (error) {
      setState({ status: 'empty', error: `Not a CPR graph: ${(error as Error).message}` });
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file) void load(file);
    },
    [load],
  );

  const addDraft = useCallback(
    (symbol: string, anchor: Anchor | null, body: string) =>
      updateDraft((d) => ({
        ...d,
        drafts: [...d.drafts, { id: draftId(), symbol, anchor, body: body.trim() }],
      })),
    [updateDraft],
  );
  const removeDraft = useCallback(
    (id: string) => updateDraft((d) => ({ ...d, drafts: d.drafts.filter((x) => x.id !== id) })),
    [updateDraft],
  );

  const flow = useMemo(() => {
    if (!graph) return undefined;
    const focusSet = focus && selected ? neighbourhood(graph, selected) : undefined;
    return toFlow(graph, {
      typeReferences,
      context,
      reviewed,
      ...(focusSet ? { focus: focusSet } : {}),
    });
  }, [graph, typeReferences, context, reviewed, focus, selected]);

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="bar">
        <strong className="brand">CPR</strong>
        {state.status === 'ready' && <Summary graph={state.graph} />}
        <div className="spacer" />
        {state.status === 'ready' && (
          <>
            <label className="toggle" title="Show only the selected symbol and its neighbours (f)">
              <input type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)} />
              Focus
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={context}
                onChange={(e) => setContext(e.target.checked)}
              />
              Context
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={typeReferences}
                onChange={(e) => setTypeReferences(e.target.checked)}
              />
              Type references
            </label>
          </>
        )}
      </header>
      <main className="canvas">
        {state.status === 'loading' && <p className="hint">Loading graph…</p>}
        {state.status === 'empty' && (
          <DropZone error={state.error} onFile={(file) => void load(file)} />
        )}
        {flow && state.status === 'ready' && (
          <ReactFlowProvider>
            <Sidebar
              graph={state.graph}
              changes={changes}
              reviewed={reviewed}
              selected={selected}
              onSelect={setSelected}
              onToggleReviewed={toggleReviewed}
              review={
                forge
                  ? {
                      forge,
                      draft,
                      onBody: (body) => updateDraft((d) => ({ ...d, body })),
                      onRemove: removeDraft,
                      onPosted: () => updateDraft(() => ({ drafts: [], body: '' })),
                    }
                  : undefined
              }
            />
            <Canvas
              nodes={flow.nodes}
              edges={flow.edges}
              selected={selected}
              focus={focus}
              onSelect={setSelected}
            />
            {selected && (
              <DetailPanel
                key={selected}
                graph={state.graph}
                id={selected}
                sources={state.sources}
                reviewed={reviewed.has(selected)}
                onToggleReviewed={() => toggleReviewed(selected)}
                onSelect={setSelected}
                onClose={() => setSelected(null)}
                comments={
                  forge
                    ? {
                        drafts: draft.drafts.filter((d) => d.symbol === selected),
                        onAdd: (anchor, body) => addDraft(selected, anchor, body),
                        onRemove: removeDraft,
                      }
                    : undefined
                }
              />
            )}
          </ReactFlowProvider>
        )}
      </main>
      {flow && <Legend />}
    </div>
  );
}

interface CanvasProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selected: string | null;
  /** In focus mode the whole (small) neighbourhood is fitted; otherwise the selection is centered. */
  focus: boolean;
  onSelect: (id: string | null) => void;
}

/** The graph; brings the selected symbol into view when it changes. */
function Canvas({ nodes, edges, selected, focus, onSelect }: CanvasProps) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    // Wait a frame so React Flow has measured nodes that just appeared.
    const frame = requestAnimationFrame(() => {
      if (focus) void fitView({ duration: 300, maxZoom: 1.1 });
      else if (selected) void fitView({ nodes: [{ id: selected }], duration: 300, maxZoom: 1.1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, focus, nodes, fitView]);

  const marked = useMemo(
    () => nodes.map((n) => (n.type === 'symbol' ? { ...n, selected: n.id === selected } : n)),
    [nodes, selected],
  );

  return (
    <ReactFlow<Node, Edge>
      nodes={marked}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      colorMode="system"
      minZoom={0.1}
      nodesConnectable={false}
      onNodeClick={(_, node) => {
        if (node.type === 'symbol') onSelect(node.id);
      }}
      onPaneClick={() => onSelect(null)}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeClassName={(n) =>
          n.type === 'symbol' ? `minimap-${(n.data as SymbolData).tone}` : 'minimap-file'
        }
      />
    </ReactFlow>
  );
}

/** What the server offers; `cpr view` builds before this endpoint existed answer nothing. */
async function fetchCapabilities(): Promise<Capabilities | null> {
  try {
    const response = await fetch('./api/capabilities');
    return response.ok ? ((await response.json()) as Capabilities) : null;
  } catch {
    return null;
  }
}

function Summary({ graph }: { graph: Graph }) {
  const { base, head } = graph.revisions;
  const side = (ref: string, sha: string | null) => (sha ? `${ref} (${sha.slice(0, 7)})` : ref);
  const { added, removed, modified } = graph.stats.symbols;
  const severity = (s: string) => graph.findings.filter((f) => f.severity === s).length;
  const request = graph.changeRequest;
  return (
    <div className="summary">
      {request && (
        <a className="request" href={request.url} target="_blank" rel="noreferrer">
          {request.forge === 'gitlab' ? '!' : '#'}
          {request.number} {request.title}
          {request.draft && <span className="chip">draft</span>}
          {request.state !== 'open' && <span className="chip">{request.state}</span>}
        </a>
      )}
      <span className="revisions">
        {side(base.ref, base.sha)} → {side(head.ref, head.sha)}
      </span>
      <span className="chip">{graph.stats.filesChanged} files</span>
      <span className="chip chip-added">+{added}</span>
      <span className="chip chip-removed">−{removed}</span>
      <span className="chip chip-modified">~{modified}</span>
      {severity('error') > 0 && (
        <span className="badge badge-error">{plural(severity('error'), 'error')}</span>
      )}
      {severity('warning') > 0 && (
        <span className="badge badge-warning">{plural(severity('warning'), 'warning')}</span>
      )}
    </div>
  );
}

function DropZone({ error, onFile }: { error?: string | undefined; onFile: (file: File) => void }) {
  return (
    <div className="dropzone">
      <h1>Review a change as a graph</h1>
      <p>
        Run <code>cpr view main</code>, or drop a graph JSON from{' '}
        <code>cpr diff main --out graph.json</code> here.
      </p>
      <label className="button">
        Choose a file
        <input
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </label>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Legend() {
  return (
    <footer className="legend">
      {(['added', 'removed', 'modified', 'moved', 'context', 'external', 'unknown'] as const).map(
        (tone) => (
          <span key={tone} className={`legend-item tone-${tone}`}>
            {tone}
          </span>
        ),
      )}
      <span className="legend-edge edge-head">added edge</span>
      <span className="legend-edge edge-base">removed edge</span>
      <span className="legend-hint">click a symbol for details</span>
    </footer>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
