import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { findingCount, kindMark, type ChangeKind, type StylesheetData } from './flow.js';
import { CheckIcon, ForwardIcon } from '../ui/icons.js';
import { plural } from '../ui/plural.js';
import { tip } from '../ui/tip.js';

const TONES = { error: 'bad', warning: 'warn', info: 'info' } as const;
const KINDS: readonly ChangeKind[] = ['added', 'modified', 'removed', 'moved'];

/** "10 rules: 6 added, 3 modified, 1 removed", or "62 rules added" when they changed one way. */
export function stylesheetWords({ count, noun, kinds }: StylesheetData): string {
  const present = KINDS.filter((kind) => kinds[kind] > 0);
  const what = plural(count, noun);
  if (present.length === 1) return `${what} ${present[0] ?? ''}`;
  return `${what}: ${present.map((kind) => `${kinds[kind]} ${kind}`).join(', ')}`;
}

/**
 * A stylesheet's changed rules as one card (V105, decision 979): its file's name, how many changed
 * and how, one count of their findings; a click shows them in its box, or hides them again. A
 * neutral card as a symbol's (V90), on a second edge for the rules it holds.
 */
export function StylesheetNode({ data, selected }: NodeProps<Node<StylesheetData, 'stylesheet'>>) {
  const { name, count, noun, kinds, tone, findings, expanded, reviewed, settled } = data;
  const finding = expanded ? null : findingCount(findings);
  return (
    <div
      className={`stylesheet-node tone-${tone}${expanded ? ' expanded' : ''}${selected ? ' selected' : ''}${reviewed ? ' reviewed' : ''}${settled ? ' settled' : ''}`}
      {...tip(`${expanded ? 'Hide' : 'Show'} ${stylesheetWords(data)}, in ${data.file}`)}
    >
      <Handle type="target" position={Position.Left} />
      <div className="stylesheet-head">
        <span className="stylesheet-kind">stylesheet</span>
        {reviewed && (
          <span className="check" aria-label="Reviewed">
            <CheckIcon />
          </span>
        )}
        {finding && (
          <span
            className={`symbol-count count-${finding.severity}`}
            {...tip(finding.words, { tone: TONES[finding.severity] })}
          >
            {finding.count}
          </span>
        )}
      </div>
      <div className="stylesheet-name">{name}</div>
      <div className="stylesheet-counts">
        <span className="stylesheet-what">{plural(count, noun)}</span>
        {KINDS.filter((kind) => kinds[kind] > 0).map((kind) => (
          <span
            key={kind}
            className={`stylesheet-mark tone-${kind}`}
            role="img"
            aria-label={`${kinds[kind]} ${kind}`}
          >
            {kindMark(kind)?.glyph ?? <ForwardIcon />}
            {kinds[kind]}
          </span>
        ))}
        <span className="stylesheet-action">{expanded ? 'hide' : 'show'}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
