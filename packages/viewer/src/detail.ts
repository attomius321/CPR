import { diffLines } from 'diff';
import type { Finding, Graph, GraphEdge, GraphNode, Range } from '@cpr/core';

export interface Neighbour {
  id: string;
  kind: GraphEdge['kind'];
  side: GraphEdge['side'];
  node: GraphNode | undefined;
}

export interface SymbolDetail {
  node: GraphNode;
  /** Who references this symbol. */
  users: Neighbour[];
  /** What this symbol references. */
  callees: Neighbour[];
  /** Findings about this symbol. */
  findings: Finding[];
  /** Findings about other symbols that list this one (e.g. as an untouched caller). */
  mentions: Finding[];
}

export function symbolDetail(graph: Graph, id: string): SymbolDetail | undefined {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = nodes.get(id);
  if (!node) return undefined;
  const neighbour = (other: string, edge: GraphEdge): Neighbour => ({
    id: other,
    kind: edge.kind,
    side: edge.side,
    node: nodes.get(other),
  });
  const order = (a: Neighbour, b: Neighbour) =>
    a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind);
  return {
    node,
    users: graph.edges
      .filter((e) => e.to === id && e.from !== id)
      .map((e) => neighbour(e.from, e))
      .sort(order),
    callees: graph.edges
      .filter((e) => e.from === id && e.to !== id)
      .map((e) => neighbour(e.to, e))
      .sort(order),
    findings: graph.findings.filter((f) => f.symbol === id),
    mentions: graph.findings.filter((f) => f.symbol !== id && f.related.includes(id)),
  };
}

export interface Excerpt {
  /** 1-based number of the first line. */
  firstLine: number;
  text: string;
}

/** The whole lines a range covers, without their common indentation. */
export function excerpt(source: string, range: Range): Excerpt {
  const lines = source.split('\n').slice(range.start.line - 1, range.end.line);
  const indents = lines
    .filter((l) => l.trim() !== '')
    .map((l) => /^[\t ]*/.exec(l)?.[0].length ?? 0);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  return { firstLine: range.start.line, text: lines.map((l) => l.slice(common)).join('\n') };
}

export interface DiffRow {
  type: 'same' | 'add' | 'del';
  text: string;
  /** Line numbers in base / head. */
  base?: number;
  head?: number;
}

/** A unified line diff of a symbol's two versions; one side may be missing (added/removed). */
export function diffRows(base: Excerpt | undefined, head: Excerpt | undefined): DiffRow[] {
  const rows: DiffRow[] = [];
  let baseLine = base?.firstLine ?? 0;
  let headLine = head?.firstLine ?? 0;
  for (const part of diffLines(withNewline(base?.text), withNewline(head?.text))) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    for (const text of lines) {
      if (part.added) rows.push({ type: 'add', text, head: headLine++ });
      else if (part.removed) rows.push({ type: 'del', text, base: baseLine++ });
      else rows.push({ type: 'same', text, base: baseLine++, head: headLine++ });
    }
  }
  return rows;
}

function withNewline(text: string | undefined): string {
  return text === undefined ? '' : `${text}\n`;
}
