import type { SymbolChange, Delta } from './diff.js';
import type { ChangedFile } from './git/changed-files.js';
import type { EdgeKind, Finding, Range, Site, SymbolDecl, SymbolId, SymbolKind } from './model.js';
import type { Analysis, ContextSymbol, SinceStatus } from './pipeline.js';

/** Version of the graph JSON contract. See docs/graph-schema.md. */
export const SCHEMA_VERSION = '0.3.0';

export interface GraphSide {
  file: string;
  range: Range;
  signature: string;
  hashes: { signature: string; body: string };
}

export interface GraphNode {
  id: SymbolId;
  kind: SymbolKind | 'module' | 'external' | 'unknown';
  name: string;
  container: SymbolId | null;
  language: string;
  exported: boolean;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  delta?: Delta;
  previousId: SymbolId | null;
  base: GraphSide | null;
  head: GraphSide | null;
  /** Changed symbols, when compared with an earlier version of the change. */
  since?: SinceStatus;
}

export interface GraphEdge {
  id: string;
  from: SymbolId;
  to: SymbolId;
  kind: EdgeKind;
  side: 'base' | 'head' | 'both';
  resolution: 'resolved' | 'unknown';
  sites: { base?: Site[]; head?: Site[] };
}

/** The pull/merge request being reviewed, when the graph comes from `cpr pr`. */
export interface GraphChangeRequest {
  forge: 'github' | 'gitlab';
  number: number;
  title: string;
  url: string;
  author: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
}

export interface Graph {
  schemaVersion: string;
  generator: { name: string; version: string };
  changeRequest?: GraphChangeRequest;
  revisions: Analysis['revisions'];
  /** The earlier version of the change the nodes' `since` compares with. */
  since?: { ref: string; sha: string; dropped: SymbolId[] };
  files: (ChangedFile & { ignored?: true })[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  findings: Finding[];
  stats: {
    filesChanged: number;
    symbols: { added: number; removed: number; modified: number; context: number };
    edges: number;
    durationMs?: number;
  };
  warnings: string[];
}

export interface BuildGraphOptions {
  generator: { name: string; version: string };
  /** Language of the analyzed symbols. Default: `typescript`. */
  language?: string;
  durationMs?: number;
  changeRequest?: GraphChangeRequest;
}

/** Turns an analysis into the versioned graph JSON contract. */
export function buildGraph(analysis: Analysis, options: BuildGraphOptions): Graph {
  const language = options.language ?? 'typescript';
  const changed = analysis.changes.filter((c) => c.status !== 'unchanged');
  const unchanged = new Map(
    analysis.changes.filter((c) => c.status === 'unchanged').map((c) => [c.id, c]),
  );
  const count = (status: SymbolChange['status']) =>
    changed.filter((c) => c.status === status).length;
  const ignored = new Set(analysis.ignored);

  return {
    schemaVersion: SCHEMA_VERSION,
    generator: options.generator,
    ...(options.changeRequest ? { changeRequest: options.changeRequest } : {}),
    revisions: analysis.revisions,
    ...(analysis.since
      ? {
          since: {
            ref: analysis.since.ref,
            sha: analysis.since.sha,
            dropped: analysis.since.dropped,
          },
        }
      : {}),
    files: analysis.files.map((file) =>
      ignored.has(file.path) ? { ...file, ignored: true } : file,
    ),
    nodes: [
      ...changed.map((change) => {
        const node = changeNode(change, language);
        const since = analysis.since?.symbols[change.id];
        return since ? { ...node, since } : node;
      }),
      ...analysis.context.map((context) =>
        contextNode(context, unchanged.get(context.id), language),
      ),
    ],
    edges: analysis.edges.map((edge, i) => ({
      id: `e${i + 1}`,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      side: edge.side,
      resolution: edge.resolution,
      sites: edge.sites,
    })),
    findings: analysis.findings,
    stats: {
      filesChanged: analysis.files.length,
      symbols: {
        added: count('added'),
        removed: count('removed'),
        modified: count('modified'),
        context: analysis.context.length,
      },
      edges: analysis.edges.length,
      ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    },
    warnings: analysis.warnings,
  };
}

function changeNode(change: SymbolChange, language: string): GraphNode {
  const symbol = (change.head ?? change.base) as SymbolDecl;
  return {
    id: change.id,
    kind: symbol.kind,
    name: symbol.name,
    container: symbol.container,
    language,
    exported: symbol.exported,
    status: change.status,
    ...(change.delta ? { delta: change.delta } : {}),
    previousId: change.previousId,
    base: side(change.base),
    head: side(change.head),
  };
}

/** Context nodes carry the side(s) they were resolved on; special nodes carry none. */
function contextNode(
  context: ContextSymbol,
  both: SymbolChange | undefined,
  language: string,
): GraphNode {
  const decl = context.decl;
  const local = context.id.slice(context.id.indexOf('#') + 1);
  return {
    id: context.id,
    kind: context.kind,
    name:
      decl?.name ??
      (context.kind === 'module' ? context.id.slice(0, context.id.indexOf('#')) : local),
    container: decl?.container ?? null,
    language,
    exported: decl?.exported ?? false,
    status: 'unchanged',
    previousId: null,
    base: side(both?.base ?? null),
    head: side(both?.head ?? decl),
  };
}

function side(decl: SymbolDecl | null): GraphSide | null {
  if (!decl) return null;
  return { file: decl.file, range: decl.range, signature: decl.signature, hashes: decl.hashes };
}
