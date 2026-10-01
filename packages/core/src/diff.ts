import type { SymbolDecl, SymbolId } from './model.js';

export type ChangeStatus = 'added' | 'removed' | 'modified' | 'unchanged';

export interface Delta {
  signature: boolean;
  body: boolean;
  /** The symbol's ID changed: it was renamed, or moved to another file or container. */
  moved: boolean;
}

export interface SymbolChange {
  /** Head ID; the base ID for removed symbols. */
  id: SymbolId;
  status: ChangeStatus;
  /** Present when `status` is `modified`. */
  delta?: Delta;
  /** Base ID when the symbol moved. */
  previousId: SymbolId | null;
  base: SymbolDecl | null;
  head: SymbolDecl | null;
}

export interface DiffInput {
  base: readonly SymbolDecl[];
  head: readonly SymbolDecl[];
  /** File renames, base path → head path. Symbols keep their qualified name across them. */
  renames?: ReadonlyMap<string, string>;
}

/** Bodies with fewer normalized tokens are too common (`{}`, `return x`) to prove a move. */
export const MIN_MOVE_BODY_SIZE = 10;

/**
 * Classifies symbols as added, removed, modified or unchanged, and pairs removed with added
 * symbols that moved. Moves are matched, in order, by file rename, by an identical declaration
 * of the same name, and by an identical non-trivial body; members follow their container.
 * A candidate must be unique on both sides, so ambiguous cases stay added + removed.
 */
export function diffSymbols({ base, head, renames = new Map() }: DiffInput): SymbolChange[] {
  const baseById = new Map(base.map((s) => [s.id, s]));
  const headById = new Map(head.map((s) => [s.id, s]));
  const removed = new Map<SymbolId, SymbolDecl>();
  const added = new Map(headById);
  const pairs = new Map<SymbolId, SymbolDecl>(); // base ID → head symbol

  for (const symbol of base) {
    if (added.delete(symbol.id)) pairs.set(symbol.id, headById.get(symbol.id) as SymbolDecl);
    else removed.set(symbol.id, symbol);
  }

  const pair = (from: SymbolDecl, to: SymbolDecl) => {
    removed.delete(from.id);
    added.delete(to.id);
    pairs.set(from.id, to);
  };

  // 1. Renamed files keep qualified names.
  for (const symbol of [...removed.values()]) {
    const newFile = renames.get(symbol.file);
    const target = newFile && added.get(`${newFile}#${qualified(symbol.id)}`);
    if (target && target.kind === symbol.kind) pair(symbol, target);
  }
  followContainers(removed, added, pairs, pair);

  // 2. Same name, same declaration, other file (moved unchanged, including types).
  matchUnique(removed, added, pair, (s) =>
    [s.kind, s.name, s.hashes.signature, s.hashes.body].join('\0'),
  );
  // 3. Same non-trivial body (renamed and/or moved, maybe with a new signature).
  matchUnique(removed, added, pair, (s) =>
    s.bodySize >= MIN_MOVE_BODY_SIZE ? [s.kind, s.hashes.body].join('\0') : undefined,
  );
  followContainers(removed, added, pairs, pair);

  const changes: SymbolChange[] = [];
  for (const [fromId, to] of pairs) {
    const from = baseById.get(fromId) as SymbolDecl;
    const delta: Delta = {
      signature: from.hashes.signature !== to.hashes.signature,
      body: from.hashes.body !== to.hashes.body,
      moved: from.id !== to.id,
    };
    const changed = delta.signature || delta.body || delta.moved;
    changes.push({
      id: to.id,
      status: changed ? 'modified' : 'unchanged',
      ...(changed ? { delta } : {}),
      previousId: delta.moved ? from.id : null,
      base: from,
      head: to,
    });
  }
  for (const symbol of added.values()) {
    changes.push({ id: symbol.id, status: 'added', previousId: null, base: null, head: symbol });
  }
  for (const symbol of removed.values()) {
    changes.push({ id: symbol.id, status: 'removed', previousId: null, base: symbol, head: null });
  }
  return changes.sort(byLocation);
}

/** Pairs symbols whose key is unique among both the removed and the added ones. */
function matchUnique(
  removed: Map<SymbolId, SymbolDecl>,
  added: Map<SymbolId, SymbolDecl>,
  pair: (from: SymbolDecl, to: SymbolDecl) => void,
  key: (symbol: SymbolDecl) => string | undefined,
): void {
  const from = groupBy(removed.values(), key);
  const to = groupBy(added.values(), key);
  for (const [k, candidates] of from) {
    const targets = to.get(k);
    if (candidates.length === 1 && targets?.length === 1) {
      pair(candidates[0] as SymbolDecl, targets[0] as SymbolDecl);
    }
  }
}

/** Members of a moved container move with it: `a.ts#C.m` → `b.ts#D.m` when `C` → `D`. */
function followContainers(
  removed: Map<SymbolId, SymbolDecl>,
  added: Map<SymbolId, SymbolDecl>,
  pairs: Map<SymbolId, SymbolDecl>,
  pair: (from: SymbolDecl, to: SymbolDecl) => void,
): void {
  // Shallow members first, so nested containers are paired before their own members.
  const pending = [...removed.values()].sort((a, b) => depth(a.id) - depth(b.id));
  for (const symbol of pending) {
    if (!symbol.container) continue;
    const container = pairs.get(symbol.container);
    if (!container || container.id === symbol.container) continue;
    const target = added.get(`${container.id}${symbol.id.slice(symbol.container.length)}`);
    if (target && target.kind === symbol.kind) pair(symbol, target);
  }
}

function groupBy<T>(items: Iterable<T>, key: (item: T) => string | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

function qualified(id: SymbolId): string {
  return id.slice(id.indexOf('#') + 1);
}

function depth(id: SymbolId): number {
  return qualified(id).split('.').length;
}

function byLocation(a: SymbolChange, b: SymbolChange): number {
  const x = (a.head ?? a.base) as SymbolDecl;
  const y = (b.head ?? b.base) as SymbolDecl;
  return (
    x.file.localeCompare(y.file) ||
    x.range.start.line - y.range.start.line ||
    x.range.start.col - y.range.start.col ||
    x.id.localeCompare(y.id)
  );
}
