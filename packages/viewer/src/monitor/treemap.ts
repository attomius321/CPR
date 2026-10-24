import type { FileKind } from '@symbiote/monitor';
import type { CodeNode } from './codemap.js';

/** A frame's name band, in pixels. */
export const BAND = 24;
/** A frame's inner margin under its band, in pixels. */
export const PAD = 2;
/** The smallest tile drawn on its own, 24 × 16 px; smaller ones are one tile per folder (decision 327). */
export const MIN_AREA = 24 * 16;
/** A folder is drawn as a frame only with room for its band and some tiles. */
const MIN_FRAME_W = 96;
const MIN_FRAME_H = BAND + 48;
/**
 * Frames nest this deep at most: the folder in view's children are level 1. Two levels drew
 * Symbiote's own root as one frame of seven empty folders (`packages`, 96 % of the code).
 */
export const MAX_DEPTH = 6;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One rectangle of the picture, on whole pixels (RM1, decision 324). */
export interface Tile extends Rect {
  /** The node's path; `<folder>/…` for a folder's smaller files. */
  id: string;
  /** The node's path; a folder's for its smaller files. */
  path: string;
  name: string;
  lines: number;
  files: number;
  /**
   * `frame`: a folder with its own children inside, under a name band; `folder`: a folder drawn
   * whole (no room, or `MAX_DEPTH`; click to go in); `file`; `more`: a folder's smaller files.
   */
  type: 'frame' | 'folder' | 'file' | 'more';
  /** 1: a child of the folder in view; 2: inside one of its frames; and so on. */
  depth: number;
  /** The frame holding it, below level 1. */
  parent?: string;
  /** A file's kind: its colour. */
  kind?: FileKind;
  /** What fits: the name and the lines, the name, or nothing. */
  label: 'full' | 'name' | 'none';
}

/**
 * Squarified treemap (Bruls, Huizing and van Wijk, 2000): `values`, largest first, as rectangles
 * filling `area` in proportion, in rows along the shorter side, each row taken while it brings
 * its rectangles nearer to squares.
 */
export function squarify(values: readonly number[], area: Rect): Rect[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (values.length === 0 || total <= 0 || area.w <= 0 || area.h <= 0) return [];
  const scale = (area.w * area.h) / total;
  const areas = values.map((v) => v * scale);
  const rects: Rect[] = [];
  let free = { ...area };
  let row: number[] = [];
  let start = 0;
  const lay = () => {
    const sum = row.reduce((s, a) => s + a, 0);
    if (free.w >= free.h) {
      // A column at the left.
      const thickness = sum / free.h;
      let y = free.y;
      for (const a of row) {
        const h = a / thickness;
        rects.push({ x: free.x, y, w: thickness, h });
        y += h;
      }
      free = { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h };
    } else {
      // A row at the top.
      const thickness = sum / free.w;
      let x = free.x;
      for (const a of row) {
        const w = a / thickness;
        rects.push({ x, y: free.y, w, h: thickness });
        x += w;
      }
      free = { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
    }
    row = [];
  };
  while (start < areas.length) {
    const next = areas[start]!;
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worst([...row, next], side) <= worst(row, side)) {
      row.push(next);
      start++;
    } else {
      lay();
    }
  }
  if (row.length > 0) lay();
  return rects;
}

/** A row's worst aspect ratio, laid along a side of length `side`. */
function worst(row: readonly number[], side: number): number {
  const sum = row.reduce((s, a) => s + a, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  const side2 = side * side;
  const sum2 = sum * sum;
  return Math.max((side2 * max) / sum2, sum2 / (side2 * min));
}

/** On whole pixels: each edge rounded, so neighbours keep sharing theirs. */
function snap(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y };
}

/** An item to lay out: a node, or a folder's smaller files together. */
interface Item {
  node: CodeNode;
  more?: { path: string; lines: number; files: number };
}

/**
 * The children too small for `MIN_AREA` in `area`, two or more, as one item at the end: a
 * folder's "smaller files" tile.
 */
function withSmallerMerged(folder: CodeNode, area: Rect): Item[] {
  const children = folder.children ?? [];
  const perLine = (area.w * area.h) / Math.max(1, folder.lines);
  const small = children.filter((c) => c.lines * perLine < MIN_AREA);
  if (small.length < 2) return children.map((node) => ({ node }));
  const kept = children.filter((c) => c.lines * perLine >= MIN_AREA);
  return [
    ...kept.map((node) => ({ node })),
    {
      node: folder,
      more: {
        path: folder.path,
        lines: small.reduce((sum, c) => sum + c.lines, 0),
        files: small.reduce((sum, c) => sum + c.files, 0),
      },
    },
  ];
}

/**
 * What fits in a tile: a line is 16 px, the two 2 px apart, inside 4 px of padding and a 1 px
 * border — 44 px for the name and the lines, 26 for the name.
 */
function labelOf(r: Rect): Tile['label'] {
  if (r.w >= 56 && r.h >= 44) return 'full';
  if (r.w >= 32 && r.h >= 26) return 'name';
  return 'none';
}

function tileOf(item: Item, r: Rect, depth: number, parent?: string): Tile {
  const { node, more } = item;
  const base = { ...r, depth, label: labelOf(r), ...(parent ? { parent } : {}) };
  if (more) {
    return {
      ...base,
      id: more.path ? `${more.path}/…` : '…',
      path: more.path,
      name: `${more.files.toLocaleString('en-US')} smaller files`,
      lines: more.lines,
      files: more.files,
      type: 'more',
    };
  }
  return {
    ...base,
    id: node.path,
    path: node.path,
    name: node.name,
    lines: node.lines,
    files: node.files,
    type: node.children ? 'folder' : 'file',
    ...(node.file ? { kind: node.file.kind } : {}),
  };
}

/**
 * The picture of the folder in view (decision 324): its children fill the `width` × `height`
 * area by their lines; a folder with room is a frame whose own children fill it under its name
 * band, down to `MAX_DEPTH` levels, below which folders are drawn whole. Children too small to
 * draw are one tile per folder (decision 327). Frames come before their tiles. Pure and stable:
 * the same tree and size give the same tiles.
 */
export function layoutTreemap(folder: CodeNode, width: number, height: number): Tile[] {
  const area = { x: 0, y: 0, w: Math.floor(width), h: Math.floor(height) };
  if (folder.lines === 0 || area.w <= 0 || area.h <= 0) return [];
  const tiles: Tile[] = [];
  fill(folder, area, 1, undefined, tiles);
  return tiles;
}

/** Lays `folder`'s children out in `area` at `depth`, frames' contents after each frame. */
function fill(
  folder: CodeNode,
  area: Rect,
  depth: number,
  parent: string | undefined,
  tiles: Tile[],
): void {
  const items = withSmallerMerged(folder, area);
  const rects = squarify(
    items.map((item) => item.more?.lines ?? item.node.lines),
    area,
  ).map(snap);
  items.forEach((item, i) => {
    const r = rects[i]!;
    const tile = tileOf(item, r, depth, parent);
    const node = item.node;
    const room = r.w >= MIN_FRAME_W && r.h >= MIN_FRAME_H;
    if (item.more || !node.children || !room || depth >= MAX_DEPTH) {
      tiles.push(tile);
      return;
    }
    tiles.push({ ...tile, type: 'frame', label: r.w >= 40 ? 'name' : 'none' });
    const inner = { x: r.x + PAD, y: r.y + BAND, w: r.w - 2 * PAD, h: r.h - BAND - PAD };
    fill(node, inner, depth + 1, node.path, tiles);
  });
}
