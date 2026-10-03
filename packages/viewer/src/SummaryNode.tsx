import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { SummaryData } from './flow.js';

/** Many unchanged neighbours of one changed symbol, as one node; a click shows or hides them. */
export function SummaryNode({ data }: NodeProps<Node<SummaryData, 'summary'>>) {
  const { side, count, files, expanded } = data;
  const what = side === 'users' ? plural(count, 'user') : plural(count, 'use');
  // What a changed symbol uses can be a package; what uses it is always the repo's code.
  const where =
    side === 'users'
      ? plural(files, 'file')
      : plural(files, 'file or package', 'files or packages');
  return (
    <div
      className={`summary-node${expanded ? ' expanded' : ''}`}
      title={expanded ? `Hide these ${what}` : `Show these ${what}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="summary-count">{what}</div>
      <div className="summary-where">
        <span>in {where}</span>
        <span className="summary-action">{expanded ? 'hide' : 'show'}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
