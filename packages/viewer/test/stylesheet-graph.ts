import type { Finding, Graph, GraphEdge, GraphNode } from '@symbiote/core';

/**
 * A change with a stylesheet of 10 changed rules (V105): `src/ui/Page.css`, 6 added, 3 modified,
 * 1 removed, and an unchanged custom property of its own; a component that changed renders 4 of
 * its rules, one that did not renders 3 (one removed, still rendered: an error); the rules read 2
 * tokens of an unchanged `base.css`. `src/single.css` has one changed rule.
 */
export const PAGE_CSS = 'src/ui/Page.css';
export const SINGLE_CSS = 'src/single.css';
export const PAGE = 'src/Page.tsx#Page';
export const OTHER = 'src/Other.tsx#Other';
export const ACCENT = 'src/ui/base.css#:root › --accent';
export const LINE = 'src/ui/base.css#:root › --line';
export const GAP = `${PAGE_CSS}#:root › --gap`;
export const ONLY = `${SINGLE_CSS}#.only`;

/** Page.css's changed rules in the order of their lines, with how each changed. */
export const RULES: [string, GraphNode['status']][] = [
  ['.page', 'added'],
  ['.page-head', 'added'],
  ['.page-title', 'added'],
  ['.page-body', 'added'],
  ['.row', 'added'],
  ['.row:hover', 'added'],
  ['.card', 'modified'],
  ['.card-head', 'modified'],
  ['.badge', 'modified'],
  ['.legacy', 'removed'],
];

export const rule = (name: string) => `${PAGE_CSS}#${name}`;

/** Every changed rule of Page.css, in line order. */
export const RULE_IDS = RULES.map(([name]) => rule(name));

const side = (file: string, line: number, body = 'b') => ({
  file,
  range: { start: { line, col: 1 }, end: { line: line + 3, col: 2 } },
  signature: '',
  hashes: { signature: 's', body },
});

function node(
  id: string,
  status: GraphNode['status'],
  line: number,
  kind: GraphNode['kind'] = 'rule',
): GraphNode {
  const file = id.slice(0, id.indexOf('#'));
  const language = file.endsWith('.css') ? 'css' : 'typescript';
  return {
    id,
    kind,
    name: id.slice(id.indexOf('#') + 1),
    container: null,
    language,
    exported: true,
    status,
    previousId: null,
    base: status === 'added' ? null : side(file, line, status === 'modified' ? 'old' : 'b'),
    head: status === 'removed' ? null : side(file, line),
  };
}

function edge(from: string, to: string, side: GraphEdge['side'] = 'both'): GraphEdge {
  return {
    id: `${from} > ${to}`,
    from,
    to,
    kind: 'reference',
    side,
    resolution: 'resolved',
    sites: {},
  };
}

/** The change, on top of `base`'s revisions; more nodes, edges and findings may be added. */
export function sheetGraph(base: Graph): Graph {
  const nodes = [
    node(PAGE, 'modified', 3, 'function'),
    node(OTHER, 'unchanged', 3, 'function'),
    ...RULES.map(([name, status], i) => node(rule(name), status, 1 + 4 * i)),
    node(GAP, 'unchanged', 41, 'variable'),
    node(ACCENT, 'unchanged', 2, 'variable'),
    node(LINE, 'unchanged', 3, 'variable'),
    node(ONLY, 'modified', 1),
  ];
  const edges = [
    ...['.page', '.page-head', '.page-title', '.page-body'].map((r) => edge(PAGE, rule(r), 'head')),
    edge(OTHER, rule('.row')),
    edge(OTHER, rule('.badge')),
    edge(OTHER, rule('.legacy'), 'base'),
    ...['.card', '.card-head', '.badge'].map((r) => edge(rule(r), ACCENT)),
    edge(rule('.row'), LINE, 'head'),
    edge(rule('.page'), GAP, 'head'),
    edge(ONLY, ACCENT),
  ];
  const findings: Finding[] = [
    {
      id: 'legacy-used',
      rule: 'removed-still-referenced',
      severity: 'error',
      symbol: rule('.legacy'),
      related: [OTHER],
      message: '.legacy was removed but is still used by 1 symbol: Other',
      data: {},
    },
  ];
  return { ...base, nodes, edges, findings };
}
