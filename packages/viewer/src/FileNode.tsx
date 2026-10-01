import type { Node, NodeProps } from '@xyflow/react';
import type { FileData } from './flow.js';

export function FileNode({ data }: NodeProps<Node<FileData, 'file'>>) {
  return (
    <div className={`file-box${data.changed ? ' changed' : ''}`}>
      {/* rtl container + ltr text: a long path loses its start, not its file name. */}
      <div className="file-label" title={data.label}>
        <span dir="ltr">{data.label}</span>
      </div>
    </div>
  );
}
