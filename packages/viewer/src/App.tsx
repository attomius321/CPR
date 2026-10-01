import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import type { Graph } from '@cpr/core';
import { toFlow, type SymbolData } from './flow.js';
import { FileNode } from './FileNode.js';
import { SymbolNode } from './SymbolNode.js';

const nodeTypes = { symbol: SymbolNode, file: FileNode };

type State =
  { status: 'loading' } | { status: 'empty'; error?: string } | { status: 'ready'; graph: Graph };

/** Where the graph comes from: `?graph=<url>`, else `cpr view`'s API. */
function graphUrl(): string {
  return new URLSearchParams(window.location.search).get('graph') ?? './api/graph';
}

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [typeReferences, setTypeReferences] = useState(false);
  const [context, setContext] = useState(true);

  useEffect(() => {
    fetch(graphUrl())
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        setState({ status: 'ready', graph: (await response.json()) as Graph });
      })
      .catch(() => setState({ status: 'empty' }));
  }, []);

  const load = useCallback(async (file: File) => {
    try {
      setState({ status: 'ready', graph: JSON.parse(await file.text()) as Graph });
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

  const flow = useMemo(
    () => (state.status === 'ready' ? toFlow(state.graph, { typeReferences, context }) : undefined),
    [state, typeReferences, context],
  );

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="bar">
        <strong className="brand">CPR</strong>
        {state.status === 'ready' && <Summary graph={state.graph} />}
        <div className="spacer" />
        {state.status === 'ready' && (
          <>
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
        {flow && (
          <ReactFlow<Node, Edge>
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            fitView
            colorMode="system"
            minZoom={0.1}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeClassName={(n) => `minimap-${(n.data as SymbolData).tone}`}
            />
          </ReactFlow>
        )}
      </main>
      {flow && <Legend />}
    </div>
  );
}

function Summary({ graph }: { graph: Graph }) {
  const { base, head } = graph.revisions;
  const side = (ref: string, sha: string | null) => (sha ? `${ref} (${sha.slice(0, 7)})` : ref);
  const { added, removed, modified } = graph.stats.symbols;
  const severity = (s: string) => graph.findings.filter((f) => f.severity === s).length;
  return (
    <div className="summary">
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
    </footer>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
