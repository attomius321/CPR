import { readFileSync } from 'node:fs';
import type { Finding, Graph, GraphEdge, GraphNode, Project } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  decorate,
  decorateEdges,
  drawnAs,
  edgesToDraw,
  findingCount,
  kindMark,
  label,
  RAISED_EDGE_Z,
  layoutFlow,
  projectAt,
  MOVING_EDGE_LIMIT,
  NEIGHBOUR_LIMIT,
  NODE_HEIGHT,
  onCanvas,
  stylesheetId,
  stylesheetNoun,
  summaryId,
  toFlow,
  tone,
  type FileFlowNode,
  type FlowEdge,
  type FlowNode,
  type ProjectFlowNode,
  type StylesheetFlowNode,
  type SummaryFlowNode,
  type SymbolFlowNode,
} from '../src/graph/flow.js';
import { changeList, layoutView } from '../src/diff/review.js';
import {
  ACCENT,
  GAP,
  LINE,
  ONLY,
  OTHER,
  PAGE,
  PAGE_CSS,
  RULE_IDS,
  rule,
  sheetGraph,
} from './stylesheet-graph.js';

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
function synthetic(
  nodes: string[],
  edges: string[],
  findings: Finding[] = [],
  projects?: Project[],
): Graph {
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
  return {
    ...golden('callers'),
    nodes: nodes.map(node),
    edges: edges.map(edge),
    findings,
    ...(projects ? { projects } : {}),
  };
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

describe('layoutFlow: projects', () => {
  const frames = (nodes: FlowNode[]) =>
    nodes.filter((n): n is ProjectFlowNode => n.type === 'project');
  const files = (nodes: FlowNode[]) => nodes.filter((n): n is FileFlowNode => n.type === 'file');
  const project = (folder: string, name = folder || 'repository root'): Project => ({
    folder,
    name,
    source: folder ? 'workspace' : 'root',
  });
  /** Top-level rectangles: frames, and boxes outside every frame. */
  const apart = (
    a: { position: { x: number; y: number }; width: number; height: number },
    b: { position: { x: number; y: number }; width: number; height: number },
  ) =>
    a.position.x + a.width <= b.position.x ||
    b.position.x + b.width <= a.position.x ||
    a.position.y + a.height <= b.position.y ||
    b.position.y + b.height <= a.position.y;

  it('draws a frame per project around its files, parents first', () => {
    // Two apps call a shared library; a removed library stands alone (npm workspaces).
    const { nodes } = layoutFlow(golden('projects'));
    const drawn = frames(nodes);
    expect(drawn.map((f) => [f.data.name, f.data.folder, f.data.changed]).sort()).toEqual([
      ['@acme/admin', 'apps/admin', 1],
      ['@acme/legacy', 'libs/legacy', 1],
      ['@acme/shop', 'apps/shop', 0],
      ['@acme/ui', 'libs/ui', 1],
    ]);
    const types = nodes.map((n) => n.type);
    expect(types.lastIndexOf('project')).toBeLessThan(types.indexOf('file'));
    expect(types.lastIndexOf('file')).toBeLessThan(types.indexOf('symbol'));
    for (const file of files(nodes)) {
      const frame = drawn.find((f) => f.id === file.parentId);
      expect(frame, file.id).toBeDefined();
      expect(file.extent).toBe('parent');
      expect(file.position.x).toBeGreaterThan(0);
      expect(file.position.y).toBeGreaterThan(0);
      expect(file.position.x + file.width).toBeLessThan(frame?.width ?? 0);
      expect(file.position.y + file.height).toBeLessThan(frame?.height ?? 0);
    }
    // Inside a frame a path is shown relative to its project; the label stays the full path.
    const page = files(nodes).find((f) => f.data.label === 'apps/admin/src/page.ts');
    expect(page?.data.local).toBe('src/page.ts');
  });

  it('finds the frame under a point of the canvas', () => {
    const { nodes } = layoutFlow(golden('projects'));
    const admin = frames(nodes).find((f) => f.id === 'project:apps/admin') as ProjectFlowNode;
    // Inside the frame, below its files: the frame.
    const inside = {
      x: admin.position.x + admin.width / 2,
      y: admin.position.y + admin.height - 4,
    };
    expect(projectAt(nodes, inside)).toBe('project:apps/admin');
    // Between frames, or anywhere without frames: none.
    expect(
      projectAt(nodes, { x: admin.position.x - 10, y: admin.position.y - 10 }),
    ).toBeUndefined();
    expect(projectAt(layoutFlow(golden('callers')).nodes, { x: 50, y: 50 })).toBeUndefined();
  });

  it('places frames apart, the apps before the library they call', () => {
    const drawn = frames(layoutFlow(golden('projects')).nodes);
    for (const a of drawn) {
      for (const b of drawn) if (a !== b) expect(apart(a, b), `${a.id} and ${b.id}`).toBe(true);
    }
    // In rows: a later one is to the right in the same row, or in a row below.
    const frame = (name: string) => drawn.find((f) => f.data.name === name) as ProjectFlowNode;
    const ui = frame('@acme/ui');
    for (const app of [frame('@acme/admin'), frame('@acme/shop')]) {
      const after =
        ui.position.y >= app.position.y + app.height ||
        (ui.position.y === app.position.y && ui.position.x >= app.position.x + app.width);
      expect(after, app.data.name).toBe(true);
    }
  });

  it('marks edges between projects', () => {
    expect(layoutFlow(golden('projects')).edges.map((e) => e.className)).toEqual([
      'edge-both edge-call edge-cross',
      'edge-both edge-call edge-cross',
    ]);
    const graph = synthetic(
      ['apps/a/x.ts#x!', 'apps/a/y.ts#y!', 'libs/b/z.ts#z!'],
      ['apps/a/x.ts#x>apps/a/y.ts#y', 'apps/a/y.ts#y>libs/b/z.ts#z'],
      [],
      [project(''), project('apps/a'), project('libs/b')],
    );
    expect(layoutFlow(graph).edges.map((e) => `${e.source} ${e.className}`)).toEqual([
      'apps/a/x.ts#x edge-both edge-call',
      'apps/a/y.ts#y edge-both edge-call edge-cross',
    ]);
  });

  it('puts a file in the project with the longest folder holding it', () => {
    const graph = synthetic(
      ['apps/web/a.ts#a!', 'apps/web-admin/b.ts#b!', 'apps/web/e2e/c.ts#c!', 'tools/d.ts#d!'],
      [],
      [],
      [project(''), project('apps/web'), project('apps/web-admin'), project('apps/web/e2e')],
    );
    const { nodes } = layoutFlow(graph);
    expect(
      files(nodes)
        .map((f) => `${f.data.label} in ${f.parentId ?? '-'} as ${f.data.local ?? '-'}`)
        .sort(),
    ).toEqual([
      'apps/web-admin/b.ts in project:apps/web-admin as b.ts',
      'apps/web/a.ts in project:apps/web as a.ts',
      'apps/web/e2e/c.ts in project:apps/web/e2e as c.ts',
      'tools/d.ts in project: as tools/d.ts',
    ]);
    expect(frames(nodes).find((f) => f.id === 'project:')?.data.name).toBe('repository root');
  });

  it('draws a package among the files of its main user, yet in no project', () => {
    // `x` uses three of React's exports, `z` one: React's box is drawn in `apps/a`'s frame, next
    // to its users as without frames; an edge to it never crosses projects.
    const react = ['useState', 'useEffect', 'useMemo'].map((name) => `react#${name}`);
    const graph = synthetic(
      ['apps/a/x.ts#x!', 'libs/b/z.ts#z!'],
      [
        'apps/a/x.ts#x>libs/b/z.ts#z',
        ...react.map((id) => `apps/a/x.ts#x>${id}`),
        'libs/b/z.ts#z>react#useState',
      ],
      [],
      [project('apps/a'), project('libs/b')],
    );
    const [first] = graph.nodes as [GraphNode];
    for (const id of react) {
      graph.nodes.push({
        ...first,
        id,
        name: id.slice(id.indexOf('#') + 1),
        kind: 'external',
        status: 'unchanged',
      });
    }
    const { nodes, edges } = layoutFlow(graph);
    const box = files(nodes).find((f) => f.id === 'group:package:react') as FileFlowNode;
    expect(box.parentId).toBe('project:apps/a');
    expect(box.data).toEqual({ label: 'package react', changed: false });
    const a = frames(nodes).find((f) => f.id === 'project:apps/a') as ProjectFlowNode;
    expect(box.position.x + box.width).toBeLessThan(a.width);
    expect(box.position.y + box.height).toBeLessThan(a.height);
    // Its symbols are no project's changes.
    expect(a.data.changed).toBe(1);
    expect(
      edges.filter((e) => e.target.startsWith('react#')).map((e) => e.className.includes('cross')),
    ).toEqual([false, false, false, false]);
  });

  it('draws one project as before: no frame, the same layout', () => {
    const callers = golden('callers');
    expect(
      layoutFlow({ ...callers, projects: [project(''), project('src'), project('docs')] }),
    ).toEqual(layoutFlow(callers));
    // The graph spans four projects, but focus draws one of them.
    const single = golden('projects');
    delete single.projects;
    const focus = new Set(['libs/ui/src/index.ts#button']);
    expect(layoutFlow(golden('projects'), { focus })).toEqual(layoutFlow(single, { focus }));
  });

  it('packs projects with no link between them into a page', () => {
    // Qwik's monorepo: each project's part of a change is an island.
    const graph = synthetic(
      Array.from({ length: 12 }, (_, i) => `packages/p${i}/src/index.ts#s${i}!`),
      [],
      [],
      Array.from({ length: 12 }, (_, i) => project(`packages/p${i}`)),
    );
    const drawn = frames(layoutFlow(graph).nodes);
    expect(drawn).toHaveLength(12);
    const width = Math.max(...drawn.map((f) => f.position.x + f.width));
    const height = Math.max(...drawn.map((f) => f.position.y + f.height));
    expect(width / height).toBeGreaterThan(0.6);
    expect(width / height).toBeLessThan(2.5);
  });

  it('says how many projects a summary spans, and draws its members in their frames', () => {
    const HUB = 'libs/hub/hub.ts#hub';
    const callers = Array.from(
      { length: 30 },
      (_, i) => `apps/${'abc'[i % 3]}/u${i}.ts#caller${i}`,
    );
    const graph = synthetic(
      [`${HUB}!`, ...callers],
      callers.map((c) => `${c}>${HUB}`),
      [],
      ['apps/a', 'apps/b', 'apps/c', 'libs/hub'].map((folder) => project(folder)),
    );
    const collapsed = layoutFlow(graph);
    expect(summaries(collapsed.nodes)[0]?.data).toEqual({
      of: HUB,
      side: 'users',
      count: 30,
      files: 30,
      projects: 3,
      expanded: false,
    });
    // Only the hub's project is drawn: no frame.
    expect(frames(collapsed.nodes)).toEqual([]);

    const open = layoutFlow(graph, { expanded: new Set([summaryId('users', HUB)]) });
    expect(
      frames(open.nodes)
        .map((f) => f.data.name)
        .sort(),
    ).toEqual(['apps/a', 'apps/b', 'apps/c', 'libs/hub']);
    for (const file of files(open.nodes)) {
      const folder = file.data.label.split('/').slice(0, 2).join('/');
      expect(file.parentId).toBe(`project:${folder}`);
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

  it("draws the selected symbol's edges above every node, taking no pointer, the rest untouched (V90)", () => {
    const { edges } = layoutFlow(golden('callers'));
    const decorated = decorateEdges(edges, 'src/math.ts#legacy');
    const raised = decorated.filter((e) => e.zIndex !== undefined);
    expect(raised.map((e) => `${e.source} → ${e.target}`).sort()).toEqual([
      'src/app.ts#old → src/math.ts#legacy',
      'src/math.ts#legacy → src/math.ts#add',
    ]);
    for (const e of raised) {
      expect(e.zIndex).toBe(RAISED_EDGE_Z);
      expect(e.className).toContain('edge-raised');
    }
    // Every other edge is the layout's own object: React Flow draws it again only if it changed.
    decorated.forEach((e, i) => {
      if (e.zIndex === undefined) expect(e).toBe(edges[i]);
    });
    // Above React Flow's selected node (1000 over its depth).
    expect(RAISED_EDGE_Z).toBeGreaterThanOrEqual(1000);
  });
});

describe("a node's marks (V90, decision 835)", () => {
  it('marks the kind of change: +, −, ~, moved; nothing on context', () => {
    expect(kindMark('added')).toEqual({ kind: 'added', glyph: '+' });
    expect(kindMark('removed')).toEqual({ kind: 'removed', glyph: '−' });
    expect(kindMark('modified')).toEqual({ kind: 'modified', glyph: '~' });
    expect(kindMark('moved')).toEqual({ kind: 'moved', glyph: null });
    expect(kindMark('context')).toBeNull();
    expect(kindMark('external')).toBeNull();
    expect(kindMark('unknown')).toBeNull();
  });

  it('counts findings once, in the worst severity', () => {
    expect(findingCount({ error: 0, warning: 0, info: 0 })).toBeNull();
    expect(findingCount({ error: 0, warning: 2, info: 1 })).toEqual({
      count: 3,
      severity: 'warning',
      words: '2 warnings, 1 info',
    });
    expect(findingCount({ error: 1, warning: 0, info: 0 })).toEqual({
      count: 1,
      severity: 'error',
      words: '1 error',
    });
    expect(findingCount({ error: 0, warning: 0, info: 2 })?.severity).toBe('info');
  });
});

describe('findings on the map (V100, decision 970)', () => {
  const finding = (
    id: string,
    symbol: string,
    severity: Finding['severity'],
    data: Record<string, unknown>,
  ): Finding => ({
    id,
    rule: 'signature-changed',
    severity,
    symbol,
    related: [],
    message: id,
    data,
  });
  const graph = synthetic(
    ['src/a.ts#warned!', 'src/a.ts#fine!', 'src/b.ts#fine!', 'src/c.ts#noted!', 'src/d.ts#plain!'],
    [],
    [
      finding('f1', 'src/a.ts#warned', 'warning', { compatibility: 'breaking', untouched: 2 }),
      finding('f2', 'src/a.ts#fine', 'info', { compatibility: 'compatible', untouched: 1 }),
      finding('f3', 'src/b.ts#fine', 'info', { compatibility: 'breaking', untouched: 0 }),
      finding('f4', 'src/c.ts#noted', 'info', { compatibility: 'breaking', untouched: 1 }),
    ],
  );
  const { nodes } = layoutFlow(graph);

  it("a file's name takes the worst severity the head counts; a settled change colours none", () => {
    const files = nodes.filter((n): n is FileFlowNode => n.type === 'file');
    expect(Object.fromEntries(files.map((f) => [f.data.label, f.data.severity ?? null]))).toEqual({
      'src/a.ts': 'warning',
      'src/b.ts': null,
      'src/c.ts': 'info',
      'src/d.ts': null,
    });
  });

  it("a box draws its symbols' counts at their cards' corners, for a finding the head counts", () => {
    const files = nodes.filter((n): n is FileFlowNode => n.type === 'file');
    const at = new Map(symbols(nodes).map((n) => [n.id, n]));
    const corner = (id: string) => {
      const card = at.get(id);
      return { x: (card?.position.x ?? NaN) + (card?.width ?? NaN), y: card?.position.y };
    };
    expect(Object.fromEntries(files.map((f) => [f.data.label, f.data.counts ?? null]))).toEqual({
      'src/a.ts': [
        { symbol: 'src/a.ts#warned', ...corner('src/a.ts#warned'), count: 1, severity: 'warning' },
      ],
      'src/b.ts': null,
      'src/c.ts': [
        { symbol: 'src/c.ts#noted', ...corner('src/c.ts#noted'), count: 1, severity: 'info' },
      ],
      'src/d.ts': null,
    });
    // A settled change keeps its count on its card only (decision 835).
    const settled = symbols(nodes).find((n) => n.id === 'src/b.ts#fine');
    expect(findingCount(settled?.data.findings ?? { error: 0, warning: 0, info: 0 })).toEqual({
      count: 1,
      severity: 'info',
      words: '1 info',
    });
  });
});

describe('layoutFlow: file edges for the map', () => {
  const file = (path: string) => `group:file:${path}`;
  const described = (edges: FlowEdge[]) =>
    edges.map((e) => [`${e.source} → ${e.target}`, e.className, e.data.count]);

  it('draws one edge per pair of linked file boxes, with how many it stands for', () => {
    // x calls y from two symbols and z once; y calls back; a call inside x's file is no file edge.
    const graph = synthetic(
      ['src/x.ts#x1!', 'src/x.ts#x2!', 'src/y.ts#y1!', 'src/y.ts#y2!', 'src/z.ts#z!'],
      [
        'src/x.ts#x1>src/y.ts#y1',
        'src/x.ts#x2>src/y.ts#y2',
        'src/x.ts#x1>src/z.ts#z',
        'src/y.ts#y1>src/x.ts#x2',
        'src/x.ts#x1>src/x.ts#x2',
      ],
    );
    // A pair's side is its edges' when they share one, else `both`.
    const sides = ['both', 'head', 'base', 'head', 'both'] as const;
    graph.edges = graph.edges.map((e, i) => ({ ...e, side: sides[i] ?? 'both' }));
    const { fileEdges, edges } = layoutFlow(graph);
    expect(described(fileEdges)).toEqual([
      [`${file('src/x.ts')} → ${file('src/y.ts')}`, 'edge-files edge-files-2 edge-both', 2],
      [`${file('src/x.ts')} → ${file('src/z.ts')}`, 'edge-files edge-files-1 edge-base', 1],
      [`${file('src/y.ts')} → ${file('src/x.ts')}`, 'edge-files edge-files-1 edge-head', 1],
    ]);
    expect(new Set(fileEdges.map((e) => e.id)).size).toBe(3);
    expect(fileEdges.every((e) => e.data.edge === null)).toBe(true);
    // The symbols' edges are unchanged.
    expect(edges).toHaveLength(5);
  });

  it('weighs a pair by its count', () => {
    const weight = (count: number) => {
      const users = Array.from({ length: count }, (_, i) => `src/u.ts#u${i}`);
      const graph = synthetic(
        ['src/hub.ts#hub!', ...users.map((u) => `${u}!`)],
        users.map((u) => `${u}>src/hub.ts#hub`),
      );
      return layoutFlow(graph).fileEdges.map((e) => e.className.split(' ')[1]);
    };
    expect([1, 2, 3, 4, 9, 10, 40].map(weight)).toEqual(
      [1, 2, 2, 3, 3, 4, 4].map((w) => [`edge-files-${w}`]),
    );
  });

  it('leaves summaries in their box, and marks pairs between projects', () => {
    // The hub's 30 users are one summary inside the hub's box: only a and b call across files.
    expect(described(layoutFlow(hubGraph()).fileEdges)).toEqual([
      [`${file('src/a.ts')} → ${file('src/small.ts')}`, 'edge-files edge-files-1 edge-both', 1],
      [`${file('src/b.ts')} → ${file('src/small.ts')}`, 'edge-files edge-files-1 edge-both', 1],
    ]);
    expect(layoutFlow(golden('projects')).fileEdges.map((e) => e.className)).toEqual([
      'edge-files edge-files-1 edge-both edge-cross',
      'edge-files edge-files-1 edge-both edge-cross',
    ]);
  });
});

describe('edgesToDraw', () => {
  // 21 × 20 calls between two files: more edges than a moving view draws.
  const a = Array.from({ length: 21 }, (_, i) => `src/a.ts#a${i}!`);
  const b = Array.from({ length: 20 }, (_, i) => `src/b.ts#b${i}!`);
  const large = layoutFlow(
    synthetic(
      [...a, ...b],
      a.flatMap((from) => b.map((to) => `${from.slice(0, -1)}>${to.slice(0, -1)}`)),
    ),
  );
  const A0 = 'src/a.ts#a0';
  const ids = (edges: FlowEdge[]) => edges.map((e) => e.id);
  const active = (edges: FlowEdge[]) => edges.filter((e) => e.className.includes('edge-active'));

  it('draws every symbol edge off the map, the selected ones standing out', () => {
    expect(large.edges.length).toBeGreaterThan(MOVING_EDGE_LIMIT);
    const still = edgesToDraw(large, { map: false, moving: false, selected: A0 });
    expect(ids(still)).toEqual(ids(large.edges));
    expect(active(still)).toHaveLength(20);
    // A small graph keeps them all while moving too.
    const small = layoutFlow(golden('callers'));
    expect(ids(edgesToDraw(small, { map: false, moving: true, selected: null }))).toEqual(
      ids(small.edges),
    );
  });

  it("while a large graph's view moves, draws only the selected symbol's edges", () => {
    const moving = edgesToDraw(large, { map: false, moving: true, selected: A0 });
    expect(moving).toHaveLength(20);
    expect(active(moving)).toHaveLength(20);
    expect(edgesToDraw(large, { map: false, moving: true, selected: null })).toEqual([]);
  });

  it("on the map, draws file pairs and the selected symbol's own edges", () => {
    const map = edgesToDraw(large, { map: true, moving: false, selected: A0 });
    expect(map.filter((e) => e.className.includes('edge-files'))).toEqual(large.fileEdges);
    expect(map).toHaveLength(large.fileEdges.length + 20);
    expect(active(map)).toHaveLength(20);
    expect(edgesToDraw(large, { map: true, moving: false, selected: null })).toEqual(
      large.fileEdges,
    );
    // Few enough to keep while moving: the limit counts what would be drawn.
    expect(edgesToDraw(large, { map: true, moving: true, selected: A0 })).toEqual(map);
  });
});

describe('the links a finding is about (V101, decisions 971–972)', () => {
  // `Shape`, an interface whose signature changed, is linked to its four users only by type
  // references: `area` and `Canvas.draw` unchanged, `perimeter` and `volume` added.
  const graph = golden('detectors');
  const SHAPE = 'src/shapes.ts#Shape';
  const USERS = [
    'src/shapes.ts#Canvas.draw',
    'src/shapes.ts#area',
    'src/shapes.ts#perimeter',
    'src/shapes.ts#volume',
  ];
  const pairs = (edges: readonly FlowEdge[]) =>
    edges.map((e) => `${e.source} → ${e.target}`).sort();
  const typeReferences = (edges: readonly FlowEdge[]) =>
    edges.filter((e) => e.className.includes('edge-type-reference'));
  const plain = layoutFlow(graph);

  it('Focus draws every user and its edge, the toggle off', () => {
    const focused = layoutFlow(
      graph,
      layoutView(graph, changeList(graph), {
        typeReferences: false,
        context: true,
        expanded: new Set(),
        focusOn: SHAPE,
        project: null,
      }),
    );
    expect(
      symbols(focused.nodes)
        .map((n) => n.id)
        .sort(),
    ).toEqual([...USERS, SHAPE].sort());
    expect(pairs(typeReferences(focused.edges))).toEqual(USERS.map((u) => `${u} → ${SHAPE}`));
  });

  it('outside Focus, carries the type references between drawn symbols, placing nothing by them', () => {
    expect(typeReferences(plain.edges)).toEqual([]);
    // Only between symbols drawn: `area` and `Canvas.draw` are not.
    expect(pairs(plain.hiddenEdges)).toEqual([
      `src/shapes.ts#perimeter → ${SHAPE}`,
      `src/shapes.ts#volume → ${SHAPE}`,
    ]);
    expect(plain.hiddenEdges.every((e) => e.className.includes('edge-type-reference'))).toBe(true);
    // The same layout as a graph without type references: they move nothing.
    const without = layoutFlow({
      ...graph,
      edges: graph.edges.filter((e) => e.kind !== 'type-reference'),
    });
    expect(plain.nodes).toEqual(without.nodes);
    expect(plain.edges).toEqual(without.edges);
    expect(plain.fileEdges).toEqual(without.fileEdges);
    // Shown by the toggle, none is left to carry.
    expect(layoutFlow(graph, { typeReferences: true }).hiddenEdges).toEqual([]);
  });

  it("a pick raises its own type references, and nobody else's", () => {
    const still = edgesToDraw(plain, { map: false, moving: false, selected: SHAPE });
    const raised = typeReferences(still);
    expect(pairs(raised)).toEqual(pairs(plain.hiddenEdges));
    for (const e of raised) {
      expect(e.zIndex).toBe(RAISED_EDGE_Z);
      expect(e.className).toContain('edge-raised');
    }
    expect(still).toHaveLength(plain.edges.length + 2);
    // `perimeter`'s one; none for a symbol without, nor with no pick.
    expect(
      pairs(
        typeReferences(edgesToDraw(plain, { map: false, moving: false, selected: USERS[2] ?? '' })),
      ),
    ).toEqual([`src/shapes.ts#perimeter → ${SHAPE}`]);
    expect(
      typeReferences(
        edgesToDraw(plain, { map: false, moving: false, selected: 'src/shapes.ts#tools' }),
      ),
    ).toEqual([]);
    expect(edgesToDraw(plain, { map: false, moving: false, selected: null })).toEqual(plain.edges);
    // On the map and while a small graph moves, as its other edges are.
    expect(
      pairs(typeReferences(edgesToDraw(plain, { map: true, moving: false, selected: SHAPE }))),
    ).toEqual(pairs(plain.hiddenEdges));
    expect(edgesToDraw(plain, { map: false, moving: true, selected: SHAPE })).toEqual(still);
  });

  it("while a large graph moves, hands over the pick's own edges only, as before", () => {
    // 21 × 20 calls between two files, and type references among the `b`s and to `a0`.
    const a = Array.from({ length: 21 }, (_, i) => `src/a.ts#a${i}`);
    const b = Array.from({ length: 20 }, (_, i) => `src/b.ts#b${i}`);
    const large = synthetic(
      [...a, ...b].map((id) => `${id}!`),
      [
        ...a.flatMap((from) => b.map((to) => `${from}>${to}`)),
        ...b.slice(1).map((from) => `${from}>src/b.ts#b0`),
        'src/b.ts#b0>src/a.ts#a0',
      ],
    );
    const calls = a.length * b.length;
    large.edges.forEach((e, i) => {
      if (i >= calls) e.kind = 'type-reference';
    });
    const layout = layoutFlow(large);
    expect(layout.edges.length).toBeGreaterThan(MOVING_EDGE_LIMIT);
    expect(layout.hiddenEdges).toHaveLength(20);
    // No pick: nothing while moving, as before.
    expect(edgesToDraw(layout, { map: false, moving: true, selected: null })).toEqual([]);
    // `a0`'s 20 calls and its one type reference; none of the other 19.
    const moving = edgesToDraw(layout, { map: false, moving: true, selected: 'src/a.ts#a0' });
    expect(moving).toHaveLength(21);
    expect(pairs(typeReferences(moving))).toEqual(['src/b.ts#b0 → src/a.ts#a0']);
    // Still, every call and the pick's type reference.
    expect(
      edgesToDraw(layout, { map: false, moving: false, selected: 'src/a.ts#a0' }),
    ).toHaveLength(calls + 1);
  });

  it("knows a pick's neighbours on the canvas: drawn, or in its own group", () => {
    const shown = onCanvas(plain, SHAPE);
    expect(shown.has(SHAPE)).toBe(true);
    expect(shown.has('src/shapes.ts#perimeter')).toBe(true);
    expect(shown.has('src/shapes.ts#area')).toBe(false);
    expect(shown.has('src/shapes.ts#Canvas.draw')).toBe(false);
    // `typed` names the type of `caller3`, one of `hub`'s 30 users grouped in its summary.
    const HUB = 'src/hub.ts#hub';
    const TYPED = 'src/typed.ts#typed';
    const graph = hubGraph();
    graph.nodes.push({ ...(graph.nodes[0] as GraphNode), id: TYPED, name: 'typed' });
    graph.edges.push({
      ...(graph.edges[0] as GraphEdge),
      id: 'typed',
      from: TYPED,
      to: 'src/user3.ts#caller3',
      kind: 'type-reference',
    });
    const layout = layoutFlow(graph);
    expect(layout.hidden.get('src/user3.ts#caller3')).toBe(summaryId('users', HUB));
    // In `hub`'s group, linked to it: picking it opens the group.
    expect(onCanvas(layout, HUB).has('src/user3.ts#caller3')).toBe(true);
    // In another symbol's group, with no line to `typed`: not on the canvas for it.
    expect(onCanvas(layout, TYPED).has('src/user3.ts#caller3')).toBe(false);
    expect(onCanvas(layout, TYPED).has(summaryId('users', HUB))).toBe(false);
  });
});

describe('a stylesheet as one card (V105, decision 979)', () => {
  const graph = () => sheetGraph(golden('callers'));
  const CARD = stylesheetId(PAGE_CSS);
  const cards = (nodes: FlowNode[]) =>
    nodes.filter((n): n is StylesheetFlowNode => n.type === 'stylesheet');
  const edgeOf = (layout: { edges: FlowEdge[] }, source: string, target: string) =>
    layout.edges.find((e) => e.source === source && e.target === target);

  it('draws a stylesheet of changed rules as one card in its box, with its counts', () => {
    const { nodes } = layoutFlow(graph());
    expect(cards(nodes).map((n) => [n.id, n.data])).toEqual([
      [
        CARD,
        {
          file: PAGE_CSS,
          name: 'Page.css',
          count: 10,
          kinds: { added: 6, modified: 3, removed: 1, moved: 0 },
          noun: 'rule',
          tone: 'modified',
          findings: { error: 1, warning: 0, info: 0 },
          symbols: [...RULE_IDS, GAP],
          changed: RULE_IDS,
          sameSince: false,
          expanded: false,
          reviewed: false,
          settled: false,
        },
      ],
    ]);
    // Its rules and the property of its own are in it, not drawn; its box holds only the card.
    const drawn = new Set(symbols(nodes).map((n) => n.id));
    for (const id of [...RULE_IDS, GAP]) expect(drawn.has(id), id).toBe(false);
    const box = nodes.find((n) => n.type === 'file' && n.data.label === PAGE_CSS);
    expect(nodes.filter((n) => 'parentId' in n && n.parentId === box?.id).map((n) => n.id)).toEqual(
      [CARD],
    );
    expect(cards(nodes)[0]?.parentId).toBe(box?.id);
  });

  it('links each user and each use to the card once, as many links as it stands for', () => {
    const layout = layoutFlow(graph());
    expect(edgeOf(layout, PAGE, CARD)).toMatchObject({
      className: 'edge-head edge-reference',
      data: { edge: null, count: 4 },
    });
    // An unchanged user of three rules: one in the base only, two in both.
    expect(edgeOf(layout, OTHER, CARD)).toMatchObject({
      className: 'edge-both edge-reference',
      data: { edge: null, count: 3 },
    });
    expect(edgeOf(layout, CARD, ACCENT)?.data).toEqual({ edge: null, count: 3 });
    expect(edgeOf(layout, CARD, LINE)?.data).toEqual({ edge: null, count: 1 });
    // Nothing else leads into or out of it: the link inside it (`.page` → `--gap`) is gone.
    expect(layout.edges.filter((e) => e.source === CARD || e.target === CARD)).toHaveLength(4);
    // The map's file pair counts every link the card's stand for.
    const pair = layout.fileEdges.find(
      (e) => e.source === 'group:file:src/Page.tsx' && e.target === `group:file:${PAGE_CSS}`,
    );
    expect(pair?.data.count).toBe(4);
  });

  it("draws a stylesheet with one changed rule as that rule, and an unchanged one's tokens", () => {
    const { nodes } = layoutFlow(graph());
    const drawn = new Set(symbols(nodes).map((n) => n.id));
    expect(drawn.has(ONLY)).toBe(true);
    expect(drawn.has(ACCENT)).toBe(true);
    expect(cards(nodes)).toHaveLength(1);
  });

  it('opens in place: its rules laid out as without the card, which stays to close them', () => {
    const layout = layoutFlow(graph(), { expanded: new Set([CARD]) });
    const drawn = new Set(symbols(layout.nodes).map((n) => n.id));
    for (const id of [...RULE_IDS, GAP]) expect(drawn.has(id), id).toBe(true);
    expect(cards(layout.nodes).map((n) => n.data.expanded)).toEqual([true]);
    expect(layout.edges.filter((e) => e.source === CARD || e.target === CARD)).toEqual([]);
    expect(edgeOf(layout, PAGE, rule('.page'))).toBeDefined();
    // Opening fits the card and what it shows.
    expect(layout.members.get(CARD)).toEqual([...RULE_IDS, GAP]);
    expect(layoutFlow(graph()).members.get(CARD)).toEqual([...RULE_IDS, GAP]);
  });

  it('groups the users of all its rules as a summary past the limit', () => {
    const g = graph();
    const users = Array.from({ length: 12 }, (_, i) => `src/view${i % 4}.tsx#View${i}`);
    for (const [i, id] of users.entries()) {
      g.nodes.push({ ...(g.nodes[1] as GraphNode), id, name: id.slice(id.indexOf('#') + 1) });
      g.edges.push({ ...(g.edges[0] as GraphEdge), id: `u${i}`, from: id, to: rule('.row') });
    }
    const { nodes } = layoutFlow(g);
    expect(summaries(nodes).map((n) => [n.id, n.data.of, n.data.count])).toEqual([
      [summaryId('users', CARD), CARD, 13],
    ]);
  });

  it('counts rules, variables, or symbols when they are of both kinds', () => {
    const rules = sheetGraph(golden('callers')).nodes.filter((n) => n.id.startsWith(PAGE_CSS));
    expect(stylesheetNoun(rules.filter((n) => n.kind === 'rule'))).toBe('rule');
    expect(stylesheetNoun(rules.filter((n) => n.kind === 'variable'))).toBe('variable');
    expect(stylesheetNoun(rules)).toBe('symbol');
  });

  it('folds only a file whose changed symbols are all stylesheet symbols', () => {
    const g = graph();
    const page = g.nodes.find((n) => n.id === rule('.page')) as GraphNode;
    page.language = 'typescript';
    expect(cards(layoutFlow(g).nodes)).toEqual([]);
  });

  it('counts the findings of its rules on the map, at its corner, and colours its file', () => {
    const { nodes } = layoutFlow(graph());
    const box = nodes.find(
      (n): n is FileFlowNode => n.type === 'file' && n.data.label === PAGE_CSS,
    );
    const card = cards(nodes)[0];
    expect(box?.data.severity).toBe('error');
    expect(box?.data.counts).toEqual([
      {
        symbol: CARD,
        x: (card?.position.x ?? 0) + (card?.width ?? 0),
        y: card?.position.y,
        count: 1,
        severity: 'error',
      },
    ]);
  });

  it('rings the card for a pick inside it, and marks it reviewed when every rule is', () => {
    const { nodes } = layoutFlow(graph());
    const picked = decorate(nodes, { selected: rule('.card') });
    expect(cards(picked)[0]?.selected).toBe(true);
    expect(drawnAs(nodes, rule('.card'))).toBe(CARD);
    expect(drawnAs(nodes, PAGE)).toBe(PAGE);
    expect(drawnAs(nodes, 'nowhere')).toBe('nowhere');
    // Untouched nodes keep their identity.
    expect(picked.filter((n, i) => n !== nodes[i]).map((n) => n.id)).toEqual([CARD]);

    const most = new Set(RULE_IDS.slice(1));
    expect(cards(decorate(nodes, { reviewed: most }))[0]?.data.reviewed).toBe(false);
    const all = new Set(RULE_IDS);
    expect(cards(decorate(nodes, { reviewed: all }))[0]?.data.reviewed).toBe(true);
  });

  it("puts a pick's links into the card on the canvas, and a pick in it the card's groups", () => {
    const layout = layoutFlow(graph());
    const shown = onCanvas(layout, PAGE);
    for (const id of ['.page', '.page-head', '.page-title', '.page-body']) {
      expect(shown.has(rule(id)), id).toBe(true);
    }
    // A rule's users grouped in its card's summary: linked to the card that holds the rule.
    const g = graph();
    const users = Array.from({ length: 12 }, (_, i) => `src/view${i % 4}.tsx#View${i}`);
    for (const [i, id] of users.entries()) {
      g.nodes.push({ ...(g.nodes[1] as GraphNode), id, name: id.slice(id.indexOf('#') + 1) });
      g.edges.push({ ...(g.edges[0] as GraphEdge), id: `u${i}`, from: id, to: rule('.row') });
    }
    const grouped = layoutFlow(g);
    expect(onCanvas(grouped, rule('.row')).has(users[0] as string)).toBe(true);
    expect(onCanvas(grouped, PAGE).has(users[0] as string)).toBe(false);
  });

  it('opens the card of a rule Focus is on', () => {
    const g = graph();
    const view = layoutView(g, changeList(g), {
      typeReferences: false,
      context: true,
      expanded: new Set(),
      focusOn: rule('.card'),
      project: null,
    });
    expect(view.expanded?.has(CARD)).toBe(true);
    expect(symbols(layoutFlow(g, view).nodes).some((n) => n.id === rule('.card'))).toBe(true);
  });
});

describe('a change with no stylesheet (V105)', () => {
  it('lays out exactly as before the stylesheet cards', async () => {
    // Recorded on main (f790c0c2) before V105: graphs with no stylesheet change, in each view.
    const graphs = {
      callers: golden('callers'),
      detectors: golden('detectors'),
      projects: golden('projects'),
      service: golden('service'),
      hub: hubGraph(),
    };
    const views = {
      default: {},
      'no context': { context: false },
      'type references': { typeReferences: true },
      'a group open': { expanded: new Set([summaryId('users', 'src/hub.ts#hub')]) },
    };
    const layouts: Record<string, unknown> = {};
    for (const [name, graph] of Object.entries(graphs)) {
      for (const [view, options] of Object.entries(views)) {
        layouts[`${name}, ${view}`] = layoutFlow(graph, options);
      }
    }
    // A symbol's graph node and an edge's graph edge by their ids: the graph's, not the layout's.
    const text = JSON.stringify(
      layouts,
      (key, value: unknown) =>
        value instanceof Map
          ? [...value]
          : (key === 'node' || key === 'edge') && value
            ? (value as { id: string }).id
            : value,
      1,
    );
    await expect(`${text}\n`).toMatchFileSnapshot('__snapshots__/layouts-without-stylesheets.json');
  });
});

describe('a box too dense for dagre', () => {
  it("is laid out in about square columns: a stylesheet's rules and tokens (Symbiote 3fff617)", () => {
    const rules = Array.from({ length: 60 }, (_, i) => `src/a.css#.rule${i}!`);
    const tokens = Array.from({ length: 20 }, (_, i) => `src/a.css#--token${i}!`);
    const edges = rules.flatMap((r) => tokens.map((t) => `${r.slice(0, -1)}>${t.slice(0, -1)}`));
    const { nodes } = layoutFlow(synthetic([...rules, ...tokens], edges));
    const columns = new Set(nodes.filter((n) => n.type === 'symbol').map((n) => n.position.x));
    // √(4 × 80) ≈ 18 rows: symbols are about four times wider than tall.
    expect(columns.size).toBe(Math.ceil(80 / 18));
  });
});
