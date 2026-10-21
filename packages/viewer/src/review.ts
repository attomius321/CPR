import type { Graph, GraphNode, GraphSide, Project } from '@symbiote/core';
import { label } from './flow.js';
import { projectOf } from './projects.js';

export interface FileChanges {
  file: string;
  symbols: GraphNode[];
  /** The file's app or library, when the changes span two or more. */
  project?: Project;
}

/** The files of one project in the change list (of the whole list, when it is not grouped). */
export interface ProjectChanges {
  project?: Project;
  files: FileChanges[];
}

/**
 * Changed symbols in reading order: by file, then by position in the file. When the files belong
 * to two or more of the graph's projects, by project first (in folder order), each file with it.
 */
export function changeList(graph: Graph, { sinceOnly = false } = {}): FileChanges[] {
  // With `--since`, symbols changed the same way as in the earlier version can be left out.
  const changed = graph.nodes.filter(
    (n) => n.status !== 'unchanged' && !(sinceOnly && n.since === 'same'),
  );
  const byFile = new Map<string, GraphNode[]>();
  for (const node of changed) {
    const file = (node.head ?? node.base)?.file ?? node.id.slice(0, node.id.indexOf('#'));
    byFile.set(file, [...(byFile.get(file) ?? []), node]);
  }
  const line = (n: GraphNode) => (n.head ?? n.base)?.range.start.line ?? 0;
  const list: FileChanges[] = [...byFile]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, symbols]) => ({ file, symbols: symbols.sort((a, b) => line(a) - line(b)) }));

  const projects = graph.projects ?? [];
  const held = list.map((f) => projectOf(f.file, projects));
  if (new Set(held.filter(Boolean)).size < 2) return list;
  return list
    .map((f, i) => {
      const project = held[i];
      return project ? { ...f, project } : f;
    })
    .sort((a, b) => (a.project?.folder ?? '').localeCompare(b.project?.folder ?? ''));
}

/** The list cut where the project changes; one group without a project when not grouped. */
export function byProject(list: FileChanges[]): ProjectChanges[] {
  const groups: ProjectChanges[] = [];
  for (const file of list) {
    const last = groups[groups.length - 1];
    if (last && last.project === file.project) last.files.push(file);
    else groups.push({ ...(file.project ? { project: file.project } : {}), files: [file] });
  }
  return groups;
}

/**
 * The changes a search shows: those whose project, file and name hold every word of `query`,
 * ignoring case. A word that matches the file (or project) keeps all of its symbols ("user greet").
 */
export function filterChanges(list: FileChanges[], query: string): FileChanges[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return list;
  return list
    .map((f) => ({
      ...f,
      symbols: f.symbols.filter((node) => {
        const text = `${f.project?.name ?? ''} ${f.file} ${label(node)}`.toLowerCase();
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((f) => f.symbols.length > 0);
}

/** The changes of the project at `folder`; all of them when `folder` is null. */
export function onlyProject(list: FileChanges[], folder: string | null): FileChanges[] {
  return folder === null ? list : list.filter((f) => f.project?.folder === folder);
}

/** The changes outside the projects collapsed in the list (by folder): what j/k walk. */
export function withoutCollapsed(
  list: FileChanges[],
  collapsed: ReadonlySet<string>,
): FileChanges[] {
  if (collapsed.size === 0) return list;
  return list.filter((f) => !f.project || !collapsed.has(f.project.folder));
}

/** The project after (or before) `current` in the list, then null (all), wrapping around. */
export function nextProject(
  list: FileChanges[],
  current: string | null,
  direction: 1 | -1,
): string | null {
  const folders: (string | null)[] = [null];
  for (const { project } of byProject(list)) if (project) folders.push(project.folder);
  const index = Math.max(0, folders.indexOf(current));
  return folders[(index + direction + folders.length) % folders.length] ?? null;
}

/**
 * A project's changed symbols and everything one edge away, in it or in another project: the
 * impact across its boundary stays in view.
 */
export function projectNeighbourhood(
  graph: Graph,
  list: FileChanges[],
  folder: string,
): Set<string> {
  const ids = new Set(onlyProject(list, folder).flatMap((f) => f.symbols.map((s) => s.id)));
  const near = new Set(ids);
  for (const edge of graph.edges) {
    if (ids.has(edge.from)) near.add(edge.to);
    if (ids.has(edge.to)) near.add(edge.from);
  }
  return near;
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
 * Where review state is kept: per change request under `symbiote pr`, so it outlives new pushes;
 * otherwise per pair of revisions.
 */
export function reviewKey(graph: Graph, kind: 'review' | 'drafts' = 'review'): string {
  if (graph.changeRequest) return `symbiote:${kind}:${graph.changeRequest.url}`;
  const { base, head } = graph.revisions;
  return `symbiote:${kind}:${base.sha ?? base.ref}..${head.sha ?? head.ref}`;
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
