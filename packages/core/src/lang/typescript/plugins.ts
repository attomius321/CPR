import type { ts } from 'ts-morph';
import type { Dangling, Exposure, Site, SymbolDecl, SymbolId } from '../../model.js';

/** The plugin contract this version of CPR implements. */
export const PLUGIN_API_VERSION = 1;

/**
 * A plugin of the TypeScript adapter: framework knowledge (templates, conventions) that the
 * TypeScript/JavaScript analysis does not have. It extends the adapter at fixed points and sees
 * TypeScript's own objects; without plugins the adapter behaves exactly the same. Every hook is
 * optional except `applies`; a hook that throws disables the plugin for that revision with a
 * warning, it never fails the analysis.
 */
export interface TsPlugin {
  /** Short name, e.g. `angular`. */
  name: string;
  version?: string;
  apiVersion: typeof PLUGIN_API_VERSION;
  /** Whether it applies to this revision (checked per side: the base may predate a framework). */
  applies: (revision: PluginContext) => boolean;
  /** Extra files whose changes it analyzes, besides TS/JS (e.g. `*.html`). */
  matches?: (path: string) => boolean;
  /**
   * In-memory TypeScript files added to the program before it is built (e.g. template shims).
   * Runs before types exist: it sees the project's files and their syntax trees.
   */
  virtualFiles?: (revision: PluginContext) => VirtualFile[];
  /**
   * Extra symbols in the given changed repo-relative files (e.g. templates), with the TypeScript
   * nodes that stand for them: outgoing references are scanned inside those nodes.
   */
  extract?: (revision: PluginRevision, files: readonly string[]) => PluginSymbol[];
  /** How a decorator's arguments count in hashes; undefined leaves it as today (signature). */
  decoratorArguments?: (
    revision: PluginRevision,
    decorator: ts.Decorator,
  ) => ArgumentRoles | undefined;
  /**
   * Uses of removed symbols the adapter cannot find by name, e.g. a removed component whose
   * selector a template still uses; `base` is where they were removed from.
   */
  dangling?: (
    revision: PluginRevision,
    removed: readonly SymbolDecl[],
    base: PluginRevision,
  ) => Dangling[];
  /** Why a symbol may be used with no reference, consulted after the adapter's own answer. */
  exposure?: (revision: PluginRevision, symbol: SymbolDecl) => Exposure | undefined;
  /** Problems worth telling the user about. */
  warnings?: (revision: PluginRevision) => string[];
}

/** What a plugin sees of a revision before its program exists. */
export interface PluginContext {
  /** The TypeScript the adapter runs on: use it rather than your own copy, so nodes match. */
  ts: typeof ts;
  /** Absolute revision root. */
  root: string;
  /** The root `package.json`, if any. */
  packageJson: Record<string, unknown> | undefined;
  /** A repo-relative file of this revision, or undefined. */
  readFile: (path: string) => string | undefined;
  /** Repo-relative paths of the program's own TypeScript/JavaScript files. */
  sourceFiles: () => string[];
  /** The syntax tree of one of them (no types yet). */
  syntax: (path: string) => ts.SourceFile | undefined;
}

/** What a plugin sees once the program exists. */
export interface PluginRevision extends PluginContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  /** The syntax tree of one of this plugin's virtual files, by its repo-relative path. */
  virtual: (path: string) => ts.SourceFile | undefined;
}

/** A TypeScript file that exists only in the analyzed program. */
export interface VirtualFile {
  /** Repo-relative path; must not exist on disk (e.g. `src/foo.component.html.cpr.ts`). */
  path: string;
  text: string;
  /**
   * The symbol a position of `text` belongs to and its real site (e.g. a line of a `.html`
   * file). Undefined for scaffolding: references there are dropped. `possible`: a reference
   * there may not be a use (e.g. two components match one element).
   */
  map: (offset: number) => MappedPosition | undefined;
}

export interface MappedPosition {
  owner: SymbolId;
  site: Site;
  possible?: boolean;
}

export interface PluginSymbol {
  symbol: SymbolDecl;
  /** Nodes standing for the symbol, usually in a virtual file. */
  nodes?: ts.Node[];
}

/**
 * Which nodes of a decorator's arguments are signature (a change there is a signature change)
 * and which are body; anything else counts for neither.
 */
export interface ArgumentRoles {
  signature: readonly ts.Node[];
  body: readonly ts.Node[];
}

/** A plugin that applies to a loaded revision; dropped from it when a hook fails. */
export interface ActivePlugin {
  plugin: TsPlugin;
  failed: boolean;
}

/**
 * Runs one plugin hook; a hook that throws disables the plugin for this revision and leaves a
 * warning, and the fallback is used instead.
 */
export function runHook<T>(
  active: ActivePlugin,
  hook: string,
  warnings: string[],
  fallback: T,
  fn: () => T,
): T {
  if (active.failed) return fallback;
  try {
    return fn();
  } catch (error) {
    active.failed = true;
    warnings.push(
      `plugin ${active.plugin.name}: ${hook} failed (${(error as Error).message}); continuing without it`,
    );
    return fallback;
  }
}
