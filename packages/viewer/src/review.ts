import type { Graph, GraphNode } from '@cpr/core';

export interface FileChanges {
  file: string;
  symbols: GraphNode[];
}

/** Changed symbols in reading order: by file, then by position in the file. */
export function changeList(graph: Graph): FileChanges[] {
  const changed = graph.nodes.filter((n) => n.status !== 'unchanged');
  const byFile = new Map<string, GraphNode[]>();
  for (const node of changed) {
    const file = (node.head ?? node.base)?.file ?? node.id.slice(0, node.id.indexOf('#'));
    byFile.set(file, [...(byFile.get(file) ?? []), node]);
  }
  const line = (n: GraphNode) => (n.head ?? n.base)?.range.start.line ?? 0;
  return [...byFile]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, symbols]) => ({ file, symbols: symbols.sort((a, b) => line(a) - line(b)) }));
}

/** The next (or previous) changed symbol after `current`, wrapping around. */
export function stepChange(
  list: FileChanges[],
  current: string | null,
  direction: 1 | -1,
): string | null {
  const ids = list.flatMap((f) => f.symbols.map((s) => s.id));
  if (ids.length === 0) return null;
  const index = current === null ? -1 : ids.indexOf(current);
  if (index === -1) return direction === 1 ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null);
  return ids[(index + direction + ids.length) % ids.length] ?? null;
}

/** A symbol and everything within `hops` edges of it, in either direction. */
export function neighbourhood(graph: Graph, id: string, hops = 1): Set<string> {
  const ids = new Set([id]);
  let frontier = [id];
  for (let hop = 0; hop < hops; hop++) {
    const next: string[] = [];
    for (const edge of graph.edges) {
      for (const [a, b] of [
        [edge.from, edge.to],
        [edge.to, edge.from],
      ] as const) {
        if (frontier.includes(a) && !ids.has(b)) {
          ids.add(b);
          next.push(b);
        }
      }
    }
    frontier = next;
  }
  return ids;
}

/** Where reviewed marks are kept: per pair of revisions, so a new push starts fresh. */
export function reviewKey(graph: Graph): string {
  const { base, head } = graph.revisions;
  return `cpr:reviewed:${base.sha ?? base.ref}..${head.sha ?? head.ref}`;
}

export function loadReviewed(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveReviewed(key: string, reviewed: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...reviewed]));
  } catch {
    // Private windows and blocked storage: marks last for this session only.
  }
}
