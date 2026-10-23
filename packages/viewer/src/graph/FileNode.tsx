import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { FileData } from './flow.js';

export function FileNode({ data }: NodeProps<Node<FileData, 'file'>>) {
  return (
    <div className={`file-box${data.changed ? ' changed' : ''}`}>
      {/* Unseen: where the map's file-pair edges start and end (V8c). */}
      <Handle type="target" position={Position.Left} className="file-handle" />
      {/* rtl container + ltr text: a long path loses its start, not its file name. In a
          project's frame the path starts at the project's folder. */}
      <div className="file-label" title={data.label}>
        <span dir="ltr">{data.local ?? data.label}</span>
      </div>
      {/* On the map (zoomed out) only the name is shown, large enough to read. */}
      <div className="file-name" title={data.label}>
        {shortName(data.label)}
      </div>
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
