import type { Graph, GraphNode, GraphSide } from '@cpr/core';

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

/**
 * What a symbol's change looks like: the hashes of both its versions. A push that alters the
 * change of a symbol (its code, or its base after a rebase) alters this.
 */
export function fingerprint(node: GraphNode): string {
  const side = (decl: GraphSide | null) =>
    decl ? `${decl.hashes.signature}.${decl.hashes.body}` : '-';
  return `${side(node.base)}|${side(node.head)}`;
}

/** Reviewed marks: symbol ID → its fingerprint when it was marked. */
export type Marks = Readonly<Record<string, string>>;

/**
 * Where review state is kept: per change request under `cpr pr`, so it outlives new pushes;
 * otherwise per pair of revisions.
 */
export function reviewKey(graph: Graph, kind: 'review' | 'drafts' = 'review'): string {
  if (graph.changeRequest) return `cpr:${kind}:${graph.changeRequest.url}`;
  const { base, head } = graph.revisions;
  return `cpr:${kind}:${base.sha ?? base.ref}..${head.sha ?? head.ref}`;
}

export interface ReviewStatus {
  reviewed: Set<string>;
  /** Marked reviewed, but the symbol changed since. */
  stale: Set<string>;
}

export function reviewStatus(graph: Graph, marks: Marks): ReviewStatus {
  const status: ReviewStatus = { reviewed: new Set(), stale: new Set() };
  for (const node of graph.nodes) {
    const mark = marks[node.id];
    if (node.status === 'unchanged' || mark === undefined) continue;
    (mark === fingerprint(node) ? status.reviewed : status.stale).add(node.id);
  }
  return status;
}

/** Marks or unmarks a symbol; marks of symbols no longer in the change are dropped. */
export function toggleMark(graph: Graph, marks: Marks, id: string): Marks {
  const changed = new Map(
    graph.nodes.filter((n) => n.status !== 'unchanged').map((n) => [n.id, n]),
  );
  const node = changed.get(id);
  if (!node) return marks;
  const next: Record<string, string> = {};
  for (const [key, mark] of Object.entries(marks)) if (changed.has(key)) next[key] = mark;
  if (marks[id] === fingerprint(node)) delete next[id];
  else next[id] = fingerprint(node);
  return next;
}
