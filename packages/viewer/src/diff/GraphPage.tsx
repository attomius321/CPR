// A diff's Graph page (V60): its parts beside the canvas — the drop zone for a graph file, the
// legend.
import type { ReactNode } from 'react';
import { ForwardIcon } from '../ui/icons.js';

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
export function Legend({ frames, children }: { frames: boolean; children: ReactNode }) {
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
