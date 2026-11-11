import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { FileData, MapCount } from './flow.js';
import { shortName } from './map-labels.js';
import { tip } from '../ui/tip.js';

export function FileNode({ data }: NodeProps<Node<FileData, 'file'>>) {
  return (
    // Named on hover anywhere in the box: on the map, its name may be cut at the box's edge.
    <div
      className={`file-box${data.changed ? ' changed' : ''}${data.severity ? ` findings-${data.severity}` : ''}`}
      {...tip(data.label, { code: true })}
    >
      {/* Unseen: where the map's file-pair edges start and end (V8c). */}
      <Handle type="target" position={Position.Left} className="file-handle" />
      {/* rtl container + ltr text: a long path loses its start, not its file name. In a
          project's frame the path starts at the project's folder. */}
      <div className="file-label" {...tip(data.label, { code: true })}>
        <span dir="ltr">{data.local ?? data.label}</span>
      </div>
      {/* On the map (zoomed out) only the name is shown, large enough to read; faint where a
          project's name is over it, below `cover` (V96). */}
      <div
        className="file-name"
        {...(data.cover ? { style: { '--cover-zoom': data.cover } as CSSProperties } : {})}
      >
        {shortName(data.label)}
      </div>
      {/* And its symbols' findings counts, above the name (V100): the cards' own are hidden. In a
          frame, the frame draws them (V96). */}
      {data.counts && <MapCounts counts={data.counts} />}
      <Handle type="source" position={Position.Right} className="file-handle" />
    </div>
  );
}

/** Symbols' findings counts on the map (V100), each at its card's top-right corner. */
export function MapCounts({ counts }: { counts: readonly MapCount[] }) {
  return counts.map(({ symbol, x, y, count, severity }) => (
    <span
      key={symbol}
      className={`symbol-count map-count count-${severity}`}
      style={{ left: x, top: y }}
      data-symbol={symbol}
      aria-hidden="true"
    >
      {count}
    </span>
  ));
}
