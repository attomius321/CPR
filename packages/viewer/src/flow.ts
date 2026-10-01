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

export type FlowNode = FileFlowNode | SymbolFlowNode;

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  className: string;
  data: { edge: GraphEdge };
}

export interface FlowOptions {
  /** Show `type-reference` edges (hidden by default: they are numerous and rarely decisions). */
  typeReferences?: boolean;
  /** Show unchanged neighbours, packages and top-level code. */
  context?: boolean;
}

export const NODE_HEIGHT = 58;
const GROUP_PAD = { top: 30, side: 12, bottom: 12 };

/** Graph JSON → laid-out React Flow nodes and edges. Pure, so it is unit-tested. */
export function toFlow(
  graph: Graph,
  options: FlowOptions = {},
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const { typeReferences = false, context = true } = options;
  const findings = countFindings(graph);

  const visible = graph.nodes.filter((n) => context || n.status !== 'unchanged');
  const ids = new Set(visible.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => ids.has(e.from) && ids.has(e.to) && (typeReferences || e.kind !== 'type-reference'),
  );

  // Context nodes that only hang on hidden edges add nothing.
  const connected = new Set(edges.flatMap((e) => [e.from, e.to]));
  const nodes = visible.filter((n) => n.status !== 'unchanged' || connected.has(n.id));

  // Two levels, so boxes never overlap: lay out each file's symbols on their own, then lay
  // out the file boxes as single nodes connected by the calls between files.
  const sizes = new Map(nodes.map((n) => [n.id, nodeWidth(n)]));
  const members = new Map<string, GraphNode[]>();
  const groups = new Map<string, { label: string; changed: boolean }>();
  for (const node of nodes) {
    const group = groupOf(node);
    const known = groups.get(group.id);
    groups.set(group.id, {
      label: group.label,
      changed: (known?.changed ?? false) || node.status !== 'unchanged',
    });
    members.set(group.id, [...(members.get(group.id) ?? []), node]);
  }
  const groupIdOf = new Map(nodes.map((n) => [n.id, groupOf(n).id]));

  const inner = new Map<string, { x: number; y: number }>(); // symbol → position in its box
  const boxSizes = new Map<string, { width: number; height: number }>();
  for (const [id, symbols] of members) {
    const local = new dagre.graphlib.Graph();
    local.setGraph({ rankdir: 'LR', nodesep: 12, ranksep: 40 });
    local.setDefaultEdgeLabel(() => ({}));
    for (const node of symbols) {
      local.setNode(node.id, { width: sizes.get(node.id) ?? 200, height: NODE_HEIGHT });
    }
    for (const edge of edges) {
      if (groupIdOf.get(edge.from) === id && groupIdOf.get(edge.to) === id) {
        local.setEdge(edge.from, edge.to);
      }
    }
    dagre.layout(local);
    const placed = symbols.map((n) => ({ id: n.id, ...placement(local, n.id) }));
    const left = Math.min(...placed.map((n) => n.x - n.width / 2));
    const top = Math.min(...placed.map((n) => n.y - n.height / 2));
    const right = Math.max(...placed.map((n) => n.x + n.width / 2));
    const bottom = Math.max(...placed.map((n) => n.y + n.height / 2));
    for (const n of placed) {
      inner.set(n.id, {
        x: n.x - n.width / 2 - left + GROUP_PAD.side,
        y: n.y - n.height / 2 - top + GROUP_PAD.top,
      });
    }
    boxSizes.set(id, {
      width: right - left + 2 * GROUP_PAD.side,
      height: bottom - top + GROUP_PAD.top + GROUP_PAD.bottom,
    });
  }

  const outer = new dagre.graphlib.Graph();
  outer.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 90, marginx: 20, marginy: 20 });
  outer.setDefaultEdgeLabel(() => ({}));
  for (const [id, size] of boxSizes) outer.setNode(id, { ...size });
  for (const edge of edges) {
    const from = groupIdOf.get(edge.from);
    const to = groupIdOf.get(edge.to);
    if (from && to && from !== to) outer.setEdge(from, to);
  }
  dagre.layout(outer);

  const fileNodes: FileFlowNode[] = [...groups].map(([id, group]) => {
    const { x, y } = placement(outer, id);
    const size = boxSizes.get(id) ?? { width: 0, height: 0 };
    return {
      id,
      type: 'file',
      position: { x: x - size.width / 2, y: y - size.height / 2 },
      width: size.width,
      height: size.height,
      selectable: false,
      data: { label: group.label, changed: group.changed },
    };
  });

  const symbolNodes: SymbolFlowNode[] = nodes.map((node) => {
    const width = sizes.get(node.id) ?? 200;
    return {
      id: node.id,
      type: 'symbol',
      parentId: groupIdOf.get(node.id) ?? '',
      extent: 'parent',
      position: inner.get(node.id) ?? { x: 0, y: 0 },
      width,
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
      },
    };
  });

  return {
    nodes: [...fileNodes, ...symbolNodes],
    edges: edges.map((edge) => ({
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
  };
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

/** `Class.method`, a package export, `file (top level)`, or the unresolved callee. */
export function label(node: GraphNode): string {
  const local = node.id.slice(node.id.indexOf('#') + 1);
  if (node.kind === 'module') return 'top level';
  if (node.kind === 'unknown') return node.id.replace(/^unknown:/, '');
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
