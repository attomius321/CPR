import type { Node, NodeProps } from '@xyflow/react';
import type { FileData } from './flow.js';

export function FileNode({ data }: NodeProps<Node<FileData, 'file'>>) {
  return (
    <div className={`file-box${data.changed ? ' changed' : ''}`}>
      <div className="file-label">{data.label}</div>
    </div>
  );
}
