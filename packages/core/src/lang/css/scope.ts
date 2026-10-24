import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { SymbolDecl } from '../../model.js';
import { selectorClasses, selectorNames } from './classes.js';
import type { StylesheetFacts } from './extract.js';
import { isStylesheet } from './files.js';
import type { StyleImport, StyleUse, UseKind } from './uses.js';

/** Folders never read for stylesheets. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out']);

/** Every stylesheet of a revision: what each declares, uses and imports. */
export interface StylesheetIndex {
  files: ReadonlyMap<string, StylesheetFacts>;
  /** Declarations by what they can be named (`property:--accent`, `mixin:themify`). */
  byKey: ReadonlyMap<string, SymbolDecl[]>;
  /** Uses by the same keys. */
  uses: ReadonlyMap<string, StyleUse[]>;
  /** The files each file imports (`@import`, `@use`, `@forward`), resolved, in order. */
  imports: ReadonlyMap<string, { import: StyleImport; target: Target }[]>;
  /** The files that `@import` each file. */
  importers: ReadonlyMap<string, string[]>;
  /** The files that `@import`, `@use` or `@forward` each file. */
  includedBy: ReadonlyMap<string, string[]>;
  /** Rules by the classes their selectors name, with whether the class is the subject's. */
  classes: ReadonlyMap<string, { rule: SymbolDecl; subject: boolean }[]>;
  /** Rules by every class their selectors name, `:not()` included. */
  named: ReadonlyMap<string, SymbolDecl[]>;
}

/** What an import's URL names: a stylesheet of the revision, a package, or Sass's own. */
export type Target =
  { file: string } | { package: string } | { builtin: true } | { unresolved: true };

/** What a use names. */
export type Resolution =
  | { targets: SymbolDecl[]; ambiguous: boolean }
  | { external: string }
  | { unknown: string }
  | { none: true };

/** Names the cascade shares between every stylesheet. */
const GLOBAL_KINDS = new Set<UseKind>(['property', 'keyframes']);

/** The key a declaration can be named by, if any: `variable:$x`, `keyframes:spin`. */
export function memberKey(symbol: SymbolDecl): string | undefined {
  switch (symbol.kind) {
    case 'variable':
      return symbol.name.startsWith('--') ? `property:${symbol.name}` : `variable:${symbol.name}`;
    case 'mixin':
      return `mixin:${symbol.name.slice('@mixin '.length)}`;
    case 'function':
      return `function:${symbol.name.slice('@function '.length)}`;
    case 'keyframes':
      return `keyframes:${symbol.name.replace(/^@\S*keyframes /, '')}`;
    case 'rule':
      return symbol.name.startsWith('%') ? `placeholder:${symbol.name}` : undefined;
    default:
      return undefined;
  }
}

const useKey = (use: Pick<StyleUse, 'kind' | 'name'>) => `${use.kind}:${use.name}`;

/** A package's member as a use names it: `$x`, `@mixin core`, `@function rem`. */
function label(use: StyleUse): string {
  switch (use.kind) {
    case 'mixin':
      return `@mixin ${use.name}`;
    case 'function':
      return `@function ${use.name}`;
    default:
      return use.name;
  }
}

/** An unresolved use, as written: `unknown:$x`, `unknown:v.$x`, `unknown:@include themify`. */
function unknown(use: StyleUse): { unknown: string } {
  const name = `${use.namespace ? `${use.namespace}.` : ''}${use.name}`;
  return { unknown: `unknown:${use.kind === 'mixin' ? `@include ${name}` : name}` };
}

/** Repo-relative paths of the revision's stylesheets, outside dependencies, builds and ignores. */
export function listStylesheets(root: string, ignored: (path: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.') && !ignored(`${path}/`)) {
          walk(join(dir, entry.name), `${path}/`);
        }
      } else if (entry.isFile() && isStylesheet(path) && !ignored(path)) {
        found.push(path);
      }
    }
  };
  walk(root, '');
  return found.sort();
}

/** Indexes the stylesheets' facts: declarations and uses by key, imports resolved. */
export function buildIndex(files: ReadonlyMap<string, StylesheetFacts>): StylesheetIndex {
  const byKey = new Map<string, SymbolDecl[]>();
  const uses = new Map<string, StyleUse[]>();
  const imports = new Map<string, { import: StyleImport; target: Target }[]>();
  const importers = new Map<string, string[]>();
  const includedBy = new Map<string, string[]>();
  const classes = new Map<string, { rule: SymbolDecl; subject: boolean }[]>();
  const named = new Map<string, SymbolDecl[]>();
  for (const [file, facts] of files) {
    for (const symbol of facts.symbols) {
      const key = memberKey(symbol);
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), symbol]);
      if (symbol.kind === 'rule' && !/^[%@]/.test(symbol.name)) {
        for (const { name, subject } of selectorClasses(symbol.name)) {
          classes.set(name, [...(classes.get(name) ?? []), { rule: symbol, subject }]);
        }
        for (const name of selectorNames(symbol.name)) {
          named.set(name, [...(named.get(name) ?? []), symbol]);
        }
      }
    }
    for (const use of facts.uses) uses.set(useKey(use), [...(uses.get(useKey(use)) ?? []), use]);
    const resolved = facts.imports.map((i) => ({
      import: i,
      target: resolveUrl(files, file, i.url),
    }));
    imports.set(file, resolved);
    for (const { import: i, target } of resolved) {
      if (!('file' in target)) continue;
      if (i.rule === 'import')
        importers.set(target.file, [...(importers.get(target.file) ?? []), file]);
      includedBy.set(target.file, [...(includedBy.get(target.file) ?? []), file]);
    }
  }
  return { files, byKey, uses, imports, importers, includedBy, classes, named };
}

/**
 * The stylesheet a URL names from `from`, as Sass finds it: relative, a partial (`_x.scss`),
 * a folder's `_index.scss`, then from the repository root; `sass:` modules are Sass's own;
 * `~pkg/…` and any other path not found are packages.
 */
export function resolveUrl(files: ReadonlyMap<string, unknown>, from: string, url: string): Target {
  if (url.startsWith('sass:')) return { builtin: true };
  if (/^([a-z]+:)?\/\//i.test(url)) return { unresolved: true };
  if (url.startsWith('~')) return { package: packageName(url.slice(1)) };
  const relative = url.startsWith('/') ? url.slice(1) : posix.join(posix.dirname(from), url);
  for (const base of url.startsWith('/') ? [relative] : [relative, url]) {
    const found = candidates(posix.normalize(base)).find((path) => files.has(path));
    if (found) return { file: found };
  }
  return url.startsWith('.') || url.startsWith('/')
    ? { unresolved: true }
    : { package: packageName(url) };
}

function candidates(base: string): string[] {
  const partial = (path: string) => posix.join(posix.dirname(path), `_${posix.basename(path)}`);
  if (/\.s?css$/.test(base)) return [base, partial(base)];
  return [
    `${base}.scss`,
    partial(`${base}.scss`),
    `${base}.css`,
    `${base}/_index.scss`,
    `${base}/index.scss`,
  ];
}

function packageName(path: string): string {
  const [first = '', second = ''] = path.split('/');
  return first.startsWith('@') ? `${first}/${second}` : first;
}

/**
 * What a use names. Custom properties and keyframes: every definition in the revision (none: no
 * edge). SCSS members: through the `@use` namespace, else what the file sees — its own, what it
 * imports, what its importers imported before it, `@use … as *`. One candidate is resolved, two
 * or more ambiguous; none is unknown (a function: no edge, it may be CSS's or Sass's own).
 */
export function resolveUse(index: StylesheetIndex, use: StyleUse): Resolution {
  const key = useKey(use);
  if (GLOBAL_KINDS.has(use.kind)) {
    const targets = index.byKey.get(key) ?? [];
    return targets.length > 0 ? { targets, ambiguous: false } : { none: true };
  }
  const file = use.site.file;
  let targets: SymbolDecl[];
  if (use.namespace !== undefined) {
    const used = index.imports
      .get(file)
      ?.find((i) => i.import.rule === 'use' && i.import.namespace === use.namespace);
    if (!used) return unknown(use);
    const target = used.target;
    if ('builtin' in target) return { none: true };
    if ('package' in target) return { external: `${target.package}#${label(use)}` };
    if ('unresolved' in target) return unknown(use);
    targets = moduleMembers(index, target.file, use.kind, use.name, new Set());
  } else {
    const seen = new Map<string, SymbolDecl>();
    for (const visible of visibleFiles(index, file)) {
      for (const symbol of index.byKey.get(key) ?? []) {
        if (symbol.file === visible) seen.set(symbol.id, symbol);
      }
    }
    for (const { import: i, target } of index.imports.get(file) ?? []) {
      if (i.rule === 'use' && i.namespace === null && 'file' in target) {
        for (const symbol of moduleMembers(index, target.file, use.kind, use.name, new Set())) {
          seen.set(symbol.id, symbol);
        }
      }
    }
    targets = [...seen.values()];
  }
  if (targets.length > 0) return { targets, ambiguous: targets.length > 1 };
  return use.kind === 'function' ? { none: true } : unknown(use);
}

/** A module's members of one name for `@use`: its own, and what it forwards (with prefixes). */
function moduleMembers(
  index: StylesheetIndex,
  file: string,
  kind: UseKind,
  name: string,
  seen: Set<string>,
): SymbolDecl[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const own = (index.byKey.get(`${kind}:${name}`) ?? []).filter((s) => s.file === file);
  if (own.length > 0) return own;
  for (const { import: i, target } of index.imports.get(file) ?? []) {
    if (i.rule !== 'forward' || !('file' in target)) continue;
    const bare = name.replace(/^\$/, '');
    if (i.prefix && !bare.startsWith(i.prefix)) continue;
    const forwarded = i.prefix
      ? `${name.startsWith('$') ? '$' : ''}${bare.slice(i.prefix.length)}`
      : name;
    const found = moduleMembers(index, target.file, kind, forwarded, seen);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * The files whose members a file sees without a namespace, as Sass's `@import` shares them:
 * itself and what it imports (transitively), and for each file importing it, that file and what
 * it imported before (its own importers likewise).
 */
function visibleFiles(index: StylesheetIndex, file: string): Set<string> {
  const visible = new Set<string>();
  const closure = (start: string, into: Set<string>) => {
    if (into.has(start)) return;
    into.add(start);
    for (const { import: i, target } of index.imports.get(start) ?? []) {
      if (i.rule === 'import' && 'file' in target) closure(target.file, into);
    }
  };
  closure(file, visible);
  const upward = (child: string, done: Set<string>) => {
    for (const importer of index.importers.get(child) ?? []) {
      if (done.has(importer)) continue;
      done.add(importer);
      visible.add(importer);
      for (const { import: i, target } of index.imports.get(importer) ?? []) {
        if (i.rule !== 'import' || !('file' in target)) continue;
        const reached = new Set<string>();
        closure(target.file, reached);
        if (reached.has(child)) break;
        for (const path of reached) visible.add(path);
      }
      upward(importer, done);
    }
  };
  upward(file, new Set([file]));
  return visible;
}

/** Whether `file` reaches `target` through `@import`, `@use` and `@forward`. */
export function reaches(index: StylesheetIndex, file: string, target: string): boolean {
  const seen = new Set<string>();
  const queue = [file];
  while (queue.length > 0) {
    const next = queue.pop() as string;
    if (next === target) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const { target: t } of index.imports.get(next) ?? []) if ('file' in t) queue.push(t.file);
  }
  return false;
}
