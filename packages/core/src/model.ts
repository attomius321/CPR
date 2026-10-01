/** `<repo-relative POSIX path>#<qualified name>`, e.g. `src/user.ts#UserService.getUser`. */
export type SymbolId = string;

export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'constructor'
  | 'accessor'
  | 'property'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'namespace';

/** 1-based line and column. */
export interface Position {
  line: number;
  col: number;
}

/** Start-inclusive, end-exclusive. */
export interface Range {
  start: Position;
  end: Position;
}

/** A declaration on one side of the diff. */
export interface SymbolDecl {
  id: SymbolId;
  kind: SymbolKind;
  name: string;
  /** Parent symbol (class, namespace), or null for top-level symbols. */
  container: SymbolId | null;
  exported: boolean;
  file: string;
  range: Range;
  /** Human-readable signature for display, e.g. `getUser(id: string): Promise<User>`. */
  signature: string;
  /** Change detection: formatting and comments do not affect either hash. */
  hashes: { signature: string; body: string };
  /** Normalized body tokens; 0 without a body. Tiny bodies are too common to match moves on. */
  bodySize: number;
}

export type EdgeKind = 'call' | 'new' | 'reference' | 'type-reference' | 'extends' | 'implements';

/** Where a reference is: repo-relative file, 1-based line and column. */
export interface Site {
  file: string;
  line: number;
  col: number;
}

/** One reference found on one side, before edges are merged across sides. */
export interface EdgeRef {
  /** The symbol containing the reference (`file#(module)` for top-level code). */
  from: SymbolId;
  /** The referenced symbol: a repo symbol, `<package>#<name>` for externals, `unknown:<text>`. */
  to: SymbolId;
  kind: EdgeKind;
  /** `unknown` for dynamic calls and untyped receivers: `to` is a best guess. */
  resolution: 'resolved' | 'unknown';
  /** Set when `to` is not a repo symbol. */
  target?: 'external' | 'unknown';
  site: Site;
}

export interface Edge {
  from: SymbolId;
  to: SymbolId;
  kind: EdgeKind;
  /** `base`: only before the change (removed). `head`: only after (added). `both`: kept. */
  side: 'base' | 'head' | 'both';
  resolution: 'resolved' | 'unknown';
  sites: { base?: Site[]; head?: Site[] };
}
