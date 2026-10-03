import { dirname, join, posix } from 'node:path';
import type { PluginContext, ts } from '@cpr/core';
import type { NgClass, NgKind } from './classes.js';

type TS = PluginContext['ts'];

/** Static fields Angular's compiler adds to a library's classes, in their typings. */
const DEF_FIELDS: Record<string, NgKind> = {
  ɵcmp: 'Component',
  ɵdir: 'Directive',
  ɵpipe: 'Pipe',
  ɵmod: 'NgModule',
};
/** Their types: Angular 12+ partial declarations, Angular 9–11 typings after ngcc. */
const DEF_TYPE = /^ɵɵ(?:Component|Directive|Pipe|NgModule)(?:Declaration|DefWithMeta)$/;
const VIEW_ENGINE_DECORATORS: ReadonlySet<string> = new Set([
  'Component',
  'Directive',
  'Pipe',
  'NgModule',
]);
const MAX_CACHED = 2000;
const MAX_DEPTH = 10;

/** The Angular classes of the libraries a revision imports, as its templates see them. */
export interface Libraries {
  /**
   * Per dependency root — the folder whose `node_modules` a project uses — the library classes
   * its files import. One root in most repos; one per project when each installs its own.
   */
  byRoot: Map<string, NgClass[]>;
  /** A repo file's dependency root (`.` for the repo's own); `''` when no folder above has one. */
  rootOf: (file: string) => string;
  warnings: string[];
}

/** What a library's typings or metadata say about one of its classes. */
interface LibraryMeta {
  kind: NgKind;
  selector?: string;
  exportAs?: string[];
  pipeName?: string;
  /** Own inputs: class property → binding name. */
  inputs: Map<string, string>;
  outputs: Map<string, string>;
}

/** A `.d.ts` file's declarations, imports and exports, by syntax. */
interface Dts {
  file: string;
  sf: ts.SourceFile;
  classes: Map<string, ts.ClassDeclaration>;
  /** Export name → local name. */
  exports: Map<string, string>;
  /** Local name → where it is imported from (`name` is `*` for a namespace import). */
  imports: Map<string, Imported>;
  /** `export { a as b } from '…'`: export name → where it comes from. */
  reexports: Map<string, Imported>;
  /** `export * from '…'`. */
  stars: string[];
}

interface Imported {
  spec: string;
  name: string;
}

/** A class declared in a `.d.ts` file. */
interface Declared {
  dts: Dts;
  cls: ts.ClassDeclaration;
}

/** Library typings shared by every revision (base and head read the same `node_modules`). */
const dtsCache = new Map<string, { text: string; dts: Dts }>();
const metaCache = new WeakMap<ts.ClassDeclaration, LibraryMeta | 'unknown' | null>();

/**
 * Finds the components, directives and pipes of the Angular libraries the project imports:
 * the entry points its TypeScript imports (`@angular/forms`), resolved like TypeScript from its
 * `node_modules`, plus the entry points their NgModules export from. Reads library typings by
 * syntax: the static `ɵcmp`/`ɵdir`/`ɵpipe` fields Angular 9+ writes there, else the
 * `metadata.json` of View Engine builds. Nothing is read when dependencies are not installed.
 */
export function libraryClasses(context: PluginContext): Libraries {
  const reader = new Reader(context.ts, context.root);
  const rootOf = dependencyRoots(context);
  // What each dependency root's files import (without installed dependencies: nothing to read).
  const imports = new Map<string, { spec: string; from: string }[]>();
  for (const path of context.sourceFiles()) {
    const sf = context.syntax(path);
    const root = rootOf(path);
    if (!sf || root === '') continue;
    let list = imports.get(root);
    if (!list) imports.set(root, (list = []));
    for (const spec of importedSpecifiers(context.ts, sf)) {
      list.push({ spec, from: join(context.root, path) });
    }
  }

  const byRoot = new Map<string, NgClass[]>();
  const unreadable = new Set<string>();
  for (const [root, list] of imports) {
    byRoot.set(root, scanRoot(context, reader, list, unreadable));
  }

  const warnings: string[] = [];
  if (unreadable.size > 0) {
    const names = [...unreadable];
    const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
    warnings.push(
      `${names.length} Angular library ${names.length === 1 ? 'class has' : 'classes have'} ` +
        `metadata in a form CPR cannot read, so templates do not match ${names.length === 1 ? 'it' : 'them'}: ` +
        `${names.slice(0, 3).join(', ')}${more}`,
    );
  }
  return { byRoot, rootOf, warnings };
}

/** For each repo file, the nearest folder above it holding `node_modules`. */
function dependencyRoots(context: PluginContext): (file: string) => string {
  const cache = new Map<string, string>();
  const at = (folder: string): string => {
    let found = cache.get(folder);
    if (found === undefined) {
      const absolute = folder === '.' ? context.root : join(context.root, folder);
      found = context.ts.sys.directoryExists(join(absolute, 'node_modules'))
        ? folder
        : folder === '.'
          ? ''
          : at(posix.dirname(folder));
      cache.set(folder, found);
    }
    return found;
  };
  return (file) => at(posix.dirname(file));
}

/**
 * The library classes one dependency root's files import: entry points resolved from the first
 * file importing each, plus the entry points their NgModules export from.
 */
function scanRoot(
  context: PluginContext,
  reader: Reader,
  imports: readonly { spec: string; from: string }[],
  unreadable: Set<string>,
): NgClass[] {
  const queue: { spec: string; from: string }[] = [];
  const queued = new Set<string>();
  const enqueue = (spec: string, from: string) => {
    if (queued.has(spec) || isRelative(spec) || spec.startsWith('@angular/core')) return;
    queued.add(spec);
    queue.push({ spec, from });
  };
  for (const { spec, from } of imports) enqueue(spec, from);

  const classes: NgClass[] = [];
  const seen = new Set<ts.ClassDeclaration>();
  const entries = new Set<string>();
  // NgModules add entry points to the queue while it is read.
  for (let i = 0; i < queue.length; i++) {
    const { spec, from } = queue[i] as { spec: string; from: string };
    const file = reader.resolve(spec, from);
    if (!file || entries.has(file) || !reader.isAngularPackage(file)) continue;
    entries.add(file);
    const entry = reader.load(file);
    if (!entry) continue;

    let found = 0;
    for (const [exportName, declared] of reader.exportedClasses(entry)) {
      const meta = reader.meta(declared);
      if (!meta) continue;
      found++;
      // A class two entry points export counts once, from the first one the project imports.
      if (seen.has(declared.cls)) continue;
      seen.add(declared.cls);
      if (meta === 'unknown') {
        unreadable.add(`${exportName} (${spec})`);
      } else if (meta.kind === 'NgModule') {
        for (const next of moduleExports(context.ts, declared)) enqueue(next, declared.dts.file);
      } else {
        classes.push(libraryClass(spec, exportName, declared, reader.inherited(declared, meta)));
      }
    }
    if (found > 0) continue;

    // View Engine: decorators kept as JSON beside the typings (Angular 9–11 before ngcc).
    const metadata = reader.json(file.replace(/\.d\.[cm]?ts$/, '.metadata.json'));
    if (metadata === undefined) continue;
    const viewEngine = viewEngineClasses(metadata);
    if (!viewEngine) {
      unreadable.add(`${spec} metadata.json`);
      continue;
    }
    for (const next of viewEngine.follow) enqueue(next, file);
    for (const [exportName, meta] of viewEngine.classes) {
      if (meta.kind === 'NgModule') continue;
      const declared = reader.resolveExport(entry, exportName, false, new Set());
      if (!declared || seen.has(declared.cls)) continue;
      seen.add(declared.cls);
      classes.push(libraryClass(spec, exportName, declared, meta));
    }
  }
  return classes;
}

/** `@angular/material/button` → `@angular/material`; `rxjs/operators` → `rxjs`. */
function packageName(spec: string): string {
  const parts = spec.split('/');
  return (spec.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/');
}

function isRelative(spec: string): boolean {
  return spec.startsWith('.') || spec.startsWith('/');
}

/** Non-relative modules a file imports or re-exports from. */
function importedSpecifiers(tsApi: TS, sf: ts.SourceFile): string[] {
  const found: string[] = [];
  for (const statement of sf.statements) {
    if (
      (tsApi.isImportDeclaration(statement) || tsApi.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      tsApi.isStringLiteral(statement.moduleSpecifier) &&
      !isRelative(statement.moduleSpecifier.text)
    ) {
      found.push(statement.moduleSpecifier.text);
    }
  }
  return found;
}

function libraryClass(
  module: string,
  exportName: string,
  { dts, cls }: Declared,
  meta: LibraryMeta,
): NgClass {
  return {
    file: module,
    name: exportName,
    id: `${module}#${exportName}`,
    kind: meta.kind,
    exported: 'named',
    typeParameters: cls.typeParameters?.length ?? 0,
    host: [],
    hostMembers: new Set(),
    ...(meta.selector !== undefined ? { selector: meta.selector } : {}),
    ...(meta.exportAs ? { exportAs: meta.exportAs } : {}),
    ...(meta.pipeName !== undefined ? { pipeName: meta.pipeName } : {}),
    inputs: meta.inputs,
    outputs: meta.outputs,
    structural: dts.sf.text.slice(cls.pos, cls.end).includes('TemplateRef'),
    module,
  };
}

/** Entry points an NgModule's exports come from, besides its own package's files. */
function moduleExports(tsApi: TS, { dts, cls }: Declared): string[] {
  const def = defType(tsApi, cls);
  const exported = def && def !== 'unknown' ? def.type.typeArguments?.[3] : undefined;
  if (!exported || !tsApi.isTupleTypeNode(exported)) return [];
  const found: string[] = [];
  for (const element of exported.elements) {
    if (!tsApi.isTypeQueryNode(element)) continue;
    const name = element.exprName;
    const local = tsApi.isQualifiedName(name)
      ? tsApi.isIdentifier(name.left)
        ? name.left.text
        : undefined
      : name.text;
    const imported = local === undefined ? undefined : dts.imports.get(local);
    if (imported && !isRelative(imported.spec)) found.push(imported.spec);
  }
  return found;
}

/** The static `ɵcmp`/`ɵdir`/`ɵpipe`/`ɵmod` field of a class and its type, if any. */
function defType(
  tsApi: TS,
  cls: ts.ClassDeclaration,
): { kind: NgKind; type: ts.TypeReferenceNode; name: string } | 'unknown' | undefined {
  for (const member of cls.members) {
    if (!tsApi.isPropertyDeclaration(member) || !tsApi.isIdentifier(member.name)) continue;
    const kind = DEF_FIELDS[member.name.text];
    if (!kind) continue;
    if (!member.modifiers?.some((m) => m.kind === tsApi.SyntaxKind.StaticKeyword)) continue;
    const type = member.type;
    if (!type || !tsApi.isTypeReferenceNode(type)) return 'unknown';
    const typeName = tsApi.isQualifiedName(type.typeName)
      ? type.typeName.right.text
      : type.typeName.text;
    if (!DEF_TYPE.test(typeName)) return 'unknown';
    return { kind, type, name: typeName };
  }
  return undefined;
}

/** Reads library typings and resolves modules like TypeScript does for the project. */
class Reader {
  private readonly options: ts.CompilerOptions;
  private readonly resolutions: ts.ModuleResolutionCache;
  private readonly packages = new Map<string, boolean>();
  /** Per revision: each file is read and each specifier resolved once. */
  private readonly loaded = new Map<string, Dts | undefined>();
  private readonly resolved = new Map<string, string | undefined>();
  private readonly installedCache = new Map<string, boolean>();

  constructor(
    private readonly tsApi: TS,
    root: string,
  ) {
    this.options = {
      moduleResolution: tsApi.ModuleResolutionKind.Bundler,
      module: tsApi.ModuleKind.ESNext,
    };
    this.resolutions = tsApi.createModuleResolutionCache(root, (f) => f, this.options);
  }

  /** The typings a module specifier resolves to from a file, if they are a package's. */
  resolve(spec: string, from: string): string | undefined {
    // Specifiers resolve alike from files of one folder.
    const key = `${dirname(from)}\0${spec}`;
    if (this.resolved.has(key)) return this.resolved.get(key);
    const file = this.resolveUncached(spec, from);
    this.resolved.set(key, file);
    return file;
  }

  private resolveUncached(spec: string, from: string): string | undefined {
    // Most bare specifiers of a monorepo are path aliases: skip TypeScript's full lookup.
    if (!isRelative(spec) && !this.installed(dirname(from), packageName(spec))) return undefined;
    const resolved = this.tsApi.resolveModuleName(
      spec,
      from,
      this.options,
      this.tsApi.sys,
      this.resolutions,
    ).resolvedModule;
    const file = resolved?.resolvedFileName;
    // A workspace package links to the repo's own sources: those are not a library.
    if (!file || !/\.d\.[cm]?ts$/.test(file) || !file.includes('/node_modules/')) return undefined;
    return file;
  }

  /** Whether a package's folder is in a `node_modules` of `dir` or a folder above it. */
  private installed(dir: string, name: string): boolean {
    const key = `${dir}\0${name}`;
    let found = this.installedCache.get(key);
    if (found === undefined) {
      const parent = dirname(dir);
      found =
        this.tsApi.sys.directoryExists(join(dir, 'node_modules', name)) ||
        (parent !== dir && this.installed(parent, name));
      this.installedCache.set(key, found);
    }
    return found;
  }

  /** Whether the package of a file is Angular's or depends on it. */
  isAngularPackage(file: string): boolean {
    const index = file.lastIndexOf('/node_modules/') + '/node_modules/'.length;
    const name = packageName(file.slice(index));
    if (name.startsWith('@angular/')) return true;
    const dir = file.slice(0, index) + name;
    let angular = this.packages.get(dir);
    if (angular === undefined) {
      const manifest = this.json(`${dir}/package.json`);
      angular = ['dependencies', 'peerDependencies'].some((field) => {
        const deps = (manifest as Record<string, unknown> | undefined)?.[field];
        return !!deps && typeof deps === 'object' && '@angular/core' in deps;
      });
      this.packages.set(dir, angular);
    }
    return angular;
  }

  json(file: string): unknown {
    const text = this.tsApi.sys.readFile(file);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  load(file: string): Dts | undefined {
    if (this.loaded.has(file)) return this.loaded.get(file);
    const dts = this.loadUncached(file);
    this.loaded.set(file, dts);
    return dts;
  }

  private loadUncached(file: string): Dts | undefined {
    const text = this.tsApi.sys.readFile(file);
    if (text === undefined) return undefined;
    const cached = dtsCache.get(file);
    if (cached?.text === text) return cached.dts;
    const dts = parseDts(this.tsApi, file, text);
    if (dtsCache.size >= MAX_CACHED) dtsCache.clear();
    dtsCache.set(file, { text, dts });
    return dts;
  }

  /** The classes a module exports, by export name; a class exported under two names, once. */
  exportedClasses(dts: Dts): Map<string, Declared> {
    const byClass = new Map<ts.ClassDeclaration, [string, Declared]>();
    for (const name of this.exportNames(dts, new Set())) {
      const declared = this.resolveExport(dts, name, false, new Set());
      if (!declared) continue;
      const current = byClass.get(declared.cls);
      // `export { NgForOf as NgFor, NgForOf }`: prefer the class's own name, then a public one.
      if (!current || rank(declared, name) < rank(current[1], current[0])) {
        byClass.set(declared.cls, [name, declared]);
      }
    }
    return new Map([...byClass.values()]);
  }

  private exportNames(dts: Dts, seen: Set<Dts>): string[] {
    if (seen.has(dts)) return [];
    seen.add(dts);
    const names = [...dts.exports.keys(), ...dts.reexports.keys()];
    for (const spec of dts.stars) {
      const target = isRelative(spec) ? this.module(spec, dts) : undefined;
      if (target) names.push(...this.exportNames(target, seen).filter((n) => n !== 'default'));
    }
    return names;
  }

  /**
   * The class a module exports under a name. Re-exports from other packages are followed only
   * with `crossPackage` (base classes): a package's entry points export their own classes.
   */
  resolveExport(
    dts: Dts,
    name: string,
    crossPackage: boolean,
    seen: Set<string>,
  ): Declared | undefined {
    const key = `${dts.file}\0${name}`;
    if (seen.has(key) || seen.size > 50) return undefined;
    seen.add(key);
    const local = dts.exports.get(name);
    if (local !== undefined) return this.resolveLocal(dts, local, crossPackage, seen);
    const reexport = dts.reexports.get(name);
    if (reexport) return this.follow(dts, reexport, crossPackage, seen);
    if (name === 'default') return undefined;
    for (const spec of dts.stars) {
      const found = this.follow(dts, { spec, name }, crossPackage, seen);
      if (found) return found;
    }
    return undefined;
  }

  resolveLocal(
    dts: Dts,
    local: string,
    crossPackage: boolean,
    seen: Set<string>,
  ): Declared | undefined {
    const cls = dts.classes.get(local);
    if (cls) return { dts, cls };
    const imported = dts.imports.get(local);
    return imported && imported.name !== '*'
      ? this.follow(dts, imported, crossPackage, seen)
      : undefined;
  }

  private follow(
    dts: Dts,
    { spec, name }: Imported,
    crossPackage: boolean,
    seen: Set<string>,
  ): Declared | undefined {
    if (!crossPackage && !isRelative(spec)) return undefined;
    const target = this.module(spec, dts);
    return target && this.resolveExport(target, name, crossPackage, seen);
  }

  private module(spec: string, from: Dts): Dts | undefined {
    if (spec.startsWith('@angular/core')) return undefined;
    const file = this.resolve(spec, from.file);
    return file ? this.load(file) : undefined;
  }

  /** What a class's static Angular field says about it. */
  meta({ cls }: Declared): LibraryMeta | 'unknown' | null {
    const cached = metaCache.get(cls);
    if (cached !== undefined) return cached;
    const meta = ivyMeta(this.tsApi, cls);
    metaCache.set(cls, meta);
    return meta;
  }

  /** Inputs and outputs with those of base classes (typings list a class's own only). */
  inherited(declared: Declared, meta: LibraryMeta): LibraryMeta {
    const inputs = new Map<string, string>();
    const outputs = new Map<string, string>();
    const chain: LibraryMeta[] = [meta];
    const seen = new Set<ts.ClassDeclaration>([declared.cls]);
    for (let current = this.base(declared); current && seen.size < MAX_DEPTH;) {
      if (seen.has(current.cls)) break;
      seen.add(current.cls);
      const own = this.meta(current);
      if (own && own !== 'unknown') chain.unshift(own);
      current = this.base(current);
    }
    for (const { inputs: i, outputs: o } of chain) {
      for (const [property, binding] of i) inputs.set(property, binding);
      for (const [property, binding] of o) outputs.set(property, binding);
    }
    return { ...meta, inputs, outputs };
  }

  private base({ dts, cls }: Declared): Declared | undefined {
    const tsApi = this.tsApi;
    const extended = cls.heritageClauses?.find((c) => c.token === tsApi.SyntaxKind.ExtendsKeyword)
      ?.types[0]?.expression;
    if (!extended) return undefined;
    if (tsApi.isIdentifier(extended)) {
      return this.resolveLocal(dts, extended.text, true, new Set());
    }
    // `extends i1.CdkTable`: a namespace import.
    if (tsApi.isPropertyAccessExpression(extended) && tsApi.isIdentifier(extended.expression)) {
      const namespace = dts.imports.get(extended.expression.text);
      if (namespace?.name !== '*') return undefined;
      return this.follow(dts, { spec: namespace.spec, name: extended.name.text }, true, new Set());
    }
    return undefined;
  }
}

function rank({ cls }: Declared, name: string): number {
  if (cls.name?.text === name) return 0;
  return name.startsWith('ɵ') ? 2 : 1;
}

function parseDts(tsApi: TS, file: string, text: string): Dts {
  const sf = tsApi.createSourceFile(file, text, tsApi.ScriptTarget.Latest, false);
  const dts: Dts = {
    file,
    sf,
    classes: new Map(),
    exports: new Map(),
    imports: new Map(),
    reexports: new Map(),
    stars: [],
  };
  for (const statement of sf.statements) {
    if (tsApi.isClassDeclaration(statement) && statement.name) {
      const name = statement.name.text;
      dts.classes.set(name, statement);
      const modifiers = statement.modifiers ?? [];
      if (modifiers.some((m) => m.kind === tsApi.SyntaxKind.ExportKeyword)) {
        const isDefault = modifiers.some((m) => m.kind === tsApi.SyntaxKind.DefaultKeyword);
        dts.exports.set(isDefault ? 'default' : name, name);
      }
    } else if (tsApi.isImportDeclaration(statement)) {
      if (!tsApi.isStringLiteral(statement.moduleSpecifier)) continue;
      const spec = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause?.name) dts.imports.set(clause.name.text, { spec, name: 'default' });
      const bindings = clause?.namedBindings;
      if (bindings && tsApi.isNamespaceImport(bindings)) {
        dts.imports.set(bindings.name.text, { spec, name: '*' });
      } else if (bindings) {
        for (const element of bindings.elements) {
          dts.imports.set(element.name.text, {
            spec,
            name: (element.propertyName ?? element.name).text,
          });
        }
      }
    } else if (tsApi.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const spec =
        statement.moduleSpecifier && tsApi.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      const clause = statement.exportClause;
      if (!clause) {
        if (spec !== undefined) dts.stars.push(spec);
      } else if (tsApi.isNamedExports(clause)) {
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue;
          const local = (element.propertyName ?? element.name).text;
          if (spec === undefined) dts.exports.set(element.name.text, local);
          else dts.reexports.set(element.name.text, { spec, name: local });
        }
      }
    }
  }
  return dts;
}

/**
 * `static ɵdir: i0.ɵɵDirectiveDeclaration<NgModel, "[ngModel]…", ["ngModel"], { "model":
 * { "alias": "ngModel"; … } }, { "update": "ngModelChange" }, …>`, and the `…DefWithMeta`
 * typings ngcc writes, whose inputs are `{ "model": "ngModel" }`.
 */
function ivyMeta(tsApi: TS, cls: ts.ClassDeclaration): LibraryMeta | 'unknown' | null {
  const def = defType(tsApi, cls);
  if (def === undefined) return null;
  if (def === 'unknown') return 'unknown';
  const args = def.type.typeArguments ?? [];
  const meta: LibraryMeta = { kind: def.kind, inputs: new Map(), outputs: new Map() };
  if (def.kind === 'Pipe') {
    const name = literal(tsApi, args[1]);
    if (name === undefined) return 'unknown';
    meta.pipeName = name;
  } else if (def.kind === 'Component' || def.kind === 'Directive') {
    const selector = literal(tsApi, args[1]);
    if (selector === undefined && !isNever(tsApi, args[1])) return 'unknown';
    if (selector !== undefined) meta.selector = selector;
    const exportAs = args[2];
    if (exportAs && tsApi.isTupleTypeNode(exportAs)) {
      meta.exportAs = exportAs.elements.flatMap((e) => literal(tsApi, e) ?? []);
    }
    if (!bindingMap(tsApi, args[3], meta.inputs) || !bindingMap(tsApi, args[4], meta.outputs)) {
      return 'unknown';
    }
  }
  return meta;
}

function literal(tsApi: TS, node: ts.TypeNode | undefined): string | undefined {
  return node && tsApi.isLiteralTypeNode(node) && tsApi.isStringLiteral(node.literal)
    ? node.literal.text
    : undefined;
}

function isNever(tsApi: TS, node: ts.TypeNode | undefined): boolean {
  return node?.kind === tsApi.SyntaxKind.NeverKeyword;
}

/** `{ "prop": "binding" }` or `{ "prop": { "alias": "binding"; … } }` into `into`. */
function bindingMap(tsApi: TS, node: ts.TypeNode | undefined, into: Map<string, string>): boolean {
  if (!node || isNever(tsApi, node)) return true;
  if (!tsApi.isTypeLiteralNode(node)) return false;
  for (const member of node.members) {
    if (!tsApi.isPropertySignature(member) || !member.name) continue;
    const property =
      tsApi.isStringLiteral(member.name) || tsApi.isIdentifier(member.name)
        ? member.name.text
        : undefined;
    if (property === undefined) continue;
    let binding = literal(tsApi, member.type);
    if (binding === undefined && member.type && tsApi.isTypeLiteralNode(member.type)) {
      const alias = member.type.members.find(
        (m): m is ts.PropertySignature =>
          tsApi.isPropertySignature(m) &&
          !!m.name &&
          (tsApi.isStringLiteral(m.name) || tsApi.isIdentifier(m.name)) &&
          m.name.text === 'alias',
      );
      binding = literal(tsApi, alias?.type);
    }
    into.set(property, binding ?? property);
  }
  return true;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The classes of a View Engine `metadata.json` (format 3 and 4): `@Component`, `@Directive`,
 * `@Pipe` and `@NgModule` decorators with their arguments, `@Input`/`@Output` members, and
 * `extends` within the same entry point. Undefined if it is not that format.
 */
function viewEngineClasses(
  json: unknown,
): { classes: Map<string, LibraryMeta>; follow: string[] } | undefined {
  const bundle: unknown = Array.isArray(json) ? json[0] : json;
  if (!isObject(bundle) || bundle.__symbolic !== 'module' || !isObject(bundle.metadata)) {
    return undefined;
  }
  const metadata = bundle.metadata;
  const own = new Map<string, LibraryMeta>();
  const follow = new Set<string>();

  const decoratorOf = (value: Json): { name: string; options: Json } | undefined => {
    for (const decorator of Array.isArray(value.decorators) ? value.decorators : []) {
      const expression = isObject(decorator) ? decorator.expression : undefined;
      if (!isObject(expression) || expression.module !== '@angular/core') continue;
      const name = expression.name;
      if (typeof name !== 'string' || !VIEW_ENGINE_DECORATORS.has(name)) continue;
      const args = (decorator as Json).arguments;
      const options = Array.isArray(args) && isObject(args[0]) ? args[0] : {};
      return { name, options };
    }
    return undefined;
  };
  const members = (value: Json, meta: LibraryMeta) => {
    if (!isObject(value.members)) return;
    for (const [member, entries] of Object.entries(value.members)) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        const decorators =
          isObject(entry) && Array.isArray(entry.decorators) ? entry.decorators : [];
        for (const decorator of decorators) {
          const expression = isObject(decorator) ? decorator.expression : undefined;
          if (!isObject(expression) || expression.module !== '@angular/core') continue;
          const args = (decorator as Json).arguments;
          const alias = Array.isArray(args) && typeof args[0] === 'string' ? args[0] : member;
          if (expression.name === 'Input') meta.inputs.set(member, alias);
          if (expression.name === 'Output') meta.outputs.set(member, alias);
        }
      }
    }
  };
  const modules = (value: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
      for (const item of value) modules(item, depth + 1);
    } else if (isObject(value) && value.__symbolic === 'reference') {
      if (typeof value.module === 'string' && !isRelative(value.module)) {
        follow.add(value.module);
      } else if (typeof value.name === 'string' && !('module' in value)) {
        // A constant of the same entry point: `exports: SHARED_DIRECTIVES`.
        const target = metadata[value.name];
        if (Array.isArray(target)) modules(target, depth + 1);
      }
    }
  };

  // Own metadata of every class, decorated or not (an undecorated base can declare inputs).
  for (const [name, value] of Object.entries(metadata)) {
    if (!isObject(value) || value.__symbolic !== 'class') continue;
    const decorator = decoratorOf(value);
    const meta: LibraryMeta = {
      kind: (decorator?.name ?? 'Directive') as NgKind,
      inputs: new Map(),
      outputs: new Map(),
    };
    if (decorator) {
      const { options } = decorator;
      if (typeof options.selector === 'string') meta.selector = options.selector;
      if (typeof options.exportAs === 'string') {
        meta.exportAs = options.exportAs.split(',').map((n) => n.trim());
      }
      if (decorator.name === 'Pipe' && typeof options.name === 'string') {
        meta.pipeName = options.name;
      }
      for (const kind of ['inputs', 'outputs'] as const) {
        for (const binding of Array.isArray(options[kind]) ? options[kind] : []) {
          if (typeof binding !== 'string') continue;
          const [property = '', alias] = binding.split(':').map((part) => part.trim());
          if (property) meta[kind].set(property, alias || property);
        }
      }
      if (decorator.name === 'NgModule') modules(options.exports, 0);
    }
    members(value, meta);
    own.set(name, meta);
  }

  const classes = new Map<string, LibraryMeta>();
  for (const [name, value] of Object.entries(metadata)) {
    if (!isObject(value) || !decoratorOf(value)) continue;
    const meta = own.get(name) as LibraryMeta;
    const chain = [meta];
    const seen = new Set([name]);
    let base = value.extends;
    while (isObject(base) && typeof base.name === 'string' && !('module' in base)) {
      if (seen.has(base.name) || seen.size > MAX_DEPTH) break;
      seen.add(base.name);
      const inherited = own.get(base.name);
      if (!inherited) break;
      chain.unshift(inherited);
      const next = metadata[base.name];
      base = isObject(next) ? next.extends : undefined;
    }
    const inputs = new Map<string, string>();
    const outputs = new Map<string, string>();
    for (const link of chain) {
      for (const [property, binding] of link.inputs) inputs.set(property, binding);
      for (const [property, binding] of link.outputs) outputs.set(property, binding);
    }
    classes.set(name, { ...meta, inputs, outputs });
  }
  return { classes, follow: [...follow] };
}
