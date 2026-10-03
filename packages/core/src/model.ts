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
  | 'namespace'
  /** A framework template (from a plugin), e.g. an Angular component's HTML. */
  | 'template';

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
  /** Pieces of the contract, to judge whether a signature change is backward compatible. */
  shape?: Shape;
}

/** Normalized type texts; equal text means equal type. */
export interface Shape {
  /** Function parameters in order. Names don't matter to callers. */
  params?: { optional: boolean; type: string }[];
  returns?: string;
  /** Members of interfaces and object types. */
  members?: Record<string, { optional: boolean; type: string }>;
  /**
   * What users pass, by name (a component's props, from a plugin's contract): compared from
   * their side, so a new required input breaks them where a new required member does not.
   */
  inputs?: Record<string, { optional: boolean; type: string }>;
  /** Everything else that must stay equal: name, modifiers, type parameters, heritage. */
  rest: string;
}

export type EdgeKind =
  | 'call'
  | 'new'
  | 'reference'
  | 'type-reference'
  | 'extends'
  | 'implements'
  /** A class member overriding or implementing a member of a base class or interface. */
  | 'overrides';

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
  /**
   * The reference reaches a class member only through an ancestor class or interface type: it
   * uses this member when the object is an instance of the member's class at runtime.
   */
  possible?: true;
  site: Site;
}

export interface Edge {
  from: SymbolId;
  to: SymbolId;
  kind: EdgeKind;
  /** `base`: only before the change (removed). `head`: only after (added). `both`: kept. */
  side: 'base' | 'head' | 'both';
  resolution: 'resolved' | 'unknown';
  /** Every site reaches the member only through an ancestor or interface type. */
  possible?: true;
  sites: { base?: Site[]; head?: Site[] };
}

export type Severity = 'error' | 'warning' | 'info';

export type RuleId =
  'removed-still-referenced' | 'orphan-added' | 'signature-changed' | 'exported-api-changed';

export interface Finding {
  /** `f1`, `f2`, … in severity order. */
  id: string;
  rule: RuleId;
  severity: Severity;
  symbol: SymbolId;
  /** Other symbols to highlight: callers, the blast radius. */
  related: SymbolId[];
  message: string;
  data: Record<string, unknown>;
}

/** A use of a removed symbol's name in head that no longer resolves. */
export interface Dangling {
  /** The removed symbol (base ID). */
  target: SymbolId;
  from: SymbolId;
  site: Site;
  /** `resolved`: the compiler would report an error here. `unknown`: untyped code, a guess. */
  certainty: 'resolved' | 'unknown';
  /** The name is imported from the removed symbol's file. */
  viaImport: boolean;
}

/**
 * Why an unreferenced symbol is still expected to be used. `framework`: a plugin knows the
 * framework uses it (a template, a lifecycle hook…).
 */
export type Exposure = 'entry-export' | 'override' | 'default-export' | 'framework';
