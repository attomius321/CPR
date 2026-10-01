import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { SymbolData } from './flow.js';

const SEVERITIES = ['error', 'warning', 'info'] as const;

export function SymbolNode({ data, selected }: NodeProps<Node<SymbolData, 'symbol'>>) {
  const { node, tone, label, file, tags, findings, reviewed, settled } = data;
  return (
    <div
      className={`symbol tone-${tone}${selected ? ' selected' : ''}${reviewed ? ' reviewed' : ''}${settled ? ' settled' : ''}`}
      title={node.id}
    >
      <Handle type="target" position={Position.Left} />
      <div className="symbol-head">
        <span className="symbol-kind">{node.kind}</span>
        <span className="symbol-name">{label}</span>
        {reviewed && <span className="check">✓</span>}
        {SEVERITIES.map((severity) =>
          findings[severity] > 0 ? (
            <span
              key={severity}
              className={`badge badge-${severity}`}
              title={`${findings[severity]} ${severity}`}
            >
              {findings[severity]}
            </span>
          ) : null,
        )}
      </div>
      <div className="symbol-file">
        <span>{file}</span>
        {tags.map((tag) => (
          <span key={tag} className={`tag tag-${tag}`}>
            {tag}
          </span>
        ))}
        {(node.since === 'new' || node.since === 'updated') && (
          <span className="tag tag-since" title="Compared with the earlier version">
            {node.since}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
