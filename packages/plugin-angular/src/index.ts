import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type {
  ArgumentRoles,
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
import { ShimBuilder, writeHost, writeTemplate } from './shim.js';
import { parseTemplate, templateTokens, type ParsedTemplate, type Syntax } from './template.js';

const VERSION = '0.1.0';

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
  syntax: Syntax;
  classes: NgClass[];
  byId: Map<string, NgClass>;
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

  applies: (revision) =>
    dependsOnAngular(revision.packageJson) || !!revision.readFile('angular.json'),

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

/** The project's Angular major version: installed, or from package.json. */
function angularMajor(revision: PluginContext): number | undefined {
  const installed = revision.readFile('node_modules/@angular/core/package.json');
  if (installed) {
    try {
      const version = (JSON.parse(installed) as { version?: unknown }).version;
      if (typeof version === 'string') return Number.parseInt(version, 10);
    } catch {
      // fall back to package.json
    }
  }
  const manifest = revision.packageJson;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = manifest?.[field] as Record<string, unknown> | undefined;
    const range = deps?.['@angular/core'];
    const major = typeof range === 'string' ? /\d+/.exec(range)?.[0] : undefined;
    if (major) return Number(major);
  }
  return undefined;
}

function revisionOf(revision: PluginContext): Revision {
  const cached = revisions.get(revision.syntax);
  if (cached) return cached;
  const major = angularMajor(revision);
  const classes = revision.sourceFiles().flatMap((file) => {
    const sf = revision.syntax(file);
    return sf ? angularClasses(revision.ts, file, sf) : [];
  });
  const state: Revision = {
    // Block syntax and `@let` arrived in Angular 17; unknown versions get today's syntax.
    syntax: { blocks: major === undefined || major >= 17 },
    classes,
    byId: new Map(classes.map((c) => [c.id, c])),
    warnings: [],
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
    return parseTemplate(sf.text, cls.file, state.syntax, template.literal);
  }
  const text = revision.readFile(template.path);
  if (text === undefined) {
    warn(state, `${cls.file}: templateUrl ${template.path} not found`);
    return undefined;
  }
  return parseTemplate(text, template.path, state.syntax);
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
    // A shim can only import exported classes (tests and stories often skip the export).
    state.unexported.push(`${cls.name} (${cls.file})`);
    return undefined;
  }
  const self =
    cls.typeParameters > 0
      ? `__cpr_C<${Array.from({ length: cls.typeParameters }, () => 'any').join(', ')}>`
      : '__cpr_C';
  const module = `./${posix.basename(cls.file).replace(/\.[cm]?tsx?$/, '')}.js`;
  const builder = new ShimBuilder();
  builder.write(
    cls.exported === 'default'
      ? `import type __cpr_C from '${module}';\n`
      : `import type { ${cls.name} as __cpr_C } from '${module}';\n`,
  );
  builder.write('declare function __cpr_pipe(...args: any[]): any;\n');

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
    writeTemplate(parsed, builder);
    builder.write('}\n');
  }
  if (cls.host.length > 0) {
    builder.source(cls.id, cls.file);
    builder.write(`export function __cpr_host(this: ${self}): void {\n`);
    for (const error of writeHost(cls.host, builder, cls.file))
      warn(state, `${cls.file}: ${error}`);
    builder.write('}\n');
  }

  const positions = new Positions(revision);
  return {
    path: shimPath(cls),
    text: builder.text,
    map(offset) {
      const name = builder.at(offset);
      if (!name) return undefined;
      const at = positions.of(name.file, name.offset + offset - name.start);
      return at ? { owner: name.owner, site: { file: name.file, ...at } } : undefined;
    },
  };
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
