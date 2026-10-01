import { resolve } from 'node:path';
import type { LanguageAdapter, LoadOptions } from './adapter.js';
import { linkNodeModules } from './deps.js';
import { runDetectors } from './detectors.js';
import { changeFingerprint, diffSymbols, type SymbolChange } from './diff.js';
import { listChangedFilesInDirectories } from './fs-diff.js';
import { listChangedFiles, type ChangedFile } from './git/changed-files.js';
import { openRepo } from './git/repo.js';
import { resolveRevisions } from './git/revisions.js';
import { checkoutRevision } from './git/worktree.js';
import { loadIgnores } from './ignore.js';
import { typescriptAdapter } from './lang/typescript/index.js';
import type { GitRepo } from './git/repo.js';
import type {
  Edge,
  EdgeRef,
  Exposure,
  Finding,
  SymbolDecl,
  SymbolId,
  SymbolKind,
} from './model.js';
import { directorySource, type RevisionSource } from './revision.js';

/** What was compared. `sha` and `from` are null when comparing folders. */
export interface RevisionsInfo {
  base: { ref: string; sha: string | null; mergeBase: string | null };
  head: { ref: string; sha: string | null };
  from: string | null;
}

/** An unchanged symbol, package export, dynamic target or top-level code next to a change. */
export interface ContextSymbol {
  id: SymbolId;
  kind: SymbolKind | 'module' | 'external' | 'unknown';
  /** The declaration, for repo symbols (from head when it exists there). */
  decl: SymbolDecl | null;
}

/** How a symbol's change compares with an earlier version of the same change. */
export type SinceStatus = 'new' | 'updated' | 'same';

/** The comparison with an earlier version of the change (`since`). */
export interface SinceInfo {
  ref: string;
  sha: string;
  /** Every changed symbol: changed only now, changed differently, or changed the same way. */
  symbols: Record<SymbolId, SinceStatus>;
  /** Symbols that version changed and this one no longer does. */
  dropped: SymbolId[];
}

export interface Analysis {
  revisions: RevisionsInfo;
  /** Present when compared with an earlier version of the change. */
  since?: SinceInfo;
  files: ChangedFile[];
  changes: SymbolChange[];
  edges: Edge[];
  context: ContextSymbol[];
  findings: Finding[];
  /** Changed files left out of symbol analysis (`.cprignore` and default ignores). */
  ignored: string[];
  warnings: string[];
  /** Milliseconds per phase, for performance work. */
  timings: Record<string, number>;
}

export interface AnalyzeOptions extends Omit<LoadOptions, 'files'> {
  /** Default: the TypeScript adapter. */
  adapter?: LanguageAdapter;
  /** Hops of unchanged context around changed symbols. Default: 1. */
  depth?: number;
}

/** Stop widening context past this many symbols. */
const MAX_CONTEXT = 2000;

export interface AnalyzeGitOptions extends AnalyzeOptions {
  cwd: string;
  base: string;
  head: string;
  /** Compare against merge-base(base, head). Default: true. */
  mergeBase?: boolean;
  /** Worktree cache root. Default: the platform cache folder. */
  cacheDir?: string;
  /**
   * An earlier head of the same change (before a push or rebase): each changed symbol is then
   * marked new, updated or the same compared with merge-base(base, since)..since.
   */
  since?: string;
}

/** Compares two git revisions of the repository containing `cwd`. */
export async function analyzeGit(options: AnalyzeGitOptions): Promise<Analysis> {
  const repo = await openRepo(options.cwd);
  const revisions = await resolveRevisions(repo, options.base, options.head, {
    ...(options.mergeBase === undefined ? {} : { mergeBase: options.mergeBase }),
  });
  const files = await listChangedFiles(repo, revisions.from, revisions.head.sha);
  const analysis: Analysis = files.some((file) =>
    isRelevant(file, options.adapter ?? typescriptAdapter),
  )
    ? {
        revisions,
        files,
        ...(await withCheckouts(repo, revisions.from, revisions.head.sha, options, (base, head) =>
          analyzeSources(base, head, files, options),
        )),
      }
    : { revisions, files, ...EMPTY };

  if (options.since !== undefined) {
    const started = performance.now();
    analysis.since = await compareSince(repo, analysis, options.since, options);
    analysis.timings.since = Math.round(performance.now() - started);
  }
  return analysis;
}

/** Checks out both revisions (with the user's dependencies linked) for the time of `work`. */
async function withCheckouts<T>(
  repo: GitRepo,
  baseSha: string,
  headSha: string,
  options: AnalyzeGitOptions,
  work: (base: RevisionSource, head: RevisionSource) => Promise<T>,
): Promise<T> {
  const checkout = (sha: string, role: string) =>
    checkoutRevision(repo, sha, {
      role,
      ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
    });
  const base = await checkout(baseSha, 'base');
  try {
    const head = await checkout(headSha, 'head');
    try {
      // Slots have no installed dependencies; borrow the user's.
      await linkNodeModules(repo.root, base.root);
      await linkNodeModules(repo.root, head.root);
      return await work(base, head);
    } finally {
      await head.dispose();
    }
  } finally {
    await base.dispose();
  }
}

/**
 * Compares each changed symbol with the earlier version of the change: that version's symbols
 * are only extracted (no references), with the same inference rules, so equal code hashes equal.
 */
async function compareSince(
  repo: GitRepo,
  analysis: Analysis,
  since: string,
  options: AnalyzeGitOptions,
): Promise<SinceInfo> {
  const earlier = await resolveRevisions(repo, options.base, since, { mergeBase: true });
  const files = await listChangedFiles(repo, earlier.from, earlier.head.sha);
  const changes = files.some((file) => isRelevant(file, options.adapter ?? typescriptAdapter))
    ? await withCheckouts(repo, earlier.from, earlier.head.sha, options, async (base, head) => {
        const extracted = await extractChanges(base, head, files, options);
        return extracted?.changes ?? [];
      })
    : [];
  const before = new Map(
    changes.filter((c) => c.status !== 'unchanged').map((c) => [c.id, changeFingerprint(c)]),
  );

  const symbols: Record<SymbolId, SinceStatus> = {};
  for (const change of analysis.changes) {
    if (change.status === 'unchanged') continue;
    const print = before.get(change.id);
    symbols[change.id] =
      print === undefined ? 'new' : print === changeFingerprint(change) ? 'same' : 'updated';
    before.delete(change.id);
  }
  return { ref: since, sha: earlier.head.sha, symbols, dropped: [...before.keys()].sort() };
}

/** Compares two folders, e.g. test fixtures. */
export async function analyzeDirectories(
  baseDir: string,
  headDir: string,
  options: AnalyzeOptions = {},
): Promise<Analysis> {
  const base = directorySource(baseDir);
  const head = directorySource(headDir);
  const files = await listChangedFilesInDirectories(base.root, head.root);
  return {
    revisions: {
      base: { ref: resolve(baseDir), sha: null, mergeBase: null },
      head: { ref: resolve(headDir), sha: null },
      from: null,
    },
    files,
    ...(await analyzeSources(base, head, files, options)),
  };
}

type SourceAnalysis = Pick<
  Analysis,
  'changes' | 'edges' | 'context' | 'findings' | 'ignored' | 'warnings' | 'timings'
>;

const EMPTY: SourceAnalysis = {
  changes: [],
  edges: [],
  context: [],
  findings: [],
  ignored: [],
  warnings: [],
  timings: {},
};

interface Extracted<L = unknown> {
  adapter: LanguageAdapter<L>;
  baseRev: L;
  headRev: L;
  relevant: ChangedFile[];
  ignored: string[];
  changes: SymbolChange[];
  timings: Record<string, number>;
}

/**
 * Loads both revisions and extracts and diffs the symbols of the changed files. Undefined when
 * no changed file is analyzable (`ignored` still applies).
 */
async function extractChanges(
  base: RevisionSource,
  head: RevisionSource,
  files: readonly ChangedFile[],
  { adapter = typescriptAdapter, ...load }: AnalyzeOptions,
): Promise<Extracted | { ignored: string[]; changes?: undefined }> {
  const isIgnored = loadIgnores(head.root);
  const ignored = files
    .filter((file) => isIgnored(file.path) && (!file.previousPath || isIgnored(file.previousPath)))
    .map((file) => file.path);
  const relevant = files.filter(
    (file) => isRelevant(file, adapter) && !ignored.includes(file.path),
  );
  if (relevant.length === 0) return { ignored };

  const baseFiles = relevant.flatMap((file) =>
    file.status === 'added' || file.status === 'copied'
      ? []
      : [file.status === 'renamed' && file.previousPath ? file.previousPath : file.path],
  );
  const headFiles = relevant.filter((file) => file.status !== 'deleted').map((file) => file.path);
  const renames = new Map(
    relevant.flatMap((file) =>
      file.status === 'renamed' && file.previousPath
        ? [[file.previousPath, file.path] as const]
        : [],
    ),
  );

  const timings: Record<string, number> = {};
  let mark = performance.now();
  const lap = (phase: string) => {
    const now = performance.now();
    timings[phase] = Math.round(now - mark);
    mark = now;
  };

  const baseRev = await adapter.load(base, { ...load, files: baseFiles });
  lap('loadBase');
  const headRev = await adapter.load(head, { ...load, files: headFiles });
  lap('loadHead');
  // Pass 1 without type inference (the costly part); pass 2 infers only for symbols whose
  // syntax differs. An unchanged symbol whose inferred type drifted because something it
  // calls changed is covered by that callee's own signature change.
  const syntactic = (rev: unknown, files: string[]) =>
    adapter.extract(rev, files, { infer: () => false });
  const needsTypes = differing(syntactic(baseRev, baseFiles), syntactic(headRev, headFiles));
  const infer = (id: SymbolId) => needsTypes.has(id);
  const baseSymbols = adapter.extract(baseRev, baseFiles, { infer });
  const headSymbols = adapter.extract(headRev, headFiles, { infer });
  const changes = diffSymbols({ base: baseSymbols, head: headSymbols, renames });
  lap('extract');
  return { adapter, baseRev, headRev, relevant, ignored, changes, timings };
}

async function analyzeSources(
  base: RevisionSource,
  head: RevisionSource,
  files: readonly ChangedFile[],
  options: AnalyzeOptions,
): Promise<SourceAnalysis> {
  const extracted = await extractChanges(base, head, files, options);
  if (extracted.changes === undefined) return { ...EMPTY, ignored: extracted.ignored };
  const { adapter, baseRev, headRev, relevant, ignored, changes, timings } = extracted;
  const depth = options.depth ?? 1;
  let mark = performance.now();
  const lap = (phase: string) => {
    const now = performance.now();
    timings[phase] = Math.round(now - mark);
    mark = now;
  };

  // References around every changed symbol, on the side(s) where it exists.
  const refs = { base: [] as EdgeRef[], head: [] as EdgeRef[] };
  for (const change of changes) {
    if (change.status === 'unchanged') continue;
    if (change.base) refs.base.push(...references(adapter, baseRev, change.base));
    if (change.head) refs.head.push(...references(adapter, headRev, change.head));
  }

  // Base IDs of moved symbols become their head IDs, so both sides meet in one graph.
  const toHead = new Map(changes.flatMap((c) => (c.previousId ? [[c.previousId, c.id]] : [])));
  const rename = (id: SymbolId) => toHead.get(id) ?? id;
  const baseRefs = refs.base.map((r) => ({ ...r, from: rename(r.from), to: rename(r.to) }));

  const changedIds = new Set(changes.filter((c) => c.status !== 'unchanged').map((c) => c.id));
  const known = new Map<SymbolId, SymbolDecl>(); // unchanged symbols already extracted
  for (const change of changes)
    if (change.status === 'unchanged' && change.head) known.set(change.id, change.head);

  const resolver = new ContextResolver(adapter, { base: baseRev, head: headRev }, known);
  // Widen context hop by hop on the head side (depth 1 = direct neighbours only).
  let frontier = endpoints(refs.head, changedIds);
  for (let hop = 1; hop < depth && frontier.length > 0 && resolver.size < MAX_CONTEXT; hop++) {
    const next: EdgeRef[] = [];
    for (const id of frontier) {
      const decl = resolver.decl(id, 'head');
      if (decl) next.push(...references(adapter, headRev, decl));
    }
    refs.head.push(...next);
    frontier = endpoints(next, changedIds).filter((id) => !resolver.has(id));
  }

  const edges = mergeEdges(baseRefs, refs.head);
  lap('references');
  const targets = new Map(
    [...baseRefs, ...refs.head].flatMap((r) => (r.target ? [[r.to, r.target] as const] : [])),
  );
  const headIds = new Set(refs.head.flatMap((r) => [r.from, r.to]));
  const context: ContextSymbol[] = [];
  for (const id of new Set(edges.flatMap((e) => [e.from, e.to]))) {
    if (changedIds.has(id)) continue;
    const target = targets.get(id);
    if (target) context.push({ id, kind: target, decl: null });
    else if (id.endsWith('#(module)')) context.push({ id, kind: 'module', decl: null });
    else {
      const decl = resolver.decl(id, headIds.has(id) ? 'head' : 'base');
      context.push({ id, kind: decl?.kind ?? 'unknown', decl: decl ?? null });
    }
  }
  context.sort((a, b) => a.id.localeCompare(b.id));
  lap('context');

  const removed = changes.flatMap((c) => (c.status === 'removed' && c.base ? [c.base] : []));
  const exposure = new Map<SymbolId, Exposure>();
  for (const change of changes) {
    const why = change.status === 'added' && change.head && adapter.exposure(headRev, change.head);
    if (why) exposure.set(change.id, why);
  }
  // Only removed and modified symbols can break code outside the repo.
  const publicApi = { base: new Set<SymbolId>(), head: new Set<SymbolId>() };
  for (const change of changes) {
    if (change.status !== 'removed' && change.status !== 'modified') continue;
    if (change.base && adapter.publicApi(baseRev, change.base)) publicApi.base.add(change.id);
    if (change.head && adapter.publicApi(headRev, change.head)) publicApi.head.add(change.id);
  }
  const findings = runDetectors({
    changes,
    edges,
    files: relevant,
    dangling: removed.length > 0 ? adapter.dangling(headRev, removed) : [],
    exposure,
    publicApi,
  });

  lap('detectors');

  const warnings = [...new Set([...adapter.warnings(baseRev), ...adapter.warnings(headRev)])];
  return { changes, edges, context, findings, ignored, warnings, timings };
}

/** IDs present on one side only, or whose hashes differ between the sides. */
function differing(base: SymbolDecl[], head: SymbolDecl[]): Set<SymbolId> {
  const before = new Map(base.map((s) => [s.id, s]));
  const ids = new Set<SymbolId>();
  for (const symbol of head) {
    const old = before.get(symbol.id);
    before.delete(symbol.id);
    if (
      !old ||
      old.hashes.signature !== symbol.hashes.signature ||
      old.hashes.body !== symbol.hashes.body
    ) {
      ids.add(symbol.id);
    }
  }
  for (const id of before.keys()) ids.add(id);
  return ids;
}

function references<L>(adapter: LanguageAdapter<L>, revision: L, symbol: SymbolDecl): EdgeRef[] {
  return [...adapter.incoming(revision, symbol), ...adapter.outgoing(revision, symbol)];
}

/** Repo symbols referenced by `refs` that are not themselves changed. */
function endpoints(refs: EdgeRef[], changed: Set<SymbolId>): SymbolId[] {
  const ids = new Set<SymbolId>();
  for (const ref of refs) {
    for (const id of [ref.from, ref.to]) {
      if (!changed.has(id) && !id.endsWith('#(module)') && !(id === ref.to && ref.target)) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

/** Merges per-side references into edges keyed by (from, to, kind). */
function mergeEdges(base: EdgeRef[], head: EdgeRef[]): Edge[] {
  const edges = new Map<string, Edge & { inBase: boolean; inHead: boolean }>();
  const add = (ref: EdgeRef, side: 'base' | 'head') => {
    const key = `${ref.from}\0${ref.to}\0${ref.kind}`;
    let edge = edges.get(key);
    if (!edge) {
      edge = {
        from: ref.from,
        to: ref.to,
        kind: ref.kind,
        side: side,
        resolution: ref.resolution,
        sites: {},
        inBase: false,
        inHead: false,
      };
      edges.set(key, edge);
    }
    if (side === 'base') edge.inBase = true;
    else edge.inHead = true;
    const sites = (edge.sites[side] ??= []);
    if (
      !sites.some(
        (s) => s.file === ref.site.file && s.line === ref.site.line && s.col === ref.site.col,
      )
    ) {
      sites.push(ref.site);
    }
  };
  for (const ref of base) add(ref, 'base');
  for (const ref of head) add(ref, 'head');

  return [...edges.values()]
    .map(({ inBase, inHead, ...edge }): Edge => ({
      ...edge,
      side: inBase && inHead ? 'both' : inBase ? 'base' : 'head',
    }))
    .sort(
      (a, b) =>
        a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
    );
}

/** Finds declarations of context symbols, extracting each file at most once per side. */
class ContextResolver<L> {
  private readonly files = {
    base: new Map<string, Map<SymbolId, SymbolDecl>>(),
    head: new Map<string, Map<SymbolId, SymbolDecl>>(),
  };

  constructor(
    private readonly adapter: LanguageAdapter<L>,
    private readonly revisions: { base: L; head: L },
    private readonly known: Map<SymbolId, SymbolDecl>,
  ) {}

  get size(): number {
    return this.known.size;
  }

  has(id: SymbolId): boolean {
    return this.known.has(id);
  }

  decl(id: SymbolId, side: 'base' | 'head'): SymbolDecl | undefined {
    const cached = this.known.get(id);
    if (cached) return cached;
    const file = id.slice(0, id.indexOf('#'));
    let symbols = this.files[side].get(file);
    if (!symbols) {
      // Context symbols are shown, not compared: skip type inference.
      const extracted = this.adapter.extract(this.revisions[side], [file], { infer: () => false });
      symbols = new Map(extracted.map((s) => [s.id, s]));
      this.files[side].set(file, symbols);
    }
    const decl = symbols.get(id);
    if (decl) this.known.set(id, decl);
    return decl;
  }
}

function isRelevant(file: ChangedFile, adapter: LanguageAdapter): boolean {
  return (
    adapter.matches(file.path) ||
    (file.previousPath !== undefined && adapter.matches(file.previousPath))
  );
}
