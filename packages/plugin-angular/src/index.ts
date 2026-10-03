import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import * as ng from '@angular/compiler';
import type {
  ArgumentRoles,
  Dangling,
  PluginContext,
  PluginRevision,
  PluginSymbol,
  SymbolDecl,
  ts,
  TsPlugin,
  VirtualFile,
} from '@cpr/core';
import {
  angularClasses,
  angularDecorator,
  decoratorOptions,
  propertyName,
  type NgClass,
} from './classes.js';
import { directiveSite, isMeta, registry, type Meta, type Registry } from './directives.js';
import { libraryClasses } from './libraries.js';
import { ShimBuilder, typeOf, writeHost, writeTemplate } from './shim.js';
import {
  bindTemplate,
  parseTemplate,
  templateTokens,
  type ParsedTemplate,
  type Syntax,
} from './template.js';

const VERSION = '0.1.0';

const TEST_OR_STORY = /\.(?:spec|test|stories)\.[cm]?tsx?$/;
const ANGULAR_IMPORT = /from\s*['"]@angular\/core['"/]/;

/** Lifecycle hooks Angular calls by name, `implements` or not. */
const LIFECYCLE_HOOKS = new Set([
  'ngOnChanges',
  'ngOnInit',
  'ngDoCheck',
  'ngAfterContentInit',
  'ngAfterContentChecked',
  'ngAfterViewInit',
  'ngAfterViewChecked',
  'ngOnDestroy',
  'ngDoBootstrap',
]);

/** `@Component`/`@Directive`/`@Pipe` arguments templates depend on: their signature. */
const SIGNATURE_OPTIONS: Record<string, ReadonlySet<string>> = {
  Component: new Set(['selector', 'exportAs', 'inputs', 'outputs', 'standalone']),
  Directive: new Set(['selector', 'exportAs', 'inputs', 'outputs', 'standalone']),
  Pipe: new Set(['name', 'standalone']),
  NgModule: new Set(),
  Injectable: new Set(),
};

/** What one revision holds for the plugin: its Angular classes and their templates. */
interface Revision {
  /** Template syntax for a file: its project's Angular version decides. */
  syntaxOf: (file: string) => Syntax;
  classes: NgClass[];
  byId: Map<string, NgClass>;
  /**
   * Directives, components and pipes a file's templates can use: the repo's, and the libraries
   * installed for its project.
   */
  registryOf: (file: string) => Registry;
  /** Every registry in use, for what a change takes away from templates. */
  registries: () => Registry[];
  warnings: string[];
  /** Classes with a template or host bindings that are not exported. */
  unexported: string[];
}

const revisions = new WeakMap<PluginContext['syntax'], Revision>();
const warningsByRoot = new Map<string, string[]>();

/**
 * Angular for CPR: templates become symbols that use their component's members, a change to
 * an Angular decorator's configuration is not a change of the class's contract, and members
 * Angular calls by itself (lifecycle hooks, host listeners) are not orphans.
 */
const angular: TsPlugin = {
  name: 'angular',
  version: VERSION,
  apiVersion: 1,

  // At the root, or in any project below it (a repo can hold several apps).
  applies: (revision) =>
    dependsOnAngular(revision.packageJson) ||
    !!revision.readFile('angular.json') ||
    revision.sourceFiles().some((file) => ANGULAR_IMPORT.test(revision.syntax(file)?.text ?? '')),

  matches: (path) => path.endsWith('.html'),

  virtualFiles: (revision) => {
    const state = revisionOf(revision);
    warningsByRoot.set(revision.root, state.warnings);
    const files: VirtualFile[] = [];
    for (const cls of state.classes) {
      if (!cls.template && cls.host.length === 0) continue;
      const shim = buildShim(revision, state, cls);
      if (shim) files.push(shim);
    }
    const unexported = state.unexported;
    if (unexported.length > 0) {
      const more = unexported.length > 3 ? ` and ${unexported.length - 3} more` : '';
      warn(
        state,
        `${unexported.length} Angular ${unexported.length === 1 ? 'class is' : 'classes are'} not exported, so ` +
          `${unexported.length === 1 ? 'its template is' : 'their templates are'} not analyzed: ${unexported.slice(0, 3).join(', ')}${more}`,
      );
    }
    return files;
  },

  extract: (revision, files) => {
    const state = revisionOf(revision);
    const wanted = new Set(files);
    const found = new Map<string, PluginSymbol>();
    for (const cls of state.classes) {
      const template = cls.template;
      if (!template) continue;
      const file = template.kind === 'external' ? template.path : cls.file;
      if (!wanted.has(file)) continue;
      const parsed = templateOf(revision, state, cls);
      if (!parsed) continue;
      const shim = revision.virtual(shimPath(cls));
      const render = shim?.statements.find(
        (s) => revision.ts.isFunctionDeclaration(s) && s.name?.text === '__cpr_template',
      );
      const id = templateId(cls);
      const existing = found.get(id);
      if (existing) {
        // One template file shared by several components: one symbol, used by each.
        existing.symbol.signature += `, ${cls.name}`;
        if (render) existing.nodes?.push(render);
        continue;
      }
      found.set(id, {
        symbol: templateSymbol(revision, cls, parsed),
        nodes: render ? [render] : [],
      });
    }
    return [...found.values()];
  },

  decoratorArguments: (revision, decorator) => decoratorRoles(revision, decorator),

  dangling: (revision, removed, base) => lostInTemplates(revision, removed, base),

  exposure: (revision, symbol) => {
    if (symbol.kind === 'template') return 'framework';
    const cls = symbol.container ? revisionOf(revision).byId.get(symbol.container) : undefined;
    if (!cls) return undefined;
    if (symbol.kind === 'method' && LIFECYCLE_HOOKS.has(symbol.name)) return 'framework';
    if (cls.hostMembers.has(symbol.name)) return 'framework';
    // Pipes are called by name from templates (resolved in A2).
    if (cls.kind === 'Pipe' && symbol.name === 'transform') return 'framework';
    return undefined;
  },

  warnings: (revision) => warningsByRoot.get(revision.root) ?? revisionOf(revision).warnings,
};

export default angular;
export { angular as plugin };

function dependsOnAngular(manifest: Record<string, unknown> | undefined): boolean {
  if (!manifest) return false;
  return ['dependencies', 'devDependencies', 'peerDependencies'].some((field) => {
    const deps = manifest[field];
    return !!deps && typeof deps === 'object' && '@angular/core' in deps;
  });
}

/**
 * The Angular major version of a file's project: in the nearest folder above it that says, the
 * installed `@angular/core`, else the `@angular/core` its `package.json` asks for.
 */
function angularVersions(revision: PluginContext): (file: string) => number | undefined {
  const cache = new Map<string, number | undefined>();
  const at = (folder: string): number | undefined => {
    if (cache.has(folder)) return cache.get(folder);
    const prefix = folder === '.' ? '' : `${folder}/`;
    let major = installedMajor(
      revision.readFile(`${prefix}node_modules/@angular/core/package.json`),
    );
    if (major === undefined) {
      const manifest =
        folder === '.'
          ? revision.packageJson
          : parseJson(revision.readFile(`${prefix}package.json`));
      major = requestedMajor(manifest);
    }
    if (major === undefined && folder !== '.') major = at(posix.dirname(folder));
    cache.set(folder, major);
    return major;
  };
  return (file) => at(posix.dirname(file));
}

function installedMajor(text: string | undefined): number | undefined {
  const version = (parseJson(text) as { version?: unknown } | undefined)?.version;
  return typeof version === 'string' ? Number.parseInt(version, 10) : undefined;
}

function requestedMajor(manifest: Record<string, unknown> | undefined): number | undefined {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = manifest?.[field] as Record<string, unknown> | undefined;
    const range = deps?.['@angular/core'];
    const major = typeof range === 'string' ? /\d+/.exec(range)?.[0] : undefined;
    if (major) return Number(major);
  }
  return undefined;
}

function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function revisionOf(revision: PluginContext): Revision {
  const cached = revisions.get(revision.syntax);
  if (cached) return cached;
  const versionOf = angularVersions(revision);
  const classes = revision.sourceFiles().flatMap((file) => {
    const sf = revision.syntax(file);
    return sf ? angularClasses(revision.ts, file, sf) : [];
  });
  const libraries = libraryClasses(revision);
  // One registry per dependency root; the repo's own pipes win over a library's of the same name.
  const plain = registry(classes);
  const registries = new Map<string, Registry>();
  const registryFor = (root: string): Registry => {
    const installed = libraries.byRoot.get(root);
    if (!installed?.length) return plain;
    let found = registries.get(root);
    if (!found) registries.set(root, (found = registry([...installed, ...classes])));
    return found;
  };
  const syntaxes = new Map<boolean, Syntax>();
  const state: Revision = {
    // Block syntax and `@let` arrived in Angular 17; unknown versions get today's syntax.
    syntaxOf: (file) => {
      const major = versionOf(file);
      const blocks = major === undefined || major >= 17;
      let syntax = syntaxes.get(blocks);
      if (!syntax) syntaxes.set(blocks, (syntax = { blocks }));
      return syntax;
    },
    classes,
    byId: new Map(classes.map((c) => [c.id, c])),
    registryOf: (file) => registryFor(libraries.rootOf(file)),
    registries: () => [plain, ...[...libraries.byRoot.keys()].map(registryFor)],
    warnings: [...libraries.warnings],
    unexported: [],
  };
  revisions.set(revision.syntax, state);
  return state;
}

/** The component's template, parsed; undefined (and a warning) if it cannot be read. */
function templateOf(
  revision: PluginContext,
  state: Revision,
  cls: NgClass,
): ParsedTemplate | undefined {
  const template = cls.template;
  if (!template) return undefined;
  if (template.kind === 'inline') {
    const sf = revision.syntax(cls.file);
    if (!sf) return undefined;
    return parseTemplate(sf.text, cls.file, state.syntaxOf(cls.file), template.literal);
  }
  const text = revision.readFile(template.path);
  if (text === undefined) {
    warn(state, `${cls.file}: templateUrl ${template.path} not found`);
    return undefined;
  }
  return parseTemplate(text, template.path, state.syntaxOf(cls.file));
}

function warn(state: Revision, message: string): void {
  if (!state.warnings.includes(message)) state.warnings.push(message);
}

/** `src/app/foo.component.ts` + `FooComponent` → `src/app/foo.component.FooComponent.cpr.ts`. */
function shimPath(cls: NgClass): string {
  return `${cls.file.replace(/\.[cm]?tsx?$/, '')}.${cls.name}.cpr.ts`;
}

function templateId(cls: NgClass): string {
  return cls.template?.kind === 'external'
    ? `${cls.template.path}#(template)`
    : `${cls.id}.(template)`;
}

/**
 * The class's template and host bindings as TypeScript functions whose `this` is the class,
 * with a map from every name in them back to its template (or `.ts`) position.
 */
function buildShim(
  revision: PluginContext,
  state: Revision,
  cls: NgClass,
): VirtualFile | undefined {
  if (!cls.exported) {
    // A shim can only import exported classes. Tests and stories often skip the export: no
    // warning for those.
    if (!TEST_OR_STORY.test(cls.file)) state.unexported.push(`${cls.name} (${cls.file})`);
    return undefined;
  }
  const self = typeOf('__cpr_C', cls);
  const builder = new ShimBuilder();
  // Repo and library classes the template uses, imported under names of their own (`__cpr_D0`…).
  const imports = new Map<NgClass, string>();
  const use = (target: NgClass): string | undefined => {
    if (!target.exported) return undefined;
    let alias = imports.get(target);
    if (!alias) imports.set(target, (alias = `__cpr_D${imports.size}`));
    return alias;
  };

  const parsed = templateOf(revision, state, cls);
  if (parsed && cls.template) {
    const file = cls.template.kind === 'external' ? cls.template.path : cls.file;
    if (parsed.errors.length > 0) {
      warn(
        state,
        `${file}: template has syntax errors (${parsed.errors[0]}); references may be missing`,
      );
    }
    builder.source(templateId(cls), file);
    builder.write(`export function __cpr_template(this: ${self}): void {\n`);
    const own = state.registryOf(cls.file);
    const bound = bindTemplate(parsed, own.matcher);
    writeTemplate(parsed, builder, { bound, use, pipes: own.pipes });
    builder.write('}\n');
  }
  if (cls.host.length > 0) {
    builder.source(cls.id, cls.file);
    builder.write(`export function __cpr_host(this: ${self}): void {\n`);
    for (const error of writeHost(cls.host, builder, cls.file))
      warn(state, `${cls.file}: ${error}`);
    builder.write('}\n');
  }

  const header = [
    importLine(cls, '__cpr_C', cls.file, true),
    ...[...imports].map(([target, alias]) => importLine(target, alias, cls.file, false)),
    'declare function __cpr_pipe(...args: any[]): any;\n',
  ];
  builder.prepend(header.join(''));

  const positions = new Positions(revision);
  return {
    path: shimPath(cls),
    text: builder.text,
    map(offset) {
      const name = builder.at(offset);
      if (!name) return undefined;
      const at = positions.of(name.file, name.offset + offset - name.start);
      if (!at) return undefined;
      return {
        owner: name.owner,
        site: { file: name.file, ...at },
        ...(name.possible ? { possible: true } : {}),
      };
    },
  };
}

/**
 * What head templates still use of what this change removed: a component or directive by its
 * selector, a pipe by its name (Angular rejects both at build), an input still bound (rejected
 * too) and an output still listened to (accepted, and never fires: a warning). TypeScript
 * cannot see these: in head, nothing matches the selector or binding any more.
 */
function lostInTemplates(
  head: PluginRevision,
  removed: readonly SymbolDecl[],
  base: PluginRevision,
): Dangling[] {
  const before = revisionOf(base);
  const after = revisionOf(head);
  const gone = new Set(removed.map((r) => r.id));
  // Every project's registry: the same repo class is in each, so keep one meta per class.
  const metasOf = (state: Revision) =>
    new Map(
      state
        .registries()
        .flatMap((r) => [...r.metas.values()])
        .map((m) => [m.ref.key, m]),
    );
  const pipesOf = (state: Revision) => new Map(state.registries().flatMap((r) => [...r.pipes]));
  const beforeMetas = metasOf(before);
  const afterSelectors = new Set([...metasOf(after).values()].map((m) => m.selector));
  const afterPipes = pipesOf(after);

  const lostDirectives = [...beforeMetas.values()].filter(
    (m) => gone.has(m.ref.key) && !afterSelectors.has(m.selector),
  );
  const lostMatcher = new ng.SelectorMatcher<Meta[]>();
  for (const meta of lostDirectives) {
    matcherAdd(lostMatcher, meta);
  }
  const lostPipes = new Map(
    [...pipesOf(before)].filter(([name, cls]) => gone.has(cls.id) && !afterPipes.has(name)),
  );
  // Inputs and outputs removed from directives that are still there: binding → member.
  const lostBindings = (kind: 'inputs' | 'outputs') => {
    const lost = new Map<string, Map<string, string>>();
    for (const meta of beforeMetas.values()) {
      const now = after.byId.get(meta.ref.key);
      if (!now || gone.has(meta.ref.key)) continue;
      const still = new Set(after.registryOf(now.file)[kind](now).values());
      for (const [property, binding] of before.registryOf(meta.ref.cls.file)[kind](meta.ref.cls)) {
        const member = `${meta.ref.key}.${property}`;
        if (!gone.has(member) || still.has(binding)) continue;
        lost.set(
          meta.ref.key,
          (lost.get(meta.ref.key) ?? new Map<string, string>()).set(binding, member),
        );
      }
    }
    return lost;
  };
  const lostInputs = lostBindings('inputs');
  const lostOutputs = lostBindings('outputs');
  if (!lostDirectives.length && !lostPipes.size && !lostInputs.size && !lostOutputs.size) return [];

  const found: Dangling[] = [];
  const positions = new Positions(head);
  for (const cls of after.classes) {
    if (!cls.template) continue;
    const parsed = templateOf(head, after, cls);
    if (!parsed) continue;
    const file = cls.template.kind === 'external' ? cls.template.path : cls.file;
    const from = templateId(cls);
    const add = (target: string, offset: number, certainty: Dangling['certainty']) => {
      const at = positions.of(file, offset);
      if (at) found.push({ target, from, site: { file, ...at }, certainty, viaImport: false });
    };
    const bound = bindTemplate(parsed, after.registryOf(cls.file).matcher);
    const lostBound = lostDirectives.length ? bindTemplate(parsed, lostMatcher) : undefined;

    const visitor = new (class extends ng.CombinedRecursiveAstVisitor {
      override visitElement(element: ng.TmplAstElement): void {
        this.node(element);
        super.visitElement(element);
      }
      override visitTemplate(template: ng.TmplAstTemplate): void {
        this.node(template);
        super.visitTemplate(template);
      }
      override visitPipe(ast: ng.BindingPipe, context: unknown): void {
        const pipe = lostPipes.get(ast.name);
        if (pipe) add(pipe.id, ast.nameSpan.start, 'resolved');
        super.visitPipe(ast, context);
      }
      node(node: ng.TmplAstElement | ng.TmplAstTemplate): void {
        for (const meta of (lostBound?.getDirectivesOfNode(node) ?? []).filter(isMeta)) {
          add(meta.ref.key, directiveSite(node, meta.selector), 'resolved');
        }
        const metas = (bound.getDirectivesOfNode(node) ?? []).filter(isMeta);
        const own = !(node instanceof ng.TmplAstTemplate) || node.tagName === 'ng-template';
        const inputs = [
          ...(own ? [...node.attributes, ...node.inputs] : []),
          ...(node instanceof ng.TmplAstTemplate ? node.templateAttrs : []),
        ];
        for (const meta of metas) {
          const lostIn = lostInputs.get(meta.ref.key);
          const lostOut = lostOutputs.get(meta.ref.key);
          for (const input of lostIn ? inputs : []) {
            const member = lostIn?.get(input.name);
            if (member && !isMeta(bound.getConsumerOfBinding(input))) {
              add(member, (input.keySpan ?? input.sourceSpan).start.offset, 'resolved');
            }
          }
          for (const output of lostOut && own ? node.outputs : []) {
            const member = lostOut?.get(output.name);
            if (member && !isMeta(bound.getConsumerOfBinding(output))) {
              add(member, output.keySpan.start.offset, 'unknown');
            }
          }
        }
      }
    })();
    for (const node of parsed.nodes) node.visit(visitor);
  }
  return found;
}

function matcherAdd(matcher: ng.SelectorMatcher<Meta[]>, meta: Meta): void {
  try {
    matcher.addSelectables(ng.CssSelector.parse(meta.selector ?? ''), [meta]);
  } catch {
    // a selector Angular cannot parse matches nothing
  }
}

/**
 * `import { Foo as alias } from './foo.js';`, relative to the shim (next to `from`), or from the
 * library's entry point.
 */
function importLine(target: NgClass, alias: string, from: string, typeOnly: boolean): string {
  const kind = typeOnly ? 'import type' : 'import';
  if (target.module) return `${kind} { ${target.name} as ${alias} } from '${target.module}';\n`;
  let module = posix.relative(posix.dirname(from), target.file).replace(/\.[cm]?tsx?$/, '.js');
  if (!module.startsWith('.')) module = `./${module}`;
  return target.exported === 'default'
    ? `${kind} ${alias} from '${module}';\n`
    : `${kind} { ${target.name} as ${alias} } from '${module}';\n`;
}

/** 1-based line and column of offsets in a revision's files. */
class Positions {
  private readonly lineStarts = new Map<string, number[]>();
  constructor(private readonly revision: PluginContext) {}

  of(file: string, offset: number): { line: number; col: number } | undefined {
    let starts = this.lineStarts.get(file);
    if (!starts) {
      const text = this.revision.syntax(file)?.text ?? this.revision.readFile(file);
      if (text === undefined) return undefined;
      starts = [0];
      for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
      this.lineStarts.set(file, starts);
    }
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] as number) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, col: offset - (starts[low] as number) + 1 };
  }
}

function templateSymbol(
  revision: PluginRevision,
  cls: NgClass,
  parsed: ParsedTemplate,
): SymbolDecl {
  const template = cls.template as NonNullable<NgClass['template']>;
  const positions = new Positions(revision);
  let file: string;
  let text: string;
  let range: SymbolDecl['range'];
  if (template.kind === 'external') {
    file = template.path;
    text = revision.readFile(file) ?? '';
    const lines = text.split('\n');
    range = {
      start: { line: 1, col: 1 },
      end: { line: lines.length, col: (lines.at(-1)?.length ?? 0) + 1 },
    };
  } else {
    file = cls.file;
    text = template.literal.text;
    const start = positions.of(file, template.literal.start - 1);
    const end = positions.of(file, template.literal.end + 1);
    range = {
      start: start ?? { line: 1, col: 1 },
      end: end ?? start ?? { line: 1, col: 1 },
    };
  }
  const tokens = templateTokens(parsed, text);
  return {
    id: templateId(cls),
    kind: 'template',
    name: '(template)',
    container: template.kind === 'inline' ? cls.id : null,
    exported: false,
    file,
    range,
    signature: `template of ${cls.name}`,
    hashes: { signature: hash(['template']), body: hash(tokens) },
    bodySize: tokens.length,
  };
}

function hash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

/**
 * `@Component({ selector, imports, … })`: what templates elsewhere depend on (selector,
 * inputs, outputs, exportAs) is the class's signature; the rest is its body; its own template
 * is a symbol of its own and counts for neither.
 */
function decoratorRoles(
  revision: PluginRevision,
  decorator: ts.Decorator,
): ArgumentRoles | undefined {
  const tsApi = revision.ts;
  const kind = angularDecorator(tsApi, decorator);
  const signatureOptions = kind ? SIGNATURE_OPTIONS[kind] : undefined;
  if (!signatureOptions) return undefined;
  const options = decoratorOptions(tsApi, decorator);
  if (!options) return undefined;
  const roles = { signature: [] as ts.Node[], body: [] as ts.Node[] };
  for (const property of options.properties) {
    const name = propertyName(tsApi, property);
    if (kind === 'Component' && name === 'template') continue;
    (name && signatureOptions.has(name) ? roles.signature : roles.body).push(property);
  }
  return roles;
}
