import dagre, { type Graph as DagreGraph } from '@dagrejs/dagre';
import type { Graph, GraphEdge, GraphNode, Project, ProjectKind, Severity } from '@symbiote/core';
import { pathInProject, projectOf } from './projects.js';

/** How a node is drawn: what changed, or what kind of neighbour it is. */
export type Tone = 'added' | 'removed' | 'modified' | 'moved' | 'context' | 'external' | 'unknown';

export interface SymbolData extends Record<string, unknown> {
  node: GraphNode;
  tone: Tone;
  label: string;
  file: string;
  /** `signature`, `body`, `moved` for modified symbols. */
  tags: string[];
  findings: Record<Severity, number>;
  reviewed: boolean;
  /** With `--since`: changed the same way as in the earlier version, and those are hidden. */
  settled: boolean;
}

export interface SymbolFlowNode {
  id: string;
  type: 'symbol';
  position: { x: number; y: number };
  data: SymbolData;
  width: number;
  height: number;
  /** The file (or package) group it sits in; its position is relative to that group. */
  parentId: string;
  extent: 'parent';
  selected?: boolean;
}

/** The unchanged neighbours of one changed symbol on one side, drawn as a single node. */
export interface SummaryData extends Record<string, unknown> {
  /** The changed symbol they use (`users`) or that uses them (`uses`). */
  of: string;
  side: 'users' | 'uses';
  /** How many neighbours, and in how many files or packages. */
  count: number;
  files: number;
  /** In how many projects, when more than one. */
  projects?: number;
  /** Shown: every neighbour is laid out too, and this node hides them again. */
  expanded: boolean;
}

export interface SummaryFlowNode {
  id: string;
  type: 'summary';
  position: { x: number; y: number };
  data: SummaryData;
  width: number;
  height: number;
  /** The box of the symbol it summarizes neighbours of. */
  parentId: string;
  extent: 'parent';
}

export interface FileData extends Record<string, unknown> {
  /** The file's path, `package <name>`, or `dynamic calls`. */
  label: string;
  /** In a project's frame: the path from the project's folder. */
  local?: string;
  changed: boolean;
}

/** A box around the symbols of one file, package, or the dynamic calls. */
export interface FileFlowNode {
  id: string;
  type: 'file';
  /** Relative to its project's frame, when it has one. */
  position: { x: number; y: number };
  data: FileData;
  width: number;
  height: number;
  selectable: false;
  parentId?: string;
  extent?: 'parent';
}

export interface ProjectData extends Record<string, unknown> {
  name: string;
  /** Repo-relative; `''` for the repository root. */
  folder: string;
  kind?: ProjectKind;
  /** Changed symbols drawn in it; none when only neighbours of a change come from it. */
  changed: number;
}

/** A frame around the files of one app or library, when what is drawn spans two or more. */
export interface ProjectFlowNode {
  id: string;
  type: 'project';
  position: { x: number; y: number };
  data: ProjectData;
  width: number;
  height: number;
  selectable: false;
}

export type FlowNode = ProjectFlowNode | FileFlowNode | SymbolFlowNode | SummaryFlowNode;

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  className: string;
  /**
   * The graph's edge; `null` for the edge between a summary and its symbol, and for a file
   * pair's edge, which has the `count` of symbol edges it stands for.
   */
  data: { edge: GraphEdge | null; count?: number };
}

/** What is drawn and where; reviewing (selection, marks) never changes it. */
export interface FlowLayout {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** For the map: one edge per pair of linked file boxes, in place of their symbols' edges. */
  fileEdges: FlowEdge[];
  /** Symbols drawn only as part of a collapsed summary: symbol → summary node. */
  hidden: Map<string, string>;
  /** Every summary's neighbours, shown or not: summary → symbols. */
  members: Map<string, string[]>;
}

export interface LayoutOptions {
  /** Show `type-reference` edges (hidden by default: they are numerous and rarely decisions). */
  typeReferences?: boolean;
  /** Show unchanged neighbours, packages and top-level code. */
  context?: boolean;
  /** Show only these symbols (e.g. a selection's neighbourhood). */
  focus?: ReadonlySet<string>;
  /** Summary nodes whose neighbours are shown. */
  expanded?: ReadonlySet<string>;
}

export interface DecorateOptions {
  /** Symbols the reviewer has marked as reviewed. */
  reviewed?: ReadonlySet<string>;
  /** With `--since`: dim symbols changed the same way as in the earlier version. */
  sinceOnly?: boolean;
  selected?: string | null;
}

export type FlowOptions = LayoutOptions & DecorateOptions;

export const NODE_HEIGHT = 58;
/** More unchanged neighbours than this on one side of a changed symbol become one summary. */
export const NEIGHBOUR_LIMIT = 8;
export const SUMMARY_WIDTH = 190;
/** Above this many edges drawn, a moving view draws only the selected symbol's (V8c). */
export const MOVING_EDGE_LIMIT = 400;
/** A summary that also says across how many projects. */
const SUMMARY_WIDE = 250;
const GROUP_PAD = { top: 30, side: 12, bottom: 12 };
/** Room for a project's name band above its files; a frame of neighbours only has a smaller one. */
const FRAME_PAD = { top: 46, side: 20, bottom: 20 };
const LIGHT_FRAME_PAD = { top: 34, side: 16, bottom: 16 };
/** Symbols with no edge inside their box are stacked in columns of at most this many. */
const WRAP_ROWS = 6;
/**
 * Edges inside one box past which it is laid out in columns, not by dagre: a stylesheet's rules
 * and the tokens they use took dagre 70 s to order (Symbiote 3fff617: 2,186 edges in
 * `styles.css`); TypeScript's densest boxes seen hold under 100.
 */
export const MAX_BOX_EDGES = 1000;
const WRAP_GAP = { x: 16, y: 12 };
/** Space between separate clusters of boxes, and the page shape they are packed into. */
const CLUSTER_GAP = 80;
const PAGE_ASPECT = 1.6;
const MARGIN = 20;

export function summaryId(side: SummaryData['side'], of: string): string {
  return `summary:${side}:${of}`;
}

/** Graph JSON → laid-out and decorated React Flow nodes and edges. Pure, so it is unit-tested. */
export function toFlow(graph: Graph, options: FlowOptions = {}): FlowLayout {
  const layout = layoutFlow(graph, options);
  return { ...layout, nodes: decorate(layout.nodes, options) };
}

/**
 * Which symbols are drawn and where. A changed symbol's unchanged neighbours are drawn when
 * there are few of them on that side; more than `NEIGHBOUR_LIMIT` become one summary node,
 * unless expanded. Symbols are boxed by file, boxes connected by calls form clusters, and the
 * clusters are packed into a page instead of one long column.
 */
export function layoutFlow(graph: Graph, options: LayoutOptions = {}): FlowLayout {
  const { typeReferences = false, context = true, focus, expanded = new Set<string>() } = options;
  const findings = countFindings(graph);

  const visible = graph.nodes.filter(
    (n) => (context || n.status !== 'unchanged') && (!focus || focus.has(n.id)),
  );
  const byId = new Map(visible.map((n) => [n.id, n]));
  const candidateEdges = graph.edges.filter(
    (e) => byId.has(e.from) && byId.has(e.to) && (typeReferences || e.kind !== 'type-reference'),
  );

  // Unchanged neighbours of each changed symbol, by side.
  const neighbours = new Map<string, Neighbours>();
  const addNeighbour = (of: string, side: SummaryData['side'], member: string) => {
    const id = summaryId(side, of);
    let group = neighbours.get(id);
    if (!group) neighbours.set(id, (group = { id, of, side, members: new Set() }));
    group.members.add(member);
  };
  for (const edge of candidateEdges) {
    const from = byId.get(edge.from) as GraphNode;
    const to = byId.get(edge.to) as GraphNode;
    if (to.status !== 'unchanged' && from.status === 'unchanged')
      addNeighbour(to.id, 'users', from.id);
    if (from.status !== 'unchanged' && to.status === 'unchanged')
      addNeighbour(from.id, 'uses', to.id);
  }

  // Few neighbours are drawn; many become a summary. A neighbour another side draws anyway,
  // or a user a finding names as still using something removed, is drawn too.
  const drawn = new Set<string>();
  const grouped = new Set<string>();
  const summaries: (Neighbours & { expanded: boolean })[] = [];
  for (const group of neighbours.values()) {
    for (const member of group.members) grouped.add(member);
    const big = group.members.size > NEIGHBOUR_LIMIT;
    const open = expanded.has(group.id);
    if (!big || open) for (const member of group.members) drawn.add(member);
    if (big) summaries.push({ ...group, expanded: open });
  }
  for (const finding of graph.findings) {
    if (finding.rule !== 'removed-still-referenced') continue;
    for (const id of finding.related) if (grouped.has(id)) drawn.add(id);
  }
  const hidden = new Map<string, string>();
  for (const summary of summaries) {
    if (summary.expanded) continue;
    for (const member of summary.members) {
      if (!drawn.has(member) && !hidden.has(member)) hidden.set(member, summary.id);
    }
  }

  // Unchanged symbols that are nobody's neighbour (deeper context) stay if an edge holds them.
  const kept = (n: GraphNode) => n.status !== 'unchanged' || drawn.has(n.id) || !grouped.has(n.id);
  const candidates = new Set(visible.filter(kept).map((n) => n.id));
  const edges = candidateEdges.filter((e) => candidates.has(e.from) && candidates.has(e.to));
  const connected = new Set(edges.flatMap((e) => [e.from, e.to]));
  const nodes = visible.filter(
    (n) => candidates.has(n.id) && (n.status !== 'unchanged' || connected.has(n.id)),
  );

  // How many projects a summary's neighbours come from, when more than one.
  const projects = graph.projects ?? [];
  const spans = new Map<string, number>();
  if (projects.length > 1) {
    for (const summary of summaries) {
      const held = new Set<Project>();
      for (const member of summary.members) {
        const { file } = groupOf(byId.get(member) as GraphNode);
        const project = file === undefined ? undefined : projectOf(file, projects);
        if (project) held.add(project);
      }
      if (held.size > 1) spans.set(summary.id, held.size);
    }
  }
  const summaryWidth = (id: string) => (spans.has(id) ? SUMMARY_WIDE : SUMMARY_WIDTH);

  // Boxes: a file or package each; a summary sits in its symbol's box.
  const boxOf = new Map<string, string>();
  const boxes = new Map<
    string,
    { label: string; file: string | undefined; changed: boolean; members: Member[] }
  >();
  const join = (member: Member, box: ReturnType<typeof groupOf>, changed: boolean) => {
    let entry = boxes.get(box.id);
    if (!entry) {
      boxes.set(
        box.id,
        (entry = { label: box.label, file: box.file, changed: false, members: [] }),
      );
    }
    entry.changed ||= changed;
    entry.members.push(member);
    boxOf.set(member.id, box.id);
  };
  for (const node of nodes) {
    join(
      { id: node.id, width: nodeWidth(node), changed: node.status !== 'unchanged' },
      groupOf(node),
      node.status !== 'unchanged',
    );
  }
  for (const summary of summaries) {
    const owner = byId.get(summary.of);
    if (!owner || !boxOf.has(summary.of)) continue;
    join(
      { id: summary.id, width: summaryWidth(summary.id), changed: false },
      groupOf(owner),
      false,
    );
  }

  const summaryEdges: FlowEdge[] = summaries
    .filter((s) => boxOf.has(s.id))
    .map((s) => ({
      id: `summary-edge:${s.id}`,
      source: s.side === 'users' ? s.id : s.of,
      target: s.side === 'users' ? s.of : s.id,
      className: 'edge-summary',
      data: { edge: null },
    }));
  const links = [
    ...edges.map((e) => ({ from: e.from, to: e.to })),
    ...summaryEdges.map((e) => ({ from: e.source, to: e.target })),
  ];

  // Inside each box: dagre for symbols linked inside it, columns for the rest.
  const inner = new Map<string, { x: number; y: number }>();
  const boxSizes = new Map<string, { width: number; height: number }>();
  for (const [id, box] of boxes) {
    const internal = links.filter((l) => boxOf.get(l.from) === id && boxOf.get(l.to) === id);
    const placed = layoutBox(box.members, internal);
    for (const [member, at] of placed.positions) {
      inner.set(member, { x: at.x + GROUP_PAD.side, y: at.y + GROUP_PAD.top });
    }
    boxSizes.set(id, {
      width: placed.width + 2 * GROUP_PAD.side,
      height: placed.height + GROUP_PAD.top + GROUP_PAD.bottom,
    });
  }

  const between = links
    .map((l) => ({ from: boxOf.get(l.from) ?? '', to: boxOf.get(l.to) ?? '' }))
    .filter((l) => l.from && l.to && l.from !== l.to);

  // Projects: when the files drawn belong to two or more, each is a frame around its files.
  const projectOfBox = new Map<string, Project>();
  for (const [id, box] of boxes) {
    const project = box.file === undefined ? undefined : projectOf(box.file, projects);
    if (project) projectOfBox.set(id, project);
  }
  const frameOf = new Map<string, string>();
  const frames = new Map<string, { project: Project; changed: number }>();
  if (new Set(projectOfBox.values()).size > 1) {
    for (const [box, project] of projectOfBox) {
      const id = `project:${project.folder}`;
      let frame = frames.get(id);
      if (!frame) frames.set(id, (frame = { project, changed: 0 }));
      frame.changed += boxes.get(box)?.members.filter((m) => m.changed).length ?? 0;
      frameOf.set(box, id);
    }
  }
  // A box in no project (a package, the dynamic calls) is drawn in the frame it has the most links
  // with, among its users as without frames: beside every frame, a package used by hundreds of
  // symbols drew long fans of edges (Qwik). It still belongs to no project.
  const placedIn = new Map(frameOf);
  if (frames.size > 0) {
    const weights = new Map<string, Map<string, number>>();
    for (const { from, to } of between) {
      for (const [box, other] of [
        [from, to],
        [to, from],
      ] as const) {
        const frame = frameOf.get(other);
        if (frameOf.has(box) || !frame) continue;
        const byFrame = weights.get(box) ?? new Map<string, number>();
        byFrame.set(frame, (byFrame.get(frame) ?? 0) + 1);
        weights.set(box, byFrame);
      }
    }
    for (const [box, byFrame] of weights) {
      let best: [string, number] | undefined;
      for (const entry of byFrame) if (!best || entry[1] > best[1]) best = entry;
      if (best) placedIn.set(box, best[0]);
    }
  }

  // Between boxes: clusters connected by edges, each laid out by dagre, packed into a page. With
  // frames, the boxes in a frame are packed so inside it; frames (and a box in none, linked to no
  // frame) are placed in rows in the order of the links between them.
  const boxPositions = new Map<string, { x: number; y: number }>();
  const frameRects = new Map<string, Rect>();
  if (frames.size === 0) {
    const packed = packClusters([...boxSizes], between, { x: MARGIN, y: MARGIN });
    for (const [id, at] of packed.positions) boxPositions.set(id, at);
  } else {
    for (const [id, frame] of frames) {
      const light = frame.changed === 0;
      const pad = light ? LIGHT_FRAME_PAD : FRAME_PAD;
      const inside = new Set([...placedIn].filter(([, at]) => at === id).map(([box]) => box));
      const packed = packClusters(
        [...inside].map((box) => [box, boxSizes.get(box) ?? { width: 0, height: 0 }]),
        between.filter((l) => inside.has(l.from) && inside.has(l.to)),
        { x: pad.side, y: pad.top },
      );
      for (const [box, at] of packed.positions) boxPositions.set(box, at);
      frameRects.set(id, {
        x: 0,
        y: 0,
        width: Math.max(bandWidth(frame.project, light), packed.width + 2 * pad.side),
        height: packed.height + pad.top + pad.bottom,
      });
    }
    const outer = (box: string) => placedIn.get(box) ?? box;
    const placed = packFrames(
      [...frameRects, ...[...boxSizes].filter(([id]) => !placedIn.has(id))],
      between.map((l) => ({ from: outer(l.from), to: outer(l.to) })).filter((l) => l.from !== l.to),
      { x: MARGIN, y: MARGIN },
    );
    for (const [id, at] of placed.positions) {
      const frame = frameRects.get(id);
      if (frame) frameRects.set(id, { ...frame, ...at });
      else boxPositions.set(id, at);
    }
  }

  const projectNodes: ProjectFlowNode[] = [...frames].map(([id, { project, changed }]) => {
    const rect = frameRects.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      id,
      type: 'project',
      position: { x: rect.x, y: rect.y },
      width: rect.width,
      height: rect.height,
      selectable: false,
      data: {
        name: project.name,
        folder: project.folder,
        ...(project.kind ? { kind: project.kind } : {}),
        changed,
      },
    };
  });

  const fileNodes: FileFlowNode[] = [...boxes].map(([id, box]) => {
    const size = boxSizes.get(id) ?? { width: 0, height: 0 };
    const frame = placedIn.get(id);
    const project = frameOf.has(id) ? projectOfBox.get(id) : undefined;
    return {
      id,
      type: 'file',
      position: boxPositions.get(id) ?? { x: 0, y: 0 },
      width: size.width,
      height: size.height,
      selectable: false,
      ...(frame ? { parentId: frame, extent: 'parent' as const } : {}),
      data: {
        label: box.label,
        ...(project && box.file ? { local: pathInProject(box.file, project) } : {}),
        changed: box.changed,
      },
    };
  });

  const symbolNodes: SymbolFlowNode[] = nodes.map((node) => ({
    id: node.id,
    type: 'symbol',
    parentId: boxOf.get(node.id) ?? '',
    extent: 'parent',
    position: inner.get(node.id) ?? { x: 0, y: 0 },
    width: nodeWidth(node),
    height: NODE_HEIGHT,
    data: {
      node,
      tone: tone(node),
      label: label(node),
      file: fileOf(node),
      tags: node.delta
        ? Object.entries(node.delta)
            .filter(([, on]) => on)
            .map(([tag]) => tag)
        : [],
      findings: findings.get(node.id) ?? { error: 0, warning: 0, info: 0 },
      reviewed: false,
      settled: false,
    },
  }));

  const summaryNodes: SummaryFlowNode[] = summaries
    .filter((s) => boxOf.has(s.id))
    .map((s) => {
      const span = spans.get(s.id);
      return {
        id: s.id,
        type: 'summary',
        parentId: boxOf.get(s.id) ?? '',
        extent: 'parent',
        position: inner.get(s.id) ?? { x: 0, y: 0 },
        width: summaryWidth(s.id),
        height: NODE_HEIGHT,
        data: {
          of: s.of,
          side: s.side,
          count: s.members.size,
          files: new Set([...s.members].map((m) => groupOf(byId.get(m) as GraphNode).id)).size,
          ...(span ? { projects: span } : {}),
          expanded: s.expanded,
        },
      };
    });

  /** Between two projects' frames (not to a package outside every project). */
  const crosses = (edge: GraphEdge) => {
    const from = frameOf.get(boxOf.get(edge.from) ?? '');
    const to = frameOf.get(boxOf.get(edge.to) ?? '');
    return from !== undefined && to !== undefined && from !== to;
  };

  // A file pair's edge is drawn as its symbols' edges are when they all share a side.
  const pairs = new Map<
    string,
    { source: string; target: string; sides: Set<GraphEdge['side']>; count: number; cross: boolean }
  >();
  for (const edge of edges) {
    const source = boxOf.get(edge.from);
    const target = boxOf.get(edge.to);
    if (!source || !target || source === target) continue;
    const id = `files:${source} → ${target}`;
    let pair = pairs.get(id);
    if (!pair) pairs.set(id, (pair = { source, target, sides: new Set(), count: 0, cross: false }));
    pair.sides.add(edge.side);
    pair.count++;
    pair.cross ||= crosses(edge);
  }
  const fileEdges: FlowEdge[] = [...pairs].map(([id, pair]) => {
    const [side = 'both'] = pair.sides.size === 1 ? pair.sides : [];
    return {
      id,
      source: pair.source,
      target: pair.target,
      className: [
        'edge-files',
        `edge-files-${pair.count >= 10 ? 4 : pair.count >= 4 ? 3 : pair.count >= 2 ? 2 : 1}`,
        `edge-${side}`,
        pair.cross ? 'edge-cross' : '',
      ]
        .filter(Boolean)
        .join(' '),
      data: { edge: null, count: pair.count },
    };
  });

  return {
    // Parents before their children, as React Flow requires.
    nodes: [...projectNodes, ...fileNodes, ...symbolNodes, ...summaryNodes],
    edges: [
      ...edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        className: [
          `edge-${edge.side}`,
          `edge-${edge.kind}`,
          edge.resolution === 'unknown' ? 'edge-unknown' : '',
          crosses(edge) ? 'edge-cross' : '',
        ]
          .filter(Boolean)
          .join(' '),
        data: { edge },
      })),
      ...summaryEdges,
    ],
    fileEdges,
    hidden,
    members: new Map(summaries.map((s) => [s.id, [...s.members]])),
  };
}

/**
 * Review state on a layout: reviewed marks, `--since` dimming and the selection. Nodes that
 * carry none of it are passed through unchanged, so a mark re-renders only what it touches.
 */
export function decorate(nodes: readonly FlowNode[], options: DecorateOptions = {}): FlowNode[] {
  const { reviewed, sinceOnly = false, selected = null } = options;
  return nodes.map((n) => {
    if (n.type !== 'symbol') return n;
    const isReviewed = reviewed?.has(n.id) ?? false;
    const settled = sinceOnly && n.data.node.since === 'same';
    const isSelected = n.id === selected;
    if (!isReviewed && !settled && !isSelected) return n;
    return {
      ...n,
      ...(isSelected ? { selected: true } : {}),
      data: { ...n.data, reviewed: isReviewed, settled },
    };
  });
}

/**
 * The project frame under a point of the canvas (flow coordinates), if any. Frames never take the
 * pointer on the map (their names would cover files, V8b): a click there reaches the canvas, which
 * asks this.
 */
export function projectAt(
  nodes: readonly FlowNode[],
  point: { x: number; y: number },
): string | undefined {
  // Frames are top-level nodes: their position is on the canvas.
  return nodes.find(
    (n) =>
      n.type === 'project' &&
      point.x >= n.position.x &&
      point.x <= n.position.x + n.width &&
      point.y >= n.position.y &&
      point.y <= n.position.y + n.height,
  )?.id;
}

/**
 * The edges React Flow is given, decorated. It checks every one on every frame of a move, and
 * edges were up to half the map's elements (V8c): on the map, a file pair's edges are drawn as
 * one; while the view of a large graph moves, only the selected symbol's are.
 */
export function edgesToDraw(
  layout: Pick<FlowLayout, 'edges' | 'fileEdges'>,
  view: { map: boolean; moving: boolean; selected: string | null },
): FlowEdge[] {
  const { selected } = view;
  const own = (e: FlowEdge) => e.source === selected || e.target === selected;
  const all = view.map ? [...layout.fileEdges, ...layout.edges.filter(own)] : layout.edges;
  const drawn = view.moving && all.length > MOVING_EDGE_LIMIT ? layout.edges.filter(own) : all;
  return decorateEdges(drawn, selected);
}

/** Edges of the selected symbol stand out, so its users and uses can be followed. */
export function decorateEdges(edges: readonly FlowEdge[], selected: string | null): FlowEdge[] {
  if (!selected) return [...edges];
  return edges.map((e) =>
    e.source === selected || e.target === selected
      ? { ...e, className: `${e.className} edge-active` }
      : e,
  );
}

interface Neighbours {
  id: string;
  of: string;
  side: SummaryData['side'];
  members: Set<string>;
}

interface Member {
  id: string;
  width: number;
  changed: boolean;
}

/**
 * Positions inside a box (top-left corners, from 0): dagre, left to right, for members with an
 * edge inside the box; the others, changed ones first, in columns to the right.
 */
function layoutBox(
  members: readonly Member[],
  internal: readonly { from: string; to: string }[],
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const positions = new Map<string, { x: number; y: number }>();
  const dense = internal.length > MAX_BOX_EDGES;
  const linked = new Set(dense ? [] : internal.flatMap((l) => [l.from, l.to]));
  let width = 0;
  let height = 0;

  const layered = members.filter((m) => linked.has(m.id));
  if (layered.length > 0) {
    const local = new dagre.graphlib.Graph();
    local.setGraph({ rankdir: 'LR', nodesep: 12, ranksep: 40 });
    local.setDefaultEdgeLabel(() => ({}));
    for (const m of layered) local.setNode(m.id, { width: m.width, height: NODE_HEIGHT });
    for (const l of internal) local.setEdge(l.from, l.to);
    dagre.layout(local);
    const placed = layered.map((m) => ({ id: m.id, ...placement(local, m.id) }));
    const left = Math.min(...placed.map((p) => p.x - p.width / 2));
    const top = Math.min(...placed.map((p) => p.y - p.height / 2));
    for (const p of placed) {
      const x = p.x - p.width / 2 - left;
      const y = p.y - p.height / 2 - top;
      positions.set(p.id, { x, y });
      width = Math.max(width, x + p.width);
      height = Math.max(height, y + p.height);
    }
  }

  const loose = members
    .filter((m) => !linked.has(m.id))
    .sort((a, b) => Number(b.changed) - Number(a.changed));
  let x = layered.length > 0 ? width + 2 * WRAP_GAP.x : 0;
  // A dense box is all columns: about square (symbols are some four times wider than tall).
  const rows = dense ? Math.max(WRAP_ROWS, Math.ceil(Math.sqrt(loose.length * 4))) : WRAP_ROWS;
  for (let start = 0; start < loose.length; start += rows) {
    const column = loose.slice(start, start + rows);
    column.forEach((m, row) => positions.set(m.id, { x, y: row * (NODE_HEIGHT + WRAP_GAP.y) }));
    const columnWidth = Math.max(...column.map((m) => m.width));
    width = Math.max(width, x + columnWidth);
    height = Math.max(height, column.length * (NODE_HEIGHT + WRAP_GAP.y) - WRAP_GAP.y);
    x += columnWidth + WRAP_GAP.x;
  }
  return { positions, width, height };
}

/**
 * Top-left corners of the boxes, from `origin`: boxes connected by edges form a cluster laid out
 * left to right by dagre; clusters are placed in rows, tallest first, on a page about
 * `PAGE_ASPECT` wide. Also the size they take, from `origin`.
 */
function packClusters(
  boxes: readonly [string, { width: number; height: number }][],
  links: readonly { from: string; to: string }[],
  origin: { x: number; y: number },
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  // Union-find over boxes.
  const parent = new Map(boxes.map(([id]) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(id, root);
    return root;
  };
  for (const l of links) parent.set(find(l.from), find(l.to));
  const clusters = new Map<string, [string, { width: number; height: number }][]>();
  for (const box of boxes) {
    const root = find(box[0]);
    clusters.set(root, [...(clusters.get(root) ?? []), box]);
  }

  const laidOut = [...clusters.values()].map((members, order) => {
    const ids = new Set(members.map(([id]) => id));
    const positions = new Map<string, { x: number; y: number }>();
    if (members.length === 1) {
      const [[id, size]] = members as [[string, { width: number; height: number }]];
      positions.set(id, { x: 0, y: 0 });
      return { positions, width: size.width, height: size.height, order };
    }
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 90 });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const [id, size] of members) graph.setNode(id, { ...size });
    for (const l of links) if (ids.has(l.from) && ids.has(l.to)) graph.setEdge(l.from, l.to);
    dagre.layout(graph);
    const placed = members.map(([id]) => ({ id, ...placement(graph, id) }));
    const left = Math.min(...placed.map((p) => p.x - p.width / 2));
    const top = Math.min(...placed.map((p) => p.y - p.height / 2));
    let width = 0;
    let height = 0;
    for (const p of placed) {
      const x = p.x - p.width / 2 - left;
      const y = p.y - p.height / 2 - top;
      positions.set(p.id, { x, y });
      width = Math.max(width, x + p.width);
      height = Math.max(height, y + p.height);
    }
    return { positions, width, height, order };
  });

  laidOut.sort((a, b) => b.height - a.height || b.width - a.width || a.order - b.order);
  return placeInRows(laidOut, origin);
}

/**
 * Top-left corners of project frames (and of boxes in none), in reading order: dagre ranks them
 * left to right by the links between them (callers before what they call), and they are placed in
 * rows in that order, the tallest first within a rank; those linked to nothing come last. Dagre's
 * own columns run 3 to 8 times wider than high with frames (Bitwarden); rows keep the page about
 * `PAGE_ASPECT` wide.
 */
function packFrames(
  items: readonly [string, Size][],
  links: readonly { from: string; to: string }[],
  origin: { x: number; y: number },
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 90 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const [id, { width, height }] of items) graph.setNode(id, { width, height });
  for (const l of links) graph.setEdge(l.from, l.to);
  dagre.layout(graph);
  const linked = new Set(links.flatMap((l) => [l.from, l.to]));
  // Left to right, a rank's nodes share their centre's x.
  const ordered = items.map(([id, size], order) => ({
    positions: new Map([[id, { x: 0, y: 0 }]]),
    width: size.width,
    height: size.height,
    alone: !linked.has(id),
    rank: Math.round(placement(graph, id).x),
    order,
  }));
  ordered.sort(
    (a, b) =>
      Number(a.alone) - Number(b.alone) ||
      a.rank - b.rank ||
      b.height - a.height ||
      b.width - a.width ||
      a.order - b.order,
  );
  return placeInRows(ordered, origin);
}

/** Laid-out groups (positions from their own top-left) placed in rows, in the order given. */
function placeInRows(
  laidOut: readonly {
    positions: Map<string, { x: number; y: number }>;
    width: number;
    height: number;
  }[],
  origin: { x: number; y: number },
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const area = laidOut.reduce(
    (sum, c) => sum + (c.width + CLUSTER_GAP) * (c.height + CLUSTER_GAP),
    0,
  );
  const pageWidth = Math.max(...laidOut.map((c) => c.width), Math.sqrt(area * PAGE_ASPECT));

  const result = new Map<string, { x: number; y: number }>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const cluster of laidOut) {
    if (x > 0 && x + cluster.width > pageWidth) {
      x = 0;
      y += rowHeight + CLUSTER_GAP;
      rowHeight = 0;
    }
    for (const [id, at] of cluster.positions) {
      result.set(id, { x: origin.x + x + at.x, y: origin.y + y + at.y });
    }
    width = Math.max(width, x + cluster.width);
    x += cluster.width + CLUSTER_GAP;
    rowHeight = Math.max(rowHeight, cluster.height);
  }
  return { positions: result, width, height: y + rowHeight };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** dagre's placement: a node's center and size. */
type Placement = Rect;

interface Size {
  width: number;
  height: number;
}

/** Wide enough for a frame's name band: the name and kind, the start of the folder, "12 changed".
 * */
function bandWidth(project: Project, light: boolean): number {
  return Math.round(project.name.length * (light ? 8 : 10) + (project.kind ? 44 : 0) + 190);
}

/** dagre's node labels are untyped; after layout they hold center and size. */
function placement(graph: DagreGraph, id: string): Placement {
  return graph.node(id) as Placement;
}

/** The box a node is drawn in: its file (whose path it gives), its package, or the dynamic calls.
 * */
export function groupOf(node: GraphNode): { id: string; label: string; file?: string } {
  if (node.kind === 'unknown') return { id: 'group:unknown', label: 'dynamic calls' };
  const file = node.id.slice(0, node.id.indexOf('#'));
  if (node.kind === 'external') return { id: `group:package:${file}`, label: `package ${file}` };
  return { id: `group:file:${file}`, label: file, file };
}

export function tone(node: GraphNode): Tone {
  if (node.kind === 'external') return 'external';
  if (node.kind === 'unknown') return 'unknown';
  if (node.status === 'unchanged') return 'context';
  if (
    node.status === 'modified' &&
    node.delta?.moved &&
    !node.delta.signature &&
    !node.delta.body
  ) {
    return 'moved';
  }
  return node.status;
}

/**
 * `Class.method`, a package export, `file (top level)`, the unresolved callee, or a template:
 * its file (`foo.component.html`), or `FooComponent template` when inline.
 */
export function label(node: GraphNode): string {
  const local = node.id.slice(node.id.indexOf('#') + 1);
  if (node.kind === 'module') return 'top level';
  if (node.kind === 'unknown') return node.id.replace(/^unknown:/, '');
  if (local === '(template)')
    return node.id.slice(node.id.lastIndexOf('/') + 1, node.id.indexOf('#'));
  if (local.endsWith('.(template)')) return `${local.slice(0, -'.(template)'.length)} template`;
  return local;
}

/** Second line of a node: its signature (the file is the box around it). */
export function fileOf(node: GraphNode): string {
  if (node.kind === 'unknown') return 'dynamic call';
  if (node.kind === 'external') return 'package export';
  if (node.kind === 'module') return 'code outside declarations';
  return (node.head ?? node.base)?.signature ?? '';
}

/** Wide enough for `KIND name` in monospace plus finding badges; signatures may truncate. */
function nodeWidth(node: GraphNode): number {
  const text = label(node).length * 9.4 + node.kind.length * 8.6 + 84;
  return Math.min(380, Math.max(180, Math.round(text)));
}

function countFindings(graph: Graph): Map<string, Record<Severity, number>> {
  const counts = new Map<string, Record<Severity, number>>();
  for (const finding of graph.findings) {
    const count = counts.get(finding.symbol) ?? { error: 0, warning: 0, info: 0 };
    count[finding.severity] += 1;
    counts.set(finding.symbol, count);
  }
  return counts;
}
