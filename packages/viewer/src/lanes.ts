/** A row of the commit graph: where its dot is, and which lines cross the row. */
export interface LaneRow {
  /** The dot's lane. */
  lane: number;
  /** Lanes passing by, from the top of the row to its bottom. */
  through: number[];
  /** Lanes ending in the dot from above: its children's lines (two or more: they diverged here). */
  from: number[];
  /** One lane per parent, from the dot down (a merge has two or more). */
  to: number[];
  /** Lanes the row spans. */
  width: number;
  /** Parents too far below to draw a line to (an arrow down): their rows, or ids not listed. */
  down: number[];
  /** Children too far above to draw a line from (an arrow up): their rows. */
  up: number[];
}

/** Lines longer than this many rows are drawn as two arrows (as gitk does). */
export const LONG_LINE = 100;

/**
 * Lanes for a history in graph order (V10): `parents[row]` are row numbers, first parent first;
 * a parent not listed (yet) is any number outside the rows, the same one for the same commit.
 *
 * Lane 0 is HEAD's first-parent line, so the current branch is the straight line on the left. A
 * commit takes the leftmost lane coming down to it; a line to a parent another line already
 * goes to joins it; a new line takes the leftmost free lane. Lines never move sideways between
 * rows, so each row is drawn from its own data, and the first rows come out the same before and
 * after the rest of the history is listed.
 *
 * A line to a parent more than `longLine` rows below is cut: an arrow under the child, one over
 * the parent, and no lane between (V10: every branch of Bitwarden needs 142 lanes drawn whole,
 * 20 so). HEAD's line is never cut, and a line that can join a lane already going to its parent
 * joins it. A parent not listed yet counts as below the last row: its line is cut when more
 * than `longLine` rows follow, so rows that far above the last one never change.
 */
export function layoutLanes(
  parents: readonly (readonly number[])[],
  head: number | null,
  { longLine = LONG_LINE }: { longLine?: number } = {},
): LaneRow[] {
  const listed = (row: number | undefined): row is number =>
    row !== undefined && row >= 0 && row < parents.length;
  const line = new Set<number>();
  for (let row = head ?? undefined; listed(row) && !line.has(row); row = parents[row]?.[0]) {
    line.add(row);
  }
  // Lane 0 waits for HEAD's line, empty above it: nothing else takes it.
  const reserved = line.size > 0 ? 1 : 0;
  // What each lane's line goes down to; null for a free lane.
  const waiting: (number | null)[] = reserved ? [null] : [];
  const free = (): number => {
    const lane = waiting.indexOf(null, reserved);
    return lane < 0 ? waiting.push(null) - 1 : lane;
  };
  const tooLong = (row: number, parent: number) =>
    (listed(parent) ? parent : parents.length) - row > longLine;
  // Rows cut lines arrive at, with the children they come from.
  const arrivals = new Map<number, number[]>();

  return parents.map((rowParents, row): LaneRow => {
    const top = [...waiting];
    const from: number[] = [];
    const through: number[] = [];
    top.forEach((target, lane) => {
      if (target === row) from.push(lane);
      else if (target !== null) through.push(lane);
    });
    for (const lane of from) waiting[lane] = null;
    const lane = line.has(row) ? 0 : (from[0] ?? free());

    const to: number[] = [];
    const down: number[] = [];
    rowParents.forEach((parent, i) => {
      if (i === 0 && line.has(row)) {
        waiting[0] = parent;
        to.push(0);
        return;
      }
      const joined = waiting.indexOf(parent);
      if (joined >= 0) {
        to.push(joined);
      } else if (tooLong(row, parent)) {
        down.push(parent);
        if (listed(parent)) {
          const children = arrivals.get(parent);
          if (children) children.push(row);
          else arrivals.set(parent, [row]);
        }
      } else {
        const next = i === 0 && waiting[lane] === null ? lane : free();
        waiting[next] = parent;
        to.push(next);
      }
    });
    while (waiting.length > reserved && waiting[waiting.length - 1] === null) waiting.pop();
    const up = arrivals.get(row) ?? [];
    arrivals.delete(row);
    const width = Math.max(top.length, waiting.length, lane + 1);
    return { lane, through, from, to, width, down, up };
  });
}

/** Pixels between lanes: 14, narrowed to fit `lanes` in 240 px, never under 6. */
export function laneSpacing(lanes: number): number {
  return Math.max(6, Math.min(14, 240 / Math.max(lanes, 1)));
}
