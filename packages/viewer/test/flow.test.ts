import { readFileSync } from 'node:fs';
import type { Finding, Graph, GraphEdge, GraphNode } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import {
  decorate,
  decorateEdges,
  label,
  layoutFlow,
  NEIGHBOUR_LIMIT,
  NODE_HEIGHT,
  summaryId,
  toFlow,
  tone,
  type FileFlowNode,
  type FlowNode,
  type SummaryFlowNode,
  type SymbolFlowNode,
} from '../src/flow.js';

/** The engine's golden graphs double as viewer fixtures. */
const golden = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../core/test/__snapshots__/graph-${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as Graph;

const symbols = (nodes: FlowNode[]) =>
  nodes.filter((n): n is SymbolFlowNode => n.type === 'symbol');

/** Absolute x: children are positioned relative to their file box. */
const absoluteX = (nodes: FlowNode[], id: string) => {
  const node = symbols(nodes).find((n) => n.id === id);
  const parent = nodes.find((n) => n.id === node?.parentId);
  return (node?.position.x ?? NaN) + (parent?.position.x ?? 0);
};

describe('toFlow', () => {
  it('lays out every changed symbol and its neighbours', () => {
    const { nodes, edges } = toFlow(golden('callers'));
    expect(
      symbols(nodes)
        .map((n) => `${n.data.tone} ${n.data.label}`)
        .sort(),
    ).toEqual(['added triple', 'context old', 'context total', 'modified add', 'removed legacy']);
    expect(edges.map((e) => `${e.source} → ${e.target} ${e.className}`).sort()).toEqual([
      'src/app.ts#old → src/math.ts#legacy edge-base edge-call',
      'src/app.ts#total → src/math.ts#add edge-both edge-call',
      'src/math.ts#legacy → src/math.ts#add edge-base edge-call',
      'src/math.ts#triple → src/math.ts#add edge-head edge-call',
    ]);
    // Layered left to right: callers before callees.
    expect(absoluteX(nodes, 'src/app.ts#old')).toBeLessThan(absoluteX(nodes, 'src/math.ts#legacy'));
    expect(absoluteX(nodes, 'src/math.ts#triple')).toBeLessThan(
      absoluteX(nodes, 'src/math.ts#add'),
    );
  });

  it('boxes symbols by file and lists boxes before their symbols', () => {
    const { nodes } = toFlow(golden('callers'));
    const files = nodes.filter((n) => n.type === 'file');
    expect(files.map((f) => f.data.label).sort()).toEqual(['src/app.ts', 'src/math.ts']);
    expect(files.find((f) => f.data.label === 'src/app.ts')?.data.changed).toBe(false);
    const firstSymbol = nodes.findIndex((n) => n.type === 'symbol');
    expect(nodes.slice(firstSymbol).every((n) => n.type === 'symbol')).toBe(true);
    for (const node of symbols(nodes)) {
      const box = files.find((f) => f.id === node.parentId);
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.x + node.width).toBeLessThanOrEqual(box?.width ?? 0);
    }
  });

  it('counts findings per symbol', () => {
    const { nodes } = toFlow(golden('callers'));
    const legacy = symbols(nodes).find((n) => n.id === 'src/math.ts#legacy');
    expect(legacy?.data.findings).toEqual({ error: 1, warning: 0, info: 0 });
  });

  it('hides type references unless asked, and drops neighbours left without edges', () => {
    const graph = golden('detectors');
    const hidden = toFlow(graph);
    const shown = toFlow(graph, { typeReferences: true });
    expect(hidden.edges.some((e) => e.className.includes('edge-type-reference'))).toBe(false);
    expect(shown.edges.some((e) => e.className.includes('edge-type-reference'))).toBe(true);
    expect(shown.nodes.length).toBeGreaterThanOrEqual(hidden.nodes.length);
  });

  it('can hide context entirely', () => {
    const { nodes } = toFlow(golden('callers'), { context: false });
    expect(symbols(nodes).every((n) => n.data.node.status !== 'unchanged')).toBe(true);
  });

  it('labels special nodes', () => {
    const base = {
      container: null,
      language: 'typescript',
      exported: false,
      status: 'unchanged',
      previousId: null,
      base: null,
      head: null,
    } as const;
    expect(label({ ...base, id: 'src/a.ts#(module)', kind: 'module', name: 'src/a.ts' })).toBe(
      'top level',
    );
    expect(label({ ...base, id: 'unknown:obj[key]', kind: 'unknown', name: 'obj[key]' })).toBe(
      'obj[key]',
    );
    expect(tone({ ...base, id: 'react#useState', kind: 'external', name: 'useState' })).toBe(
      'external',
    );
  });
});

/** A made-up graph: `nodes` as `id` (unchanged) or `id!` (modified); `edges` as `from>to`. */
function synthetic(nodes: string[], edges: string[], findings: Finding[] = []): Graph {
  const node = (spec: string): GraphNode => {
    const id = spec.replace(/!$/, '');
    return {
      id,
      kind: 'function',
      name: id.slice(id.indexOf('#') + 1),
      container: null,
      language: 'typescript',
      exported: true,
      status: spec.endsWith('!') ? 'modified' : 'unchanged',
      previousId: null,
      base: null,
      head: null,
    };
  };
  const edge = (spec: string, i: number): GraphEdge => {
    const [from = '', to = ''] = spec.split('>');
    return {
      id: `e${i}`,
      from,
      to,
      kind: 'call',
      side: 'both',
      resolution: 'resolved',
      sites: {},
    };
  };
  return { ...golden('callers'), nodes: nodes.map(node), edges: edges.map(edge), findings };
}

/** `hub` (changed) used by `users` callers, one per file in `files` files; `small` with 2. */
function hubGraph(users = 30, files = 10, findings: Finding[] = []): Graph {
  const callers = Array.from({ length: users }, (_, i) => `src/user${i % files}.ts#caller${i}`);
  return synthetic(
    ['src/hub.ts#hub!', 'src/small.ts#small!', ...callers, 'src/a.ts#a', 'src/b.ts#b'],
    [
      ...callers.map((c) => `${c}>src/hub.ts#hub`),
      'src/a.ts#a>src/small.ts#small',
      'src/b.ts#b>src/small.ts#small',
    ],
    findings,
  );
}

const summaries = (nodes: FlowNode[]) =>
  nodes.filter((n): n is SummaryFlowNode => n.type === 'summary');

describe('layoutFlow: big neighbourhoods', () => {
  const HUB = 'src/hub.ts#hub';

  it('draws few neighbours and one summary node for many', () => {
    const { nodes, edges, hidden } = layoutFlow(hubGraph());
    expect(summaries(nodes).map((n) => [n.id, n.data])).toEqual([
      [summaryId('users', HUB), { of: HUB, side: 'users', count: 30, files: 10, expanded: false }],
    ]);
    expect(
      symbols(nodes)
        .map((n) => n.id)
        .sort(),
    ).toEqual(['src/a.ts#a', 'src/b.ts#b', HUB, 'src/small.ts#small']);
    // The summary sits in its symbol's box, linked to it as its users are.
    const summary = summaries(nodes)[0];
    expect(summary?.parentId).toBe(symbols(nodes).find((n) => n.id === HUB)?.parentId);
    expect(edges.find((e) => e.target === HUB)).toMatchObject({
      source: summaryId('users', HUB),
      className: 'edge-summary',
      data: { edge: null },
    });
    expect(hidden.get('src/user3.ts#caller3')).toBe(summaryId('users', HUB));
    expect(hidden.has('src/a.ts#a')).toBe(false);
  });

  it('collapses only above the limit', () => {
    expect(summaries(layoutFlow(hubGraph(NEIGHBOUR_LIMIT, 4)).nodes)).toEqual([]);
    expect(summaries(layoutFlow(hubGraph(NEIGHBOUR_LIMIT + 1, 4)).nodes)).toHaveLength(1);
  });

  it('shows every neighbour once expanded, and keeps the summary to hide them', () => {
    const { nodes, hidden } = layoutFlow(hubGraph(), {
      expanded: new Set([summaryId('users', HUB)]),
    });
    expect(symbols(nodes)).toHaveLength(34);
    expect(summaries(nodes)[0]?.data.expanded).toBe(true);
    expect(hidden.size).toBe(0);
  });

  it('keeps a neighbour another changed symbol shows, and users still using something removed', () => {
    const graph = hubGraph();
    // caller1 also calls `small`, whose side is small: it is drawn, and still counted.
    graph.edges.push({
      ...(graph.edges[0] as GraphEdge),
      id: 'shared',
      from: 'src/user1.ts#caller1',
      to: 'src/small.ts#small',
    });
    graph.findings.push({
      id: 'f1',
      rule: 'removed-still-referenced',
      severity: 'error',
      symbol: HUB,
      related: ['src/user7.ts#caller7'],
      message: 'still used',
      data: {},
    });
    const { nodes, hidden } = layoutFlow(graph);
    const drawn = new Set(symbols(nodes).map((n) => n.id));
    expect(drawn.has('src/user1.ts#caller1')).toBe(true);
    expect(drawn.has('src/user7.ts#caller7')).toBe(true);
    expect(drawn.has('src/user2.ts#caller2')).toBe(false);
    expect(summaries(nodes)[0]?.data.count).toBe(30);
    expect(hidden.has('src/user1.ts#caller1')).toBe(false);
  });

  it('collapses inside the focus set too', () => {
    const graph = hubGraph();
    const focus = new Set([
      HUB,
      ...graph.nodes.filter((n) => n.id.includes('caller')).map((n) => n.id),
    ]);
    const { nodes } = layoutFlow(graph, { focus });
    expect(symbols(nodes).map((n) => n.id)).toEqual([HUB]);
    expect(summaries(nodes)).toHaveLength(1);
  });
});

describe('layoutFlow: a page, not a strip', () => {
  const extent = (nodes: FlowNode[]) => {
    const boxes = nodes.filter((n): n is FileFlowNode => n.type === 'file');
    return {
      width: Math.max(...boxes.map((b) => b.position.x + b.width)),
      height: Math.max(...boxes.map((b) => b.position.y + b.height)),
    };
  };

  it('packs separate clusters into rows', () => {
    // 60 changed symbols in 60 files, nothing connecting them: one column before V6.
    const graph = synthetic(
      Array.from({ length: 60 }, (_, i) => `src/f${i}.ts#s${i}!`),
      [],
    );
    const { width, height } = extent(layoutFlow(graph).nodes);
    expect(width / height).toBeGreaterThan(0.6);
    expect(width / height).toBeLessThan(2.5);
  });

  it('wraps symbols with no edge inside their box into columns', () => {
    const graph = synthetic(
      Array.from({ length: 20 }, (_, i) => `src/one.ts#s${i}!`),
      [],
    );
    const box = layoutFlow(graph).nodes.find((n) => n.type === 'file');
    expect(box?.height).toBeLessThan(7 * (NODE_HEIGHT + 12) + 42);
    expect(box?.width).toBeGreaterThan(3 * 180);
  });

  it('never overlaps boxes', () => {
    const { nodes } = layoutFlow(hubGraph(30, 10), {
      expanded: new Set([summaryId('users', 'src/hub.ts#hub')]),
    });
    const boxes = nodes.filter((n): n is FileFlowNode => n.type === 'file');
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        const apart =
          a.position.x + a.width <= b.position.x ||
          b.position.x + b.width <= a.position.x ||
          a.position.y + a.height <= b.position.y ||
          b.position.y + b.height <= a.position.y;
        expect(apart, `${a.id} and ${b.id}`).toBe(true);
      }
    }
  });
});

describe('decorate', () => {
  it('marks without moving anything, and leaves undecorated nodes as they were', () => {
    const graph = golden('callers');
    const layout = layoutFlow(graph);
    const nodes = decorate(layout.nodes, {
      reviewed: new Set(['src/math.ts#add']),
      selected: 'src/math.ts#legacy',
    });
    expect(nodes.map((n) => [n.id, n.position])).toEqual(
      layout.nodes.map((n) => [n.id, n.position]),
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect((byId.get('src/math.ts#add') as SymbolFlowNode).data.reviewed).toBe(true);
    expect((byId.get('src/math.ts#legacy') as SymbolFlowNode).selected).toBe(true);
    const untouched = layout.nodes.find((n) => n.id === 'src/app.ts#total');
    expect(byId.get('src/app.ts#total')).toBe(untouched);
  });

  it("makes the selected symbol's edges stand out", () => {
    const { edges } = layoutFlow(golden('callers'));
    const active = decorateEdges(edges, 'src/math.ts#add')
      .filter((e) => e.className.includes('edge-active'))
      .map((e) => `${e.source} → ${e.target}`)
      .sort();
    expect(active).toEqual([
      'src/app.ts#total → src/math.ts#add',
      'src/math.ts#legacy → src/math.ts#add',
      'src/math.ts#triple → src/math.ts#add',
    ]);
    expect(decorateEdges(edges, null).some((e) => e.className.includes('edge-active'))).toBe(false);
  });
});
