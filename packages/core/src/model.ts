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
}
