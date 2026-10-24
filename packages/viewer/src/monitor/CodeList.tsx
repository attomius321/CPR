import type { KeyboardEvent } from 'react';
import {
  childRows,
  heatOf,
  largestFiles,
  percent,
  type CodeNode,
  type Colour,
  type ListRow,
} from './codemap.js';

export type ListTab = 'children' | 'files';

const count = (value: number) => value.toLocaleString('en-US');

/**
 * The folder's numbers, ranked (RM1, decision 324): its children ("In this folder") or every file
 * under it ("Largest files"), each with a bar, its lines and its share, and a line where half of
 * the code is reached. The treemap's exact counterpart, and its way in by keyboard.
 */
export function CodeList({
  node,
  colour,
  tab,
  onTab,
  hovered,
  selected,
  onHover,
  onPick,
}: {
  node: CodeNode;
  /** A file's bar takes its tile's colour (RM2). */
  colour: Colour;
  tab: ListTab;
  onTab: (tab: ListTab) => void;
  hovered: string | null;
  selected: string | null;
  onHover: (node: CodeNode | null) => void;
  onPick: (node: CodeNode) => void;
}) {
  const rows: ListRow[] = tab === 'children' ? childRows(node) : largestFiles(node);
  const widest = rows[0]?.share ?? 1;
  const fill = (row: CodeNode) => {
    if (!row.file) return 'kind-folder';
    const heat = colour === 'lines' ? heatOf(row.lines) : 0;
    return heat ? `kind-${row.file.kind} heat-${heat}` : `kind-${row.file.kind}`;
  };

  /** The arrows move between the rows; Enter or Space picks one (they are buttons). */
  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('.monitor-row')];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    const next = Math.max(
      0,
      Math.min(buttons.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)),
    );
    buttons[next]?.focus();
  };

  return (
    <section className="monitor-list" aria-label="Ranked">
      <div className="tabs" role="tablist" aria-label="What to rank">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'children'}
          onClick={() => onTab('children')}
        >
          In this folder
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'files'}
          onClick={() => onTab('files')}
        >
          Largest files
        </button>
      </div>
      <ol className="monitor-rows" onKeyDown={onKeyDown} onMouseLeave={() => onHover(null)}>
        {rows.map((row) => (
          <li key={row.node.path} className={row.half ? 'half' : undefined}>
            <button
              type="button"
              className={[
                'monitor-row',
                row.node.path === hovered ? 'hovered' : '',
                row.node.path === selected ? 'selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={() => onHover(row.node)}
              onFocus={() => onHover(row.node)}
              onClick={() => onPick(row.node)}
            >
              <span className="monitor-row-name">
                {tab === 'files' ? row.node.path : row.node.name}
                {row.node.children ? '/' : ''}
              </span>
              <span className="monitor-row-bar" aria-hidden="true">
                <span
                  className={fill(row.node)}
                  style={{ width: `${(row.share / widest) * 100}%` }}
                />
              </span>
              <span className="monitor-row-lines">{count(row.node.lines)}</span>
              <span className="monitor-row-share">{percent(row.share)}</span>
            </button>
            {row.half && (
              <p className="monitor-half" aria-label="Half of the code is above this line">
                half of the code
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
