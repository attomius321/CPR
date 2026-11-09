// A diff's canvas area (V61, V72): the drop zone for a graph file, and the canvas as a card, its
// legend at its foot with the view's toggles.
import type { ReactNode } from 'react';
import { ForwardIcon } from '../ui/icons.js';
import type { decorate } from '../graph/flow.js';
import type { useLayout } from '../graph/useLayout.js';
import { Loading } from '../ui/Loading.js';
import { tip } from '../ui/tip.js';
import { Canvas } from './Canvas.js';
import type { State } from './useDiffGraph.js';

export function DropZone({
  error,
  onFile,
}: {
  error?: string | undefined;
  onFile: (file: File) => void;
}) {
  return (
    <div className="dropzone">
      <h1>Review a change as a graph</h1>
      <p>
        Run <code>symbiote view main</code>, or drop a graph JSON from{' '}
        <code>symbiote diff main --out graph.json</code> here.
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

/**
 * The canvas's foot (V90): the marks for a change's kinds, the edges, the frames' parts when
 * drawn; the view's toggles (`children`) at its end. `frames`: the canvas draws projects' frames.
 */
function Legend({ frames, children }: { frames: boolean; children: ReactNode }) {
  return (
    <footer className="legend">
      {(
        [
          ['added', '+'],
          ['removed', '−'],
          ['modified', '~'],
          ['moved', null],
        ] as const
      ).map(([kind, glyph]) => (
        <span key={kind} className={`legend-item tone-${kind}`}>
          <span className={`symbol-mark mark-${kind}`} aria-hidden="true">
            {glyph ?? <ForwardIcon />}
          </span>
          {kind}
        </span>
      ))}
      <span className="legend-item legend-context">unchanged</span>
      <span className="legend-edge edge-head">added call</span>
      <span className="legend-edge edge-base">removed call</span>
      {frames && <span className="legend-edge edge-cross">call between projects</span>}
      <span className="legend-item legend-summary">many neighbours, grouped</span>
      {frames && <span className="legend-item legend-project">project (app or library)</span>}
      <span className="legend-toggles">{children}</span>
    </footer>
  );
}

/**
 * The canvas a card (V61), its legend at its foot since V72: the cards of the two pages start and
 * end at the same places. The view's toggles at the legend's end (V90, decision 838).
 */
export function CanvasCard({
  state,
  layout,
  flowNodes,
  pending,
  selected,
  setSelected,
  focus,
  setFocus,
  project,
  resizing,
  toggleSummary,
  reveal,
  sinceOnly,
  setSinceOnly,
  context,
  setContext,
  typeReferences,
  setTypeReferences,
}: {
  state: Extract<State, { status: 'ready' }>;
  layout: ReturnType<typeof useLayout>['layout'];
  flowNodes: ReturnType<typeof decorate> | undefined;
  pending: boolean;
  selected: string | null;
  setSelected: (id: string | null) => void;
  focus: boolean;
  setFocus: (focus: boolean) => void;
  /** The one project shown, the canvas's scope. */
  project: string | null;
  /** A panel is being resized: the canvas waits for the drop to centre the selection again. */
  resizing: boolean;
  toggleSummary: (id: string) => void;
  /** What to fit after a group is shown or hidden. */
  reveal: string[] | null;
  sinceOnly: boolean;
  setSinceOnly: (on: boolean) => void;
  context: boolean;
  setContext: (on: boolean) => void;
  typeReferences: boolean;
  setTypeReferences: (on: boolean) => void;
}) {
  return (
    <div className="canvas-card">
      {layout && flowNodes ? (
        <Canvas
          nodes={flowNodes}
          edges={layout.edges}
          fileEdges={layout.fileEdges}
          layoutNodes={layout.nodes}
          pending={pending}
          selected={selected}
          focus={focus}
          scope={project}
          resizing={resizing}
          onSelect={setSelected}
          onToggleSummary={toggleSummary}
          reveal={reveal}
        />
      ) : (
        // The first layout: the change list and findings are there meanwhile.
        <Loading className="hint canvas-waiting layout-pending" status>
          Laying out…
        </Loading>
      )}
      {layout && (
        <Legend frames={layout.nodes[0]?.type === 'project'}>
          {/* The view's toggles at the legend's end (V90, decision 838). */}
          {state.graph.since && (
            <label
              className="toggle"
              {...tip('Leave out symbols changed the same way as in the earlier version')}
            >
              <input
                type="checkbox"
                checked={sinceOnly}
                onChange={(e) => setSinceOnly(e.target.checked)}
              />
              Only changes since {state.graph.since.sha.slice(0, 7)}
            </label>
          )}
          <label
            className="toggle"
            {...tip('Show only the selected symbol and its neighbours', { keys: 'f' })}
          >
            <input type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)} />
            Focus
          </label>
          <label className="toggle" {...tip('Show unchanged neighbours and packages')}>
            <input
              type="checkbox"
              checked={context}
              onChange={(e) => setContext(e.target.checked)}
            />
            Context
          </label>
          <label className="toggle" {...tip('Show the uses of types')}>
            <input
              type="checkbox"
              checked={typeReferences}
              onChange={(e) => setTypeReferences(e.target.checked)}
            />
            Type references
          </label>
        </Legend>
      )}
    </div>
  );
}
