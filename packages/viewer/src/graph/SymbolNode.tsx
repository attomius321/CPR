import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { findingCount, kindMark, type SymbolData } from './flow.js';
import { CheckIcon, ForwardIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';

const TONES = { error: 'bad', warning: 'warn', info: 'info' } as const;
const KIND_WORDS = { added: 'added', removed: 'removed', modified: 'modified', moved: 'moved' };

/**
 * A changed symbol or a neighbour (V90, decision 835): a neutral card, its kind in caps, one count
 * of its findings and a mark for its kind of change on the first line, its name, its signature.
 * No coloured text, ground or side bar: the mark carries the kind.
 */
export function SymbolNode({ data, selected }: NodeProps<Node<SymbolData, 'symbol'>>) {
  const { node, tone, label, file, findings, reviewed, settled } = data;
  const mark = kindMark(tone);
  const count = findingCount(findings);
  return (
    <div
      className={`symbol tone-${tone}${selected ? ' selected' : ''}${reviewed ? ' reviewed' : ''}${settled ? ' settled' : ''}`}
      {...tip(node.id, { code: true })}
    >
      <Handle type="target" position={Position.Left} />
      <div className="symbol-head">
        <span className="symbol-kind">{node.kind}</span>
        {(node.since === 'new' || node.since === 'updated') && (
          <span className="symbol-since" {...tip('Compared with the earlier version')}>
            {node.since}
          </span>
        )}
        {tone === 'context' && <span className="symbol-unchanged">unchanged</span>}
        {reviewed && (
          <span className="check" aria-label="Reviewed">
            <CheckIcon />
          </span>
        )}
        {count && (
          <span
            className={`symbol-count count-${count.severity}`}
            {...tip(count.words, { tone: TONES[count.severity] })}
          >
            {count.count}
          </span>
        )}
        {mark && (
          <span
            className={`symbol-mark mark-${mark.kind}`}
            role="img"
            aria-label={KIND_WORDS[mark.kind]}
          >
            {mark.glyph ?? <ForwardIcon />}
          </span>
        )}
      </div>
      <div className="symbol-name">{label}</div>
      <div className="symbol-file">{file}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
