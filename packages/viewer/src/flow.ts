import dagre, { type Graph as DagreGraph } from '@dagrejs/dagre';
import type { Graph, GraphEdge, GraphNode, Severity } from '@cpr/core';

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
  label: string;
  changed: boolean;
}

/** A box around the symbols of one file, package, or the dynamic calls. */
export interface FileFlowNode {
  id: string;
  type: 'file';
  position: { x: number; y: number };
  data: FileData;
  width: number;
  height: number;
  selectable: false;
}

export type FlowNode = FileFlowNode | SymbolFlowNode | SummaryFlowNode;

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  className: string;
  /** The graph's edge; `null` for the edge between a summary and its symbol. */
  data: { edge: GraphEdge | null };
}

/** What is drawn and where; reviewing (selection, marks) never changes it. */
export interface FlowLayout {
  nodes: FlowNode[];
  edges: FlowEdge[];
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
const GROUP_PAD = { top: 30, side: 12, bottom: 12 };
/** Symbols with no edge inside their box are stacked in columns of at most this many. */
const WRAP_ROWS = 6;
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

  // Boxes: a file or package each; a summary sits in its symbol's box.
  const boxOf = new Map<string, string>();
  const boxes = new Map<string, { label: string; changed: boolean; members: Member[] }>();
  const join = (member: Member, box: { id: string; label: string }, changed: boolean) => {
    let entry = boxes.get(box.id);
    if (!entry) boxes.set(box.id, (entry = { label: box.label, changed: false, members: [] }));
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
    join({ id: summary.id, width: SUMMARY_WIDTH, changed: false }, groupOf(owner), false);
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

  // Between boxes: clusters connected by edges, each laid out by dagre, packed into a page.
  const between = links
    .map((l) => ({ from: boxOf.get(l.from) ?? '', to: boxOf.get(l.to) ?? '' }))
    .filter((l) => l.from && l.to && l.from !== l.to);
  const boxPositions = packClusters([...boxSizes], between);

  const fileNodes: FileFlowNode[] = [...boxes].map(([id, box]) => {
    const size = boxSizes.get(id) ?? { width: 0, height: 0 };
    return {
      id,
      type: 'file',
      position: boxPositions.get(id) ?? { x: 0, y: 0 },
      width: size.width,
      height: size.height,
      selectable: false,
      data: { label: box.label, changed: box.changed },
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
    .map((s) => ({
      id: s.id,
      type: 'summary',
      parentId: boxOf.get(s.id) ?? '',
      extent: 'parent',
      position: inner.get(s.id) ?? { x: 0, y: 0 },
      width: SUMMARY_WIDTH,
      height: NODE_HEIGHT,
      data: {
        of: s.of,
        side: s.side,
        count: s.members.size,
        files: new Set([...s.members].map((m) => groupOf(byId.get(m) as GraphNode).id)).size,
        expanded: s.expanded,
      },
    }));

  return {
    // Parents before their children, as React Flow requires.
    nodes: [...fileNodes, ...symbolNodes, ...summaryNodes],
    edges: [
      ...edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        className: [
          `edge-${edge.side}`,
          `edge-${edge.kind}`,
          edge.resolution === 'unknown' ? 'edge-unknown' : '',
        ]
          .filter(Boolean)
          .join(' '),
        data: { edge },
      })),
      ...summaryEdges,
    ],
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
  const linked = new Set(internal.flatMap((l) => [l.from, l.to]));
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
  for (let start = 0; start < loose.length; start += WRAP_ROWS) {
    const column = loose.slice(start, start + WRAP_ROWS);
    column.forEach((m, row) => positions.set(m.id, { x, y: row * (NODE_HEIGHT + WRAP_GAP.y) }));
    const columnWidth = Math.max(...column.map((m) => m.width));
    width = Math.max(width, x + columnWidth);
    height = Math.max(height, column.length * (NODE_HEIGHT + WRAP_GAP.y) - WRAP_GAP.y);
    x += columnWidth + WRAP_GAP.x;
  }
  return { positions, width, height };
}

/**
 * Top-left corners of the boxes: boxes connected by edges form a cluster laid out left to right
 * by dagre; clusters are placed in rows, tallest first, on a page about `PAGE_ASPECT` wide.
 */
function packClusters(
  boxes: readonly [string, { width: number; height: number }][],
  links: readonly { from: string; to: string }[],
): Map<string, { x: number; y: number }> {
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
  const area = laidOut.reduce(
    (sum, c) => sum + (c.width + CLUSTER_GAP) * (c.height + CLUSTER_GAP),
    0,
  );
  const pageWidth = Math.max(...laidOut.map((c) => c.width), Math.sqrt(area * PAGE_ASPECT));

  const result = new Map<string, { x: number; y: number }>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const cluster of laidOut) {
    if (x > 0 && x + cluster.width > pageWidth) {
      x = 0;
      y += rowHeight + CLUSTER_GAP;
      rowHeight = 0;
    }
    for (const [id, at] of cluster.positions) {
      result.set(id, { x: MARGIN + x + at.x, y: MARGIN + y + at.y });
    }
    x += cluster.width + CLUSTER_GAP;
    rowHeight = Math.max(rowHeight, cluster.height);
  }
  return result;
}

interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** dagre's node labels are untyped; after layout they hold center and size. */
function placement(graph: DagreGraph, id: string): Placement {
  return graph.node(id) as Placement;
}

/** The box a node is drawn in: its file, its package, or the dynamic calls. */
export function groupOf(node: GraphNode): { id: string; label: string } {
  if (node.kind === 'unknown') return { id: 'group:unknown', label: 'dynamic calls' };
  const file = node.id.slice(0, node.id.indexOf('#'));
  if (node.kind === 'external') return { id: `group:package:${file}`, label: `package ${file}` };
  return { id: `group:file:${file}`, label: file };
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
