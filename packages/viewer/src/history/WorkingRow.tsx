// Git's uncommitted row (V66c), above the commits.
import type { WorkingChanges } from '@symbiote/core';
import { changesSummary } from './details.js';
import { ROW_HEIGHT } from './GraphCell.js';

/**
 * The checkout's uncommitted changes as a row above the commits (V66c): its dot hollow on HEAD's
 * lane (lane 0), joined to HEAD's when HEAD is the first commit listed.
 */
export function WorkingRow({
  changes,
  spacing,
  width,
  joined,
  cursor,
  onClick,
}: {
  changes: WorkingChanges;
  spacing: number;
  width: number;
  joined: boolean;
  cursor: boolean;
  onClick: () => void;
}) {
  const x = spacing / 2;
  const mid = ROW_HEIGHT / 2;
  return (
    <div
      className={`commit working${cursor ? ' cursor' : ''}`}
      style={{ height: ROW_HEIGHT }}
      role="button"
      tabIndex={-1}
      aria-label={`Uncommitted changes: ${changesSummary(changes)}`}
      onClick={onClick}
    >
      <svg className="graph" width={width} height={ROW_HEIGHT} aria-hidden="true">
        {joined && <path className="working-line" d={`M${x} ${mid + 4}V${ROW_HEIGHT}`} />}
        <circle className="working-dot" cx={x} cy={mid} r={4} />
      </svg>
      <span className="commit-subject">Uncommitted changes</span>
      <span className="working-summary">{changesSummary(changes)}</span>
    </div>
  );
}
