import { describe, expect, it } from 'vitest';
import { arrivalScene, combLattice, combRadius } from '../src/ui/hive-art.js';
import { combPath, ETCH_INSET } from '../src/shell/hive-comb.js';

// V85 (decisions 701, 702, 706): the arrival's honeycomb kept as the app's background, on the
// shutter's own lattice, so the tiles it opens onto are the ones it drew.
describe("Hive's honeycomb (V85)", () => {
  const cases = [
    { width: 1440, height: 900, at: [720, 450] as const },
    { width: 1440, height: 900, at: [701.5, 388.25] as const },
    { width: 2560, height: 1440, at: [1100, 600] as const },
    { width: 420, height: 800, at: [210, 300] as const },
  ];

  it("lays out the arrival's shutter: the same centres and radius", () => {
    for (const { width, height, at } of cases) {
      const scene = arrivalScene({ width, height, at: [...at], scale: 1 });
      expect(combLattice(width, height, [...at])).toEqual(scene.tiles);
    }
  });

  it('sizes its tiles by the window, 16 px at least', () => {
    expect(combRadius(1440, 900)).toBeCloseTo(900 / 26, 9);
    expect(combRadius(300, 200)).toBe(16);
  });

  it('covers the whole window with tiles', () => {
    for (const { width, height, at } of cases) {
      const { centres, r } = combLattice(width, height, [...at]);
      for (let x = 0; x <= width; x += width / 37) {
        for (let y = 0; y <= height; y += height / 23) {
          const near = Math.min(...centres.map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
          expect(near).toBeLessThanOrEqual(r + 1e-9);
        }
      }
    }
  });

  it('keeps its centre and radius when the window grows: only tiles are added', () => {
    const at: [number, number] = [700, 420];
    const r = combRadius(1440, 900);
    const small = combLattice(1440, 900, at, r);
    const large = combLattice(2560, 1600, at, r);
    expect(large.r).toBe(r);
    for (const [x, y] of small.centres) {
      if (x < 0 || y < 0 || x > 1440 || y > 900) continue;
      expect(large.centres.some(([cx, cy]) => Math.hypot(cx - x, cy - y) < 1e-9)).toBe(true);
    }
  });

  it('draws one etched hexagon per tile, a point up, as the shutter etches them', () => {
    const { centres, r } = combLattice(1440, 900, [720, 450]);
    const d = combPath(centres, r);
    const shapes = d.match(/M[^Z]*Z/g) ?? [];
    expect(shapes).toHaveLength(centres.length);
    const first = shapes[0]!.match(/-?[\d.]+/g)!.map(Number);
    const [cx, cy] = centres[0]!;
    // Its top vertex straight above the centre, at the tile's radius less the etch's inset.
    expect(first[0]).toBeCloseTo(cx, 1);
    expect(first[1]).toBeCloseTo(cy - (r - ETCH_INSET), 1);
    expect(ETCH_INSET).toBe(1.5);
  });
});
