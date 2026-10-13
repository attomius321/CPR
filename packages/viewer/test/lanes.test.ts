import { describe, expect, it } from 'vitest';
import { laneSpacing, layoutLanes, type LaneRow } from '../src/lanes.js';

const row = (
  lane: number,
  through: number[],
  from: number[],
  to: number[],
  width: number,
  arrows: Pick<LaneRow, 'down' | 'up'> = { down: [], up: [] },
) => ({ lane, through, from, to, width, ...arrows }) satisfies LaneRow;
/** A straight line of `n` rows from `start`, each the parent of the one above. */
const straight = (start: number, n: number) =>
  Array.from({ length: n }, (_, i) => (i === n - 1 ? [] : [start + i + 1]));

describe('layoutLanes', () => {
  it('draws one line in lane 0', () => {
    expect(layoutLanes([[1], [2], []], 0)).toEqual([
      row(0, [], [], [0], 1),
      row(0, [], [0], [0], 1),
      row(0, [], [0], [], 1),
    ]);
  });

  it('draws a merged branch beside the line it left and rejoined', () => {
    // A ← B ← M ← C (HEAD), F from B merged by M; in graph order C, M, F, B, A.
    expect(layoutLanes([[1], [3, 2], [3], [4], []], 0)).toEqual([
      row(0, [], [], [0], 1),
      row(0, [], [0], [0, 1], 2), // M: the merge opens a lane for F
      row(1, [0], [1], [0], 2), // F: its parent is B, where lane 0 goes next
      row(0, [], [0], [0], 1),
      row(0, [], [0], [], 1),
    ]);
  });

  it('keeps lane 0 for the current branch, however many tips are newer', () => {
    // X and HEAD both forked from B; X is listed first.
    expect(layoutLanes([[2], [2], []], 1)).toEqual([
      row(1, [], [], [1], 2),
      row(0, [1], [], [0], 2),
      row(0, [], [0, 1], [], 2), // B: two lines end in it, where they diverged
    ]);
  });

  it('opens a lane per parent of an octopus merge', () => {
    expect(layoutLanes([[1, 2, 3], [4], [4], [4], []], 0)).toEqual([
      row(0, [], [], [0, 1, 2], 3),
      row(0, [1, 2], [0], [0], 3),
      row(1, [0, 2], [1], [0], 3),
      row(2, [0], [2], [0], 3),
      row(0, [], [0], [], 1),
    ]);
  });

  it('frees a lane whose line ended, for the next tip', () => {
    // S1 forks from M2, S2 from M4; HEAD is row 1.
    const rows = layoutLanes([[2], [2], [4], [4], []], 1);
    expect(rows[0]?.lane).toBe(1);
    expect(rows[2]).toEqual(row(0, [], [0, 1], [0], 2));
    expect(rows[3]).toEqual(row(1, [0], [], [0], 2));
  });

  it('keeps lines to a parent not listed yet open, joined when it is the same', () => {
    // H ← A ← (not listed), and Z, another tip from that same commit.
    expect(layoutLanes([[1], [-7], [-7]], 0)).toEqual([
      row(0, [], [], [0], 1),
      row(0, [], [0], [0], 1),
      row(1, [0], [], [0], 2),
    ]);
  });

  it('uses lane 0 like any other without HEAD', () => {
    expect(layoutLanes([[1], []], null)).toEqual([row(0, [], [], [0], 1), row(0, [], [0], [], 1)]);
  });

  it('draws the first rows the same before and after the rest is listed', () => {
    const whole = [[1], [3, 2], [3], [4], []];
    // Before: rows 3 and 4 not listed, known by other numbers.
    const first = [[1], [-3, 2], [-3]];
    expect(layoutLanes(first, 0)).toEqual(layoutLanes(whole, 0).slice(0, 3));
  });

  it('draws a line longer than 100 rows as two arrows, with no lane between', () => {
    // A merge (row 0) whose second parent is 150 rows down HEAD's line, and a branch tip
    // (row 1) whose parent is 120 rows down.
    const parents = [[2, 150], [121], ...straight(2, 150)];
    const rows = layoutLanes(parents, 0);
    expect(rows[0]).toEqual(row(0, [], [], [0], 1, { down: [150], up: [] }));
    expect(rows[1]).toEqual(row(1, [0], [], [], 2, { down: [121], up: [] }));
    expect(rows[121]).toEqual(row(0, [], [0], [0], 1, { down: [], up: [1] }));
    expect(rows[150]).toEqual(row(0, [], [0], [0], 1, { down: [], up: [0] }));
    expect(Math.max(...rows.slice(2).map((r) => r.width))).toBe(1);
  });

  it('draws a line of 100 rows; not one of 101', () => {
    const at = (distance: number) =>
      layoutLanes([[1], [1 + distance], ...straight(2, distance)], 0);
    // Row 1 is HEAD's line: its own line is never cut, however long.
    expect(at(100)[1]?.down).toEqual([]);
    const side = (distance: number) =>
      layoutLanes([[2], [2 + distance], ...straight(2, distance + 1)], 0)[1];
    expect(side(99)?.down).toEqual([]);
    expect(side(100)?.down).toEqual([102]);
  });

  it('joins a lane already going to the parent rather than cut the line', () => {
    // HEAD's first parent is 150 rows down; a tip (row 1) forked from that same commit joins
    // HEAD's lane; rows 2 to 149 are another line into it.
    const rows = layoutLanes([[150], [150], ...straight(2, 149)], 0);
    expect(rows[1]).toEqual(row(1, [0], [], [0], 2));
    expect(rows[150]?.up).toEqual([]);
  });

  it('cuts a line to a parent not listed yet only when more than 100 rows follow', () => {
    // Before the rest is listed: tips at rows 0 and 199 point below the 200 rows listed.
    const rows = layoutLanes([[-1], ...straight(1, 198), [-2]], 1);
    expect(rows[0]?.down).toEqual([-1]);
    expect(rows[199]).toEqual(row(1, [], [], [1], 2));
  });
});

describe('laneSpacing', () => {
  it('keeps lanes 14 px apart, narrowed to fit 240 px, never under 6', () => {
    expect(laneSpacing(3)).toBe(14);
    expect(laneSpacing(20)).toBe(12);
    expect(laneSpacing(35)).toBeCloseTo(6.86, 2);
    expect(laneSpacing(53)).toBe(6);
    expect(laneSpacing(0)).toBe(14);
  });
});
