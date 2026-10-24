import { describe, expect, it } from 'vitest';
import type { CodeFile, FileKind } from '@symbiote/monitor';
import { codeTree } from '../src/monitor/codemap.js';
import {
  BAND,
  layoutTreemap,
  MAX_DEPTH,
  MIN_AREA,
  PAD,
  squarify,
  type Tile,
} from '../src/monitor/treemap.js';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const file = (path: string, code: number): CodeFile => ({
  path,
  kind: 'source',
  language: 'TypeScript',
  lines: code,
  code,
  comments: 0,
  blank: 0,
});
const SOURCE = new Set<FileKind>(['source']);

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const within = (inner: Box, outer: Box, eps = 1e-9) =>
  inner.x >= outer.x - eps &&
  inner.y >= outer.y - eps &&
  inner.x + inner.w <= outer.x + outer.w + eps &&
  inner.y + inner.h <= outer.y + outer.h + eps;
const aspect = (r: Box) => Math.max(r.w / r.h, r.h / r.w);

describe('squarify', () => {
  // Bruls, Huizing and van Wijk's example: 6, 6, 4, 3, 2, 2, 1 in a 6 × 4 rectangle.
  const values = [6, 6, 4, 3, 2, 2, 1];
  const area = { x: 0, y: 0, w: 6, h: 4 };
  const rects = squarify(values, area);

  it('gives each value an area in proportion, inside the rectangle, without overlaps', () => {
    expect(rects).toHaveLength(values.length);
    rects.forEach((r, i) => expect(r.w * r.h).toBeCloseTo(values[i]!, 9));
    for (const r of rects) expect(within(r, area)).toBe(true);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
    }
  });

  it('keeps rectangles near squares, the largest first at the top left', () => {
    expect(Math.max(...rects.map(aspect))).toBeLessThan(3);
    expect(rects[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('gives one value the whole rectangle, and none nothing', () => {
    expect(squarify([5], area)).toEqual([area]);
    expect(squarify([], area)).toEqual([]);
  });
});

describe('layoutTreemap', () => {
  const W = 800;
  const H = 500;
  const tiny = Array.from({ length: 120 }, (_, i) => file(`app/small/s${i}.ts`, 1));
  // `app/small` holds only 1-line files: a frame of its own inside `app`'s, its files one tile.
  // The 1-line files of `app` itself are too small too.
  const loose = Array.from({ length: 30 }, (_, i) => file(`app/t${i}.ts`, 1));
  const tree = codeTree(
    [
      file('app/a.ts', 400),
      file('app/b.ts', 300),
      file('app/c.ts', 200),
      ...loose,
      ...tiny,
      file('lib/d.ts', 100),
      file('x.ts', 50),
    ],
    SOURCE,
  );
  const tiles = layoutTreemap(tree, W, H);
  const byId = new Map(tiles.map((t) => [t.id, t]));

  it("draws the folder's children, a folder with room as a frame with its own inside", () => {
    const top = tiles.filter((t) => t.depth === 1);
    expect(top.map((t) => [t.id, t.type])).toEqual([
      ['app', 'frame'],
      ['lib', 'frame'],
      ['x.ts', 'file'],
    ]);
    const inApp = tiles.filter((t) => t.parent === 'app');
    expect(inApp.map((t) => [t.id, t.type])).toEqual([
      ['app/a.ts', 'file'],
      ['app/b.ts', 'file'],
      ['app/c.ts', 'file'],
      ['app/small', 'frame'],
      ['app/…', 'more'],
    ]);
    expect(tiles.filter((t) => t.parent === 'app/small').map((t) => [t.id, t.files])).toEqual([
      ['app/small/…', 120],
    ]);
    expect(byId.get('app/small')!.depth).toBe(2);
    // Parents come first: a frame is drawn under its tiles.
    expect(tiles.findIndex((t) => t.id === 'app')).toBeLessThan(
      tiles.findIndex((t) => t.parent === 'app'),
    );
  });

  it('merges the files too small to draw into one tile per folder', () => {
    expect(byId.get('app/…')).toMatchObject({ type: 'more', path: 'app', files: 30, lines: 30 });
    for (const t of tiles)
      if (t.type !== 'more' && t.type !== 'frame') {
        expect(t.w * t.h, t.id).toBeGreaterThanOrEqual(MIN_AREA);
      }
  });

  it('keeps every tile inside its frame and the picture, on whole pixels, without overlaps', () => {
    for (const t of tiles) {
      expect(within(t, { x: 0, y: 0, w: W, h: H }), t.id).toBe(true);
      expect([t.x, t.y, t.w, t.h].every(Number.isInteger), t.id).toBe(true);
      const frame = t.parent ? byId.get(t.parent) : undefined;
      if (frame) {
        const inner = {
          x: frame.x + PAD,
          y: frame.y + BAND,
          w: frame.w - 2 * PAD,
          h: frame.h - BAND - PAD,
        };
        expect(within(t, inner), t.id).toBe(true);
      }
    }
    const siblings = new Map<string, Tile[]>();
    for (const t of tiles)
      siblings.set(t.parent ?? '', [...(siblings.get(t.parent ?? '') ?? []), t]);
    for (const group of siblings.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          expect(overlaps(group[i]!, group[j]!), `${group[i]!.id} ${group[j]!.id}`).toBe(false);
        }
      }
    }
  });

  it("sizes the folder's children by their lines", () => {
    const area = (id: string) => byId.get(id)!.w * byId.get(id)!.h;
    // app 1,050 lines, lib 100, x.ts 50: rounding to whole pixels moves an area by its perimeter.
    expect(area('app') / area('lib')).toBeCloseTo(10.5, 0);
    expect(area('lib') / area('x.ts')).toBeCloseTo(2, 0);
    expect(tiles.filter((t) => t.depth === 1).reduce((sum, t) => sum + t.w * t.h, 0)).toBe(W * H);
  });

  it(`nests frames ${MAX_DEPTH} levels deep at most: a folder there is drawn whole`, () => {
    // A folder and a file at each level, so that no chain is folded into one name.
    const levels = ['a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/b/c/d/e', 'a/b/c/d/e/f'];
    const deep = layoutTreemap(
      codeTree(
        levels.map((level) => file(`${level}/x.ts`, 100)),
        SOURCE,
      ),
      1600,
      1200,
    );
    expect(Math.max(...deep.map((t) => t.depth))).toBe(MAX_DEPTH);
    expect(deep.find((t) => t.id === levels[MAX_DEPTH - 1])).toMatchObject({
      type: 'folder',
      depth: MAX_DEPTH,
    });
    expect(deep.find((t) => t.id === levels[MAX_DEPTH - 2])?.type).toBe('frame');
  });

  it('labels only what fits: the name and lines, the name, or nothing', () => {
    expect(byId.get('app/a.ts')!.label).toBe('full');
    // Two lines need 44 px, one 26: a shorter tile would squeeze its name.
    for (const t of tiles) {
      if (t.label === 'full') expect(t.h, t.id).toBeGreaterThanOrEqual(44);
      if (t.label === 'name') expect(t.h, t.id).toBeGreaterThanOrEqual(26);
    }
    const small = layoutTreemap(codeTree([file('a.ts', 1000), file('b.ts', 3)], SOURCE), 400, 300);
    expect(small.find((t) => t.id === 'b.ts')?.label ?? 'merged').not.toBe('full');
  });

  it('draws the same picture for the same tree, and nothing for an empty one', () => {
    expect(layoutTreemap(tree, W, H)).toEqual(tiles);
    expect(layoutTreemap(codeTree([], SOURCE), W, H)).toEqual([]);
    expect(layoutTreemap(tree, 0, 0)).toEqual([]);
  });
});
