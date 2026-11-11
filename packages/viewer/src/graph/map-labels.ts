// The map's labels, placed so that none hides another (V96, decisions 938–939). A project's name
// sits on its frame's top edge, inside its frame's width; a file's name it still covers is drawn
// faint once the zoom rests; a finding's count is drawn by its frame, above the name. Pure: run on
// a layout once it is made, in its worker (`layoutOf` in layouts.ts), from the boxes in graph
// coordinates and the sizes map.css draws, never from the page.
import type { FileFlowNode, FlowLayout, FlowNode, MapCount, ProjectFlowNode } from './flow.js';
import { MAP_ZOOM } from './mapzoom.js';

/**
 * A project's name on the map as map.css draws it, in px at scale 1 (`test/map-labels.test.ts`
 * reads them there): twice the graph's body on a changed frame, never under half that; the body on
 * a frame of context only, as small as its frame needs. Its box is its measured width
 * (`nameWidth`) and its padding.
 */
export const PROJECT_NAME = {
  changed: { font: 28, floor: 0.5 },
  context: { font: 14, floor: 0 },
  line: 1.25,
  pad: { x: 8, y: 3 },
} as const;

/** A file's name on the map as map.css draws it: Geist Mono, at most 0.6 em a character. */
export const FILE_NAME = {
  changed: { font: 14 },
  context: { font: 12 },
  line: 1.25,
  pad: { x: 6, y: 2 },
  em: 0.6,
} as const;

/**
 * Geist's advances in px for ' ' to '~': at 28 px and weight 600 (a changed frame's name), at
 * 14 px (a context frame's). Each the larger of Chromium's whole pixels on Linux and the exact
 * advance, rounded up (V96 journal): never narrower than drawn, 1–5 % wider at 28 px, 3–9 % at 14.
 */
const GEIST_28 = [
  7, 7, 11, 16, 19, 23, 20, 6, 9, 9, 12, 16, 7, 12, 7, 12, 20, 11, 18, 18, 18, 19, 18, 16, 18, 18,
  9, 9, 16, 16, 16, 17, 27, 20, 20, 21, 21, 18, 17, 21, 20, 8, 17, 19, 16, 25, 21, 22, 18, 22, 20,
  19, 17, 20, 20, 28, 19, 18, 17, 11, 11, 11, 13, 16, 8, 17, 18, 16, 18, 17, 11, 18, 17, 8, 9, 17,
  9, 25, 17, 17, 18, 18, 11, 16, 11, 17, 17, 24, 17, 16, 16, 12, 8, 12, 15,
];
const GEIST_14 = [
  4, 4, 6, 8, 10, 12, 10, 3, 5, 5, 6, 8, 4, 6, 4, 6, 10, 6, 9, 9, 9, 10, 9, 8, 9, 9, 5, 5, 8, 8, 8,
  9, 14, 10, 10, 11, 11, 9, 9, 11, 10, 4, 9, 10, 8, 13, 11, 11, 9, 11, 10, 10, 9, 10, 10, 14, 10, 9,
  9, 6, 6, 6, 7, 8, 4, 9, 9, 8, 9, 9, 6, 9, 9, 4, 5, 9, 5, 13, 9, 9, 9, 9, 6, 8, 6, 9, 9, 12, 9, 8,
  8, 6, 4, 6, 8,
];

/** The frame's border: its band, and so its name, start inside it. */
const BORDER = 1;
/** On screen, around a name: a file name this near is drawn faint too. */
const MARGIN_PX = 2;
/** The canvas's least zoom (`minZoom` in diff/Canvas.tsx): no name grows past its size there. */
const LEAST_ZOOM = 0.05;
/** How closely the zoom where a name starts covering a file is found. */
const PRECISION = 0.0005;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A project's name's width in px as map.css draws it (`--name-width`): at a changed frame's 28 px,
 * or a context frame's 14. A character past '~' counts an em, wider than any of Geist's above.
 */
export function nameWidth(name: string, context: boolean): number {
  const [widths, em] = context ? [GEIST_14, 14] : [GEIST_28, 28];
  let width = 0;
  for (const char of name) width += widths[(char.codePointAt(0) ?? 0) - 32] ?? em;
  return width;
}

/**
 * Where a frame's name is drawn at `zoom`, in graph coordinates: its size on screen while the frame
 * holds it, smaller to fit the frame's width (never under the floor), cut at that width, centred
 * on the frame's top edge. `wide` is its box at scale 1, measured once (`boxWidth`).
 */
export function nameBox(frame: ProjectFlowNode, zoom: number, wide = boxWidth(frame)): Rect {
  const kind = frame.data.changed === 0 ? PROJECT_NAME.context : PROJECT_NAME.changed;
  const scale = Math.max(kind.floor / zoom, Math.min(frame.width / wide, 1 / zoom));
  const height = (kind.font * PROJECT_NAME.line + 2 * PROJECT_NAME.pad.y) * scale;
  return {
    x: frame.position.x + BORDER,
    y: frame.position.y + BORDER - height / 2,
    width: Math.min(wide * scale, frame.width),
    height,
  };
}

/** A frame's name's box at scale 1: its width and padding (map.css's `width`). */
function boxWidth(frame: ProjectFlowNode): number {
  return nameWidth(frame.data.name, frame.data.changed === 0) + 2 * PROJECT_NAME.pad.x;
}

/** `src/app/foo.component.ts` → `foo.component.ts`; packages and dynamic calls as they are. */
export function shortName(label: string): string {
  return label.startsWith('package ') || !label.includes('/')
    ? label
    : label.slice(label.lastIndexOf('/') + 1);
}

/**
 * Where a file's name is drawn at `zoom` from its box's corner `at` (graph coordinates): its size on
 * screen, cut at its box's width.
 */
export function fileNameBox(file: FileFlowNode, at: { x: number; y: number }, zoom: number): Rect {
  const kind = file.data.changed ? FILE_NAME.changed : FILE_NAME.context;
  const text = [...shortName(file.data.label)].length * FILE_NAME.em * kind.font;
  return {
    x: at.x,
    y: at.y,
    width: Math.min((text + 2 * FILE_NAME.pad.x) / zoom, file.width),
    height: (kind.font * FILE_NAME.line + 2 * FILE_NAME.pad.y) / zoom,
  };
}

/** The file boxes whose name a project's name is drawn over at `zoom` (none off the map). */
export function coveredLabels(nodes: readonly FlowNode[], zoom: number): Set<string> {
  const covered = new Set<string>();
  if (zoom >= MAP_ZOOM) return covered;
  const frames = framesOf(nodes);
  for (const node of nodes) {
    if (node.type === 'file' && coversAt(node, frames, zoom)) covered.add(node.id);
  }
  return covered;
}

/**
 * The layout with each file the zoom below which a project's name covers its name (`cover`, which
 * map.css compares with the zoom at rest to draw it faint), and each frame its files' findings
 * counts (`counts`, drawn above its name). Positions and sizes are the layout's: this places
 * nothing. A layout without frames is returned as it is.
 */
export function mapLabels(layout: FlowLayout): FlowLayout {
  const frames = framesOf(layout.nodes);
  if (frames.size === 0) return layout;
  const counts = new Map<string, MapCount[]>();
  const nodes = layout.nodes.map((node): FlowNode => {
    if (node.type !== 'file') return node;
    const cover = coverOf(node, frames);
    const frame = node.parentId ? frames.get(node.parentId)?.frame : undefined;
    const moved = frame ? node.data.counts : undefined;
    if (frame && moved) {
      const shifted = moved.map((c) => ({
        ...c,
        x: c.x + node.position.x,
        y: c.y + node.position.y,
      }));
      counts.set(frame.id, [...(counts.get(frame.id) ?? []), ...shifted]);
    }
    if (cover === undefined && !moved) return node;
    const data = { ...node.data, ...(cover === undefined ? {} : { cover }) };
    if (moved) delete data.counts;
    return { ...node, data };
  });
  return {
    ...layout,
    nodes: nodes.map((node) => {
      const theirs = node.type === 'project' ? counts.get(node.id) : undefined;
      return node.type === 'project' && theirs
        ? { ...node, data: { ...node.data, counts: theirs } }
        : node;
    }),
  };
}

/** The frames by id, each with its name's box measured once. */
type Frames = ReadonlyMap<string, { frame: ProjectFlowNode; wide: number }>;

function framesOf(nodes: readonly FlowNode[]): Frames {
  return new Map(
    nodes.flatMap((n): [string, { frame: ProjectFlowNode; wide: number }][] =>
      n.type === 'project' ? [[n.id, { frame: n, wide: boxWidth(n) }]] : [],
    ),
  );
}

/** Whether a frame's name meets the file's name at `zoom`, or comes within `MARGIN_PX` of it. */
function coversAt(file: FileFlowNode, frames: Frames, zoom: number): boolean {
  const parent = file.parentId ? frames.get(file.parentId)?.frame : undefined;
  const at = parent
    ? { x: parent.position.x + file.position.x, y: parent.position.y + file.position.y }
    : file.position;
  const name = fileNameBox(file, at, zoom);
  const margin = MARGIN_PX / zoom;
  for (const { frame, wide } of frames.values()) {
    const box = nameBox(frame, zoom, wide);
    if (
      box.x - margin < name.x + name.width &&
      name.x < box.x + box.width + margin &&
      box.y - margin < name.y + name.height &&
      name.y < box.y + box.height + margin
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The zoom below which a project's name covers the file's name, or none on the whole map. Names
 * only grow as the zoom goes down, so it is found by halving: covered under it, not above.
 */
function coverOf(file: FileFlowNode, frames: Frames): number | undefined {
  if (!coversAt(file, frames, LEAST_ZOOM)) return undefined;
  if (coversAt(file, frames, MAP_ZOOM)) return MAP_ZOOM;
  let low = LEAST_ZOOM;
  let high = MAP_ZOOM;
  while (high - low > PRECISION) {
    const middle = (low + high) / 2;
    if (coversAt(file, frames, middle)) low = middle;
    else high = middle;
  }
  return Math.ceil(high * 10_000) / 10_000;
}
