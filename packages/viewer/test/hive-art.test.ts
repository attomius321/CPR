import { describe, expect, it } from 'vitest';
import {
  centreline,
  hexagon,
  highlight,
  JOINING,
  SIDENAV_TENDRILS,
  taper,
  type Tendril,
} from '../src/ui/hive-art.js';

/** A path's points, `M x y L x y … Z`. */
const points = (d: string) =>
  [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);

// Evenly spaced control points: the curve's parameter is its length.
const STRAIGHT: Tendril = {
  path: [
    [
      [0, 90],
      [0, 60],
      [0, 30],
      [0, 0],
    ],
  ],
  width: 20,
  tip: 2,
};

// V82 (decision 614): Hive's tendrils, our own drawing: a centreline thinned to a point.
describe("Hive's tendrils", () => {
  it('are closed shapes, as wide as asked at the root and thin at the tip', () => {
    const d = taper(STRAIGHT, 8);
    expect(d).toMatch(/^M.* Z$/);
    const all = points(d);
    // Both sides of 9 points along the line.
    expect(all).toHaveLength(18);
    const [rootLeft, rootRight] = [all[0]!, all.at(-1)!];
    expect(Math.abs(rootLeft[0] - rootRight[0])).toBeCloseTo(20, 1);
    const [tipLeft, tipRight] = [all[8]!, all[9]!];
    expect(Math.abs(tipLeft[0] - tipRight[0])).toBeCloseTo(2, 1);
    expect(tipLeft[1]).toBeCloseTo(0, 1);
  });

  it('thin as they go: no point wider than the one before', () => {
    const all = points(taper(STRAIGHT, 8));
    const widths = all.slice(0, 9).map((left, i) => Math.abs(left[0] - all[17 - i]![0]));
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
  });

  it('follow their centreline, given as joined cubics', () => {
    expect(centreline(STRAIGHT.path)).toBe('M0 90C0 60 0 30 0 0');
  });

  it('carry a highlight along a part of their length, beside the line', () => {
    const line = points(highlight(STRAIGHT, { side: 0.3, from: 0.1, to: 0.6 }, 10));
    expect(line.length).toBeGreaterThan(3);
    for (const [, y] of line) expect(y).toBeGreaterThanOrEqual(35.9);
    for (const [, y] of line) expect(y).toBeLessThanOrEqual(81.1);
    for (const [x] of line) expect(x).not.toBe(0);
  });

  it("draw the sidenav's and the dialog's from their own lines", () => {
    expect(SIDENAV_TENDRILS.length).toBeGreaterThan(2);
    expect(JOINING.tendrils.length).toBeGreaterThan(3);
    for (const tendril of [...SIDENAV_TENDRILS, ...JOINING.tendrils]) {
      expect(taper(tendril)).toMatch(/^M.* Z$/);
    }
  });

  it('close a hexagon of six corners round its centre', () => {
    const corners = points(hexagon(260, 64, 30));
    expect(corners).toHaveLength(6);
    for (const [x, y] of corners) expect(Math.hypot(x - 260, y - 64)).toBeCloseTo(30, 0);
  });
});
