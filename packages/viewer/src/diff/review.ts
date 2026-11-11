import type { Finding, Graph, GraphNode, GraphSide, Project, Severity } from '@symbiote/core';
import { label, settled, type LayoutOptions } from '../graph/flow.js';
import { projectOf } from '../graph/projects.js';
import { plural } from '../ui/plural.js';

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

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Settled signature changes of one project, folded into one row of the Findings tab (V100). */
export interface FindingFold {
  /** None when the graph names no project for them. */
  project?: Project;
  findings: Finding[];
}

/**
 * The Findings tab's rows (V100, decision 969): the findings to list, worst severity first, and
 * the settled signature changes (`settled`: compatible, or every user updated) folded one row per
 * project, in folder order, below them. The head counts the listed ones (968).
 */
export function foldFindings(
  findings: readonly Finding[],
  projects: readonly Project[] = [],
): { shown: Finding[]; folds: FindingFold[] } {
  const byId = (a: Finding, b: Finding) => a.id.localeCompare(b.id, 'en', { numeric: true });
  const shown = findings
    .filter((f) => !settled(f))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || byId(a, b));
  const folds = new Map<string, FindingFold>();
  for (const finding of findings.filter(settled).sort(byId)) {
    const file = finding.symbol.slice(0, finding.symbol.indexOf('#'));
    const project = projectOf(file, projects);
    const key = project?.folder ?? '';
    const fold = folds.get(key) ?? { ...(project ? { project } : {}), findings: [] };
    fold.findings.push(finding);
    folds.set(key, fold);
  }
  return {
    shown,
    folds: [...folds].sort(([a], [b]) => a.localeCompare(b)).map(([, fold]) => fold),
  };
}

/** The head's pills (V100, decision 968): each severity listed, its count, infos as "notes". */
export function findingPills(
  shown: readonly Finding[],
): { severity: Severity; count: number; words: string }[] {
  const words = { error: 'error', warning: 'warning', info: 'note' } as const;
  return (['error', 'warning', 'info'] as const)
    .map((severity) => {
      const count = shown.filter((f) => f.severity === severity).length;
      return { severity, count, words: plural(count, words[severity]) };
    })
    .filter((pill) => pill.count > 0);
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

/** The page's choices that make the view to lay out. */
export interface ViewChoice {
  typeReferences: boolean;
  context: boolean;
  expanded: ReadonlySet<string>;
  /** The symbol Focus is on: Focus is on and a symbol picked. */
  focusOn: string | null;
  /** The one project shown (by folder), or null. */
  project: string | null;
}

/**
 * The view to lay out. Focus on a symbol narrows further than one project, and lays out every
 * kind of link in its neighbourhood, type references whatever the toggle (V101, decision 971):
 * the links the panel lists, and a finding speaks of. It changes no other view.
 */
export function layoutView(graph: Graph, list: FileChanges[], choice: ViewChoice): LayoutOptions {
  const { typeReferences, context, expanded, focusOn, project } = choice;
  if (focusOn !== null) {
    return { typeReferences: true, context, expanded, focus: neighbourhood(graph, focusOn) };
  }
  const focus = project === null ? undefined : projectNeighbourhood(graph, list, project);
  return { typeReferences, context, expanded, ...(focus ? { focus } : {}) };
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

/**
 * Reviewed marks: symbol ID → its fingerprint when it was marked; a file viewed on the Files page,
 * `file:<path>` → its blob when it was (V90, decision 843).
 */
export type Marks = Readonly<Record<string, string>>;

const FILE_MARK = 'file:';

/** Whether `file` was marked viewed at the blob it has now. */
export function fileViewed(marks: Marks, file: { path: string; blob?: string }): boolean {
  return file.blob !== undefined && marks[`${FILE_MARK}${file.path}`] === file.blob;
}

/**
 * Marks `file` viewed at its blob, or unmarks it; a file viewed at another blob (changed since) is
 * marked again at this one. A file git gave no blob for cannot be marked.
 */
export function toggleFileMark(marks: Marks, file: { path: string; blob?: string }): Marks {
  if (file.blob === undefined) return marks;
  const key = `${FILE_MARK}${file.path}`;
  const next: Record<string, string> = { ...marks };
  if (marks[key] === file.blob) delete next[key];
  else next[key] = file.blob;
  return next;
}

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

/**
 * Marks or unmarks a symbol; marks of symbols no longer in the change are dropped, files' viewed
 * marks kept (the Files page keeps them).
 */
export function toggleMark(graph: Graph, marks: Marks, id: string): Marks {
  const changed = new Map(
    graph.nodes.filter((n) => n.status !== 'unchanged').map((n) => [n.id, n]),
  );
  const node = changed.get(id);
  if (!node) return marks;
  const next: Record<string, string> = {};
  for (const [key, mark] of Object.entries(marks)) {
    if (changed.has(key) || key.startsWith(FILE_MARK)) next[key] = mark;
  }
  if (marks[id] === fingerprint(node)) delete next[id];
  else next[id] = fingerprint(node);
  return next;
}
