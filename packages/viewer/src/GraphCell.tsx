import { memo } from 'react';
import type { LaneRow } from './lanes.js';

/** Every row of the commits page is this tall, so rows can be placed by number. */
export const ROW_HEIGHT = 32;

/** `lane-0` is the current branch's accent; others cycle through six colors. */
const laneClass = (lane: number) => `lane-${lane === 0 ? 0 : ((lane - 1) % 6) + 1}`;

/** A cubic from one point down to another, vertical at both ends. */
const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const y = (y1 + y2) / 2;
  return `M${x1} ${y1}C${x1} ${y} ${x2} ${y} ${x2} ${y2}`;
};

/**
 * One row's slice of the commit graph: lines passing by, lines from its children into its dot
 * and from its dot to its parents, and arrows for lines too long to draw (a click goes to the
 * other end). Each row draws itself alone: lanes never move sideways between rows.
 */
export const GraphCell = memo(function GraphCell({
  row,
  index,
  spacing,
  width,
  merge,
  picked,
  onJump,
}: {
  row: LaneRow;
  /** The row's number, to say how far an arrow goes. */
  index: number;
  spacing: number;
  width: number;
  merge: boolean;
  picked: boolean;
  onJump: (row: number) => void;
}) {
  const h = ROW_HEIGHT;
  const mid = h / 2;
  const x = (lane: number) => spacing / 2 + lane * spacing;
  const cx = x(row.lane);
  // Arrows lean towards the next lane, clear of any line in the dot's own.
  const ax = cx + Math.min(spacing * 0.6, 7);
  const lane = laneClass(row.lane);
  return (
    <svg className="graph" width={width} height={h} aria-hidden="true">
      {row.through.map((l) => (
        <path key={`t${l}`} className={laneClass(l)} d={`M${x(l)} 0V${h}`} />
      ))}
      {row.from.map((l) => (
        <path
          key={`f${l}`}
          className={laneClass(l)}
          d={l === row.lane ? `M${cx} 0V${mid}` : curve(x(l), 0, cx, mid)}
        />
      ))}
      {row.to.map((l, i) => (
        <path
          key={`o${i}`}
          className={laneClass(l)}
          d={l === row.lane ? `M${cx} ${mid}V${h}` : curve(cx, mid, x(l), h)}
        />
      ))}
      {row.down.map((target, i) => (
        <Arrow
          key={`d${i}`}
          className={lane}
          d={`M${cx} ${mid}L${ax} ${h - 2}M${ax - 3} ${h - 6}L${ax} ${h - 2}L${ax + 2} ${h - 7}`}
          title={
            target >= 0
              ? `Its parent is ${target - index} rows below: click to go there`
              : 'Its parent is below the commits listed'
          }
          onClick={target >= 0 ? () => onJump(target) : undefined}
        />
      ))}
      {row.up.map((child, i) => (
        <Arrow
          key={`u${i}`}
          className={lane}
          d={`M${cx} ${mid}L${ax} 2M${ax - 3} 6L${ax} 2L${ax + 2} 7`}
          title={`A child is ${index - child} rows above: click to go there`}
          onClick={() => onJump(child)}
        />
      ))}
      {picked && <circle className="pick-ring" cx={cx} cy={mid} r={7} />}
      <circle className={`commit-dot ${lane}${merge ? ' merge' : ''}`} cx={cx} cy={mid} r={4} />
    </svg>
  );
});

function Arrow({
  className,
  d,
  title,
  onClick,
}: {
  className: string;
  d: string;
  title: string;
  onClick: (() => void) | undefined;
}) {
  return (
    <g
      className={`arrow ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      <title>{title}</title>
      <path className="arrow-hit" d={d} />
      <path d={d} />
    </g>
  );
}
