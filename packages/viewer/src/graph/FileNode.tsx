import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { FileData } from './flow.js';
import { tip } from '../ui/tip.js';

export function FileNode({ data }: NodeProps<Node<FileData, 'file'>>) {
  return (
    // Named on hover anywhere in the box: on the map, its name may be cut at the box's edge.
    <div
      className={`file-box${data.changed ? ' changed' : ''}`}
      {...tip(data.label, { code: true })}
    >
      {/* Unseen: where the map's file-pair edges start and end (V8c). */}
      <Handle type="target" position={Position.Left} className="file-handle" />
      {/* rtl container + ltr text: a long path loses its start, not its file name. In a
          project's frame the path starts at the project's folder. */}
      <div className="file-label" {...tip(data.label, { code: true })}>
        <span dir="ltr">{data.local ?? data.label}</span>
      </div>
      {/* On the map (zoomed out) only the name is shown, large enough to read. */}
      <div className="file-name">{shortName(data.label)}</div>
      <Handle type="source" position={Position.Right} className="file-handle" />
    </div>
  );
}

/** `src/app/foo.component.ts` → `foo.component.ts`; packages and dynamic calls as they are. */
function shortName(label: string): string {
  return label.startsWith('package ') || !label.includes('/')
    ? label
    : label.slice(label.lastIndexOf('/') + 1);
}
