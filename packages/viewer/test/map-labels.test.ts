import { readFileSync } from 'node:fs';
import type { Graph } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  layoutFlow,
  type FileFlowNode,
  type FlowLayout,
  type FlowNode,
  type ProjectFlowNode,
} from '../src/graph/flow.js';
import { workerLayouts } from '../src/graph/layouts.js';
import {
  FILE_NAME,
  PROJECT_NAME,
  coveredLabels,
  fileNameBox,
  mapLabels,
  nameBox,
  nameWidth,
  shortName,
} from '../src/graph/map-labels.js';
import { MAP_ZOOM } from '../src/graph/mapzoom.js';

const golden = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../core/test/__snapshots__/graph-${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as Graph;

const frame = (
  id: string,
  at: { x: number; y: number; width: number; height: number },
  name: string,
  changed = 1,
): ProjectFlowNode => ({
  id,
  type: 'project',
  position: { x: at.x, y: at.y },
  width: at.width,
  height: at.height,
  selectable: false,
  data: { name, folder: id.replace('project:', ''), changed },
});

const file = (
  id: string,
  at: { x: number; y: number; width: number; height: number },
  parentId?: string,
  data: Partial<FileFlowNode['data']> = {},
): FileFlowNode => ({
  id,
  type: 'file',
  position: { x: at.x, y: at.y },
  width: at.width,
  height: at.height,
  selectable: false,
  ...(parentId ? { parentId, extent: 'parent' as const } : {}),
  data: { label: id.replace('group:file:', ''), changed: true, ...data },
});

const layoutWith = (nodes: FlowNode[]): FlowLayout => ({
  nodes,
  edges: [],
  fileEdges: [],
  hiddenEdges: [],
  hidden: new Map(),
  members: new Map(),
});

// Bitwarden's "desktop": a wide frame, a file in its first row (46 graph px under the frame's
// top, as `FRAME_PAD` leaves) and one in a row below; a file far right of the name, in the first
// row; and "storybook", a context frame narrower than its name.
const desktop = frame(
  'project:apps/desktop',
  { x: 20, y: 20, width: 2400, height: 700 },
  'desktop',
);
const first = file(
  'group:file:apps/desktop/src/vault-list.component.ts',
  { x: 20, y: 46, width: 300, height: 100 },
  desktop.id,
);
const below = file(
  'group:file:apps/desktop/src/vault.component.ts',
  { x: 20, y: 540, width: 300, height: 100 },
  desktop.id,
);
const right = file(
  'group:file:apps/desktop/src/vault-cipher.ts',
  { x: 1700, y: 46, width: 300, height: 100 },
  desktop.id,
);
const storybook = frame(
  'project:apps/storybook',
  { x: 2500, y: 20, width: 260, height: 200 },
  'storybook',
  0,
);
const story = file(
  'group:file:.storybook/config.ts',
  { x: 16, y: 34, width: 200, height: 100 },
  storybook.id,
  { changed: false },
);
const nodes: FlowNode[] = [desktop, storybook, first, below, right, story];

describe("a project's name on the map (V96, decision 938)", () => {
  it("measures a name in Geist's widths: never narrower than Chromium draws it", () => {
    // Chromium's widths in px on Linux (whole pixels a glyph), at 28 px weight 600 and at 14 px
    // weight 500 (V96 journal).
    const drawn: Record<string, [number, number]> = {
      web: [57, 29],
      desktop: [112, 56],
      '@bitwarden/common': [292, 143],
      storybook: [138, 70],
      '@bitwarden/components': [344, 169],
      '@acme/admin': [195, 96],
      'qwik-monorepo': [213, 105],
      '@bitwarden/key-management': [413, 204],
    };
    for (const [name, [big, small]] of Object.entries(drawn)) {
      expect(nameWidth(name, false), name).toBeGreaterThanOrEqual(big);
      expect(nameWidth(name, false), name).toBeLessThanOrEqual(big * 1.05);
      expect(nameWidth(name, true), name).toBeGreaterThanOrEqual(small);
      expect(nameWidth(name, true), name).toBeLessThanOrEqual(small * 1.09);
    }
    // Past Geist's table: an em a character.
    expect(nameWidth('日本', false)).toBe(56);
  });

  it("sits on its frame's top edge, half outside, at its size while the frame holds it", () => {
    const at = nameBox(desktop, 0.2);
    // 28 px on screen: scaled by 1 / zoom; its box 41 px high, centred on the frame's edge.
    const height = (PROJECT_NAME.changed.font * PROJECT_NAME.line + 2 * PROJECT_NAME.pad.y) / 0.2;
    expect(at.height).toBeCloseTo(height, 6);
    expect(at.y + at.height / 2).toBeCloseTo(desktop.position.y + 1, 6);
    expect(at.x).toBe(desktop.position.x + 1);
    expect(at.width).toBeLessThan(desktop.width);
  });

  it("never runs out of its frame: a context frame's name shrinks to it, with no floor", () => {
    for (const zoom of [0.3, 0.2, 0.12, 0.06]) {
      const at = nameBox(storybook, zoom);
      expect(at.x + at.width, `${zoom}`).toBeLessThanOrEqual(
        storybook.position.x + storybook.width + 1,
      );
    }
    // Smaller than a changed frame's floor (half its size) would allow: no floor.
    const at = nameBox(storybook, 0.12);
    expect(at.height * 0.12).toBeLessThan(
      (PROJECT_NAME.context.font * PROJECT_NAME.line + 2 * PROJECT_NAME.pad.y) * 0.5,
    );
  });

  it("a changed frame's name keeps its floor, half its size, and is cut at the frame's width", () => {
    const narrow = frame(
      'project:libs/common',
      { x: 0, y: 0, width: 400, height: 300 },
      '@bitwarden/common',
    );
    const at = nameBox(narrow, 0.12);
    expect(at.width).toBe(400);
    // The floor: 14 px on screen, half of 28.
    const half = (PROJECT_NAME.changed.font * PROJECT_NAME.line + 2 * PROJECT_NAME.pad.y) / 2;
    expect(at.height * 0.12).toBeCloseTo(half, 6);
  });
});

describe('file names under a project name (V96, decision 939)', () => {
  it("covers the first row's file under the name, not the row below, at 0.2", () => {
    expect([...coveredLabels(nodes, 0.2)].sort()).toEqual([first.id, story.id].sort());
  });

  it('covers nothing off the map, where frames keep 46 px over their files', () => {
    expect(coveredLabels(nodes, MAP_ZOOM).size).toBe(0);
    expect(coveredLabels(nodes, 0.8).size).toBe(0);
  });

  it('covers a file right of the name only once the name has grown to it', () => {
    expect(coveredLabels(nodes, 0.2).has(right.id)).toBe(false);
    expect(coveredLabels(nodes, 0.06).has(right.id)).toBe(true);
  });

  it("measures a file's name as map.css draws it: mono, cut at its box", () => {
    expect(shortName(first.data.label)).toBe('vault-list.component.ts');
    expect(shortName('package @angular/core')).toBe('package @angular/core');
    const at = fileNameBox(first, { x: 40, y: 66 }, 0.3);
    const font = FILE_NAME.changed.font;
    expect(at).toEqual({
      x: 40,
      y: 66,
      // 23 characters at 0.6 em: wider than its 300 px box at 0.3, so cut there.
      width: Math.min((23 * 0.6 * font + 2 * FILE_NAME.pad.x) / 0.3, 300),
      height: (font * FILE_NAME.line + 2 * FILE_NAME.pad.y) / 0.3,
    });
    expect(at.width).toBe(300);
  });

  it('gives each covered file the zoom below which a name covers it, so the map dims it at rest', () => {
    const labelled = mapLabels(layoutWith(nodes));
    const cover = new Map(
      labelled.nodes.flatMap((n) =>
        n.type === 'file' && n.data.cover ? [[n.id, n.data.cover]] : [],
      ),
    );
    // The first row is covered at every map zoom; the row below at none.
    expect(cover.get(first.id)).toBe(MAP_ZOOM);
    expect(cover.has(below.id)).toBe(false);
    expect(cover.get(right.id)).toBeGreaterThan(0.06);
    expect(cover.get(right.id)).toBeLessThan(0.2);
    // The same answer as at each zoom: covered below its zoom, not at or above it.
    for (let zoom = 0.05; zoom < MAP_ZOOM; zoom += 0.01) {
      const covered = coveredLabels(nodes, zoom);
      for (const [id, at] of cover) {
        if (zoom < at - 0.001) expect(covered.has(id), `${id} at ${zoom}`).toBe(true);
        if (zoom > at) expect(covered.has(id), `${id} at ${zoom}`).toBe(false);
      }
    }
    // Positions and sizes as laid out: decoration, not layout.
    expect(labelled.nodes.map((n) => [n.id, n.position, n.width, n.height])).toEqual(
      nodes.map((n) => [n.id, n.position, n.width, n.height]),
    );
  });

  it('leaves a layout without frames as it is', () => {
    const layout = layoutFlow(golden('callers'));
    expect(mapLabels(layout)).toBe(layout);
  });

  it('agrees with every zoom on a real layout: the monorepo fixture', () => {
    const layout = layoutFlow(golden('projects'));
    const labelled = mapLabels(layout);
    const cover = new Map(
      labelled.nodes.flatMap((n) =>
        n.type === 'file' && n.data.cover ? [[n.id, n.data.cover]] : [],
      ),
    );
    expect(cover.size).toBeGreaterThan(0);
    for (const zoom of [0.4, 0.3, 0.2, 0.12, 0.06]) {
      const dimmed = [...cover].filter(([, at]) => zoom < at).map(([id]) => id);
      expect(dimmed.sort(), `${zoom}`).toEqual([...coveredLabels(layout.nodes, zoom)].sort());
    }
  });
});

describe('findings counts on the map (V96, keeping V100)', () => {
  it("are drawn by a file's frame, above its name, where they were", () => {
    const counted = file(
      'group:file:apps/desktop/src/vault-list.component.ts',
      { x: 20, y: 46, width: 300, height: 100 },
      desktop.id,
      {
        counts: [{ symbol: 'a#b', x: 200, y: 30, count: 2, severity: 'warning' }],
      },
    );
    const alone = file(
      'group:file:package x',
      { x: 3000, y: 20, width: 200, height: 100 },
      undefined,
      {
        counts: [{ symbol: 'c#d', x: 100, y: 30, count: 1, severity: 'error' }],
      },
    );
    const labelled = mapLabels(layoutWith([desktop, counted, alone]));
    const byId = new Map(labelled.nodes.map((n) => [n.id, n]));
    const project = byId.get(desktop.id) as ProjectFlowNode;
    expect(project.data.counts).toEqual([
      { symbol: 'a#b', x: 220, y: 76, count: 2, severity: 'warning' },
    ]);
    expect((byId.get(counted.id) as FileFlowNode).data.counts).toBeUndefined();
    // A box in no frame draws its own, as before.
    expect((byId.get(alone.id) as FileFlowNode).data.counts).toEqual(alone.data.counts);
  });
});

describe('layouts as drawn (V96)', () => {
  it("place the map's labels after the layout, in the worker and on the main thread", async () => {
    const graph = golden('projects');
    const here = await workerLayouts(graph, null).layout({});
    expect(here).toEqual(mapLabels(layoutFlow(graph, {})));
  });
});

/** A rule's declarations in a stylesheet, by its selector as written. */
function declared(path: string, selector: string, property: string): string | undefined {
  const css = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return undefined;
  const block = css.slice(at, css.indexOf('}', at));
  return new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
}

describe('the sizes the model reads are the ones map.css draws', () => {
  it("a project's name: twice the graph's body, its line and padding, its fit", () => {
    const body = Number(declared('ui/base.css', '.react-flow', '--size-body')?.replace('px', ''));
    expect(declared('graph/map.css', '.react-flow.map .project-name', 'font-size')).toBe(
      'calc(2 * var(--size-body))',
    );
    expect(PROJECT_NAME.changed.font).toBe(2 * body);
    expect(
      declared(
        'graph/map.css',
        '.react-flow.map .project-frame.context .project-name',
        'font-size',
      ),
    ).toBe('var(--size-body)');
    expect(PROJECT_NAME.context.font).toBe(body);
    expect(declared('graph/map.css', '.react-flow.map .project-name', 'line-height')).toBe(
      String(PROJECT_NAME.line),
    );
    expect(declared('graph/map.css', '.react-flow.map .project-name', 'padding')).toBe(
      `${PROJECT_NAME.pad.y}px ${PROJECT_NAME.pad.x}px`,
    );
    // Its box: its measured width and padding; the fit, the frame's width over it.
    const pad = 2 * PROJECT_NAME.pad.x;
    expect(declared('graph/map.css', '.react-flow.map .project-name', 'width')).toBe(
      `calc(var(--name-width) * 1px + ${pad}px)`,
    );
    expect(declared('graph/map.css', '.react-flow.map .project-name', '--fit')).toBe(
      `calc(var(--frame-width) / (var(--name-width) + ${pad}))`,
    );
    expect(declared('graph/map.css', '.react-flow.map .project-name', '--floor')).toBe(
      String(PROJECT_NAME.changed.floor),
    );
    expect(
      declared('graph/map.css', '.react-flow.map .project-frame.context .project-name', '--floor'),
    ).toBe(String(PROJECT_NAME.context.floor));
  });

  it("a file's name: the graph's body (a context file's caption) in mono, its line and padding", () => {
    const size = (token: string) =>
      Number(declared('ui/base.css', '.react-flow', token)?.replace('px', ''));
    expect(FILE_NAME.changed.font).toBe(size('--size-body'));
    expect(FILE_NAME.context.font).toBe(size('--size-caption'));
    expect(declared('graph/map.css', '.react-flow.map .file-name', 'font')).toBe(
      `var(--size-body) / ${FILE_NAME.line} var(--mono)`,
    );
    expect(declared('graph/map.css', '.react-flow.map .file-name', 'padding')).toBe(
      `${FILE_NAME.pad.y}px ${FILE_NAME.pad.x}px`,
    );
    expect(
      declared('graph/map.css', '.react-flow.map .file-box:not(.changed) .file-name', 'font-size'),
    ).toBe('var(--size-caption)');
  });
});
