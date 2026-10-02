import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { ts } from 'ts-morph';
import type {
  PluginContext,
  PluginSymbol,
  Site,
  SymbolDecl,
  TsPlugin,
  VirtualFile,
} from '../../src/index.js';

/**
 * A plugin for a made-up framework, exercising every plugin hook: a class decorated with
 * `@View({ template: './card.tpl' })` renders a template whose `{{ expressions }}` run on the
 * class instance; its `onStart()` is called by the framework; `tags` in `@View` is
 * configuration, not contract.
 */
export const tplPlugin: TsPlugin = {
  name: 'tpl',
  version: '1.0.0',
  apiVersion: 1,
  applies: (revision) => {
    const deps = revision.packageJson?.dependencies;
    return !!deps && typeof deps === 'object' && 'tpl-framework' in deps;
  },
  matches: (path) => path.endsWith('.tpl'),
  virtualFiles: (revision) =>
    components(revision).flatMap((component) => {
      const text = revision.readFile(component.template);
      return text === undefined ? [] : [shim(component, text)];
    }),
  extract: (revision, files) => {
    const found: PluginSymbol[] = [];
    for (const component of components(revision)) {
      if (!files.includes(component.template)) continue;
      const text = revision.readFile(component.template);
      const shimFile = revision.virtual(shimPath(component.template));
      if (text === undefined || !shimFile) continue;
      const render = shimFile.statements.find(
        (s) => revision.ts.isFunctionDeclaration(s) && s.name?.text === '__template',
      );
      found.push({ symbol: templateSymbol(component, text), nodes: render ? [render] : [] });
    }
    return found;
  },
  decoratorArguments: (revision, decorator) => {
    const options = viewOptions(revision.ts, decorator);
    if (!options) return undefined;
    const roles = { signature: [] as ts.Node[], body: [] as ts.Node[] };
    for (const property of options.properties) {
      const name = property.name && revision.ts.isIdentifier(property.name) && property.name.text;
      (name === 'template' ? roles.signature : roles.body).push(property);
    }
    return roles;
  },
  exposure: (revision, symbol) => {
    if (symbol.kind === 'template') return 'framework';
    const isComponent = (id: string | null) =>
      components(revision).some((c) => `${c.file}#${c.name}` === id);
    return symbol.kind === 'method' && symbol.name === 'onStart' && isComponent(symbol.container)
      ? 'framework'
      : undefined;
  },
  warnings: (revision) =>
    components(revision)
      .filter((c) => revision.readFile(c.template) === undefined)
      .map((c) => `${c.file}: template ${c.template} not found`),
};

interface Component {
  /** Repo-relative file of the class. */
  file: string;
  name: string;
  /** Repo-relative template file. */
  template: string;
}

const cache = new WeakMap<PluginContext['syntax'], Component[]>();

/** Classes decorated with `@View({ template })`, by syntax. */
function components(revision: PluginContext): Component[] {
  const cached = cache.get(revision.syntax);
  if (cached) return cached;
  const { ts } = revision;
  const found: Component[] = [];
  for (const file of revision.sourceFiles()) {
    const sf = revision.syntax(file);
    for (const statement of sf?.statements ?? []) {
      if (!ts.isClassDeclaration(statement) || !statement.name) continue;
      for (const decorator of ts.getDecorators(statement) ?? []) {
        const template = viewOptions(ts, decorator)?.properties.find(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) &&
            ts.isIdentifier(p.name) &&
            p.name.text === 'template' &&
            ts.isStringLiteral(p.initializer),
        );
        if (!template) continue;
        const path = (template.initializer as ts.StringLiteral).text;
        found.push({
          file,
          name: statement.name.text,
          template: posix.join(posix.dirname(file), path),
        });
      }
    }
  }
  cache.set(revision.syntax, found);
  return found;
}

function viewOptions(
  tsApi: typeof ts,
  decorator: ts.Decorator,
): ts.ObjectLiteralExpression | undefined {
  const call = decorator.expression;
  if (!tsApi.isCallExpression(call) || !tsApi.isIdentifier(call.expression)) return undefined;
  if (call.expression.text !== 'View') return undefined;
  const [options] = call.arguments;
  return options && tsApi.isObjectLiteralExpression(options) ? options : undefined;
}

const shimPath = (template: string) => `${template}.cpr.ts`;
const templateId = (template: string) => `${template}#(template)`;

/** `{{ expression }}` occurrences of a template, with their 1-based positions. */
function expressions(text: string): { code: string; line: number; col: number }[] {
  const found: { code: string; line: number; col: number }[] = [];
  text.split('\n').forEach((lineText, i) => {
    for (const match of lineText.matchAll(/\{\{(.*?)\}\}/g)) {
      found.push({ code: match[1] ?? '', line: i + 1, col: match.index + 3 });
    }
  });
  return found;
}

/**
 * The template as TypeScript: each expression becomes a statement on `this`, the component.
 * Names not after a `.` are the component's; `map` sends each name back to the template.
 */
function shim(component: Component, text: string): VirtualFile {
  const from = posix.relative(posix.dirname(component.template), component.file);
  const module = (from.startsWith('.') ? from : `./${from}`).replace(/\.ts$/, '');
  let out =
    `import type { ${component.name} as __C } from '${module}';\n` +
    `export function __template(this: __C): void {\n`;
  const names: { start: number; end: number; site: Site }[] = [];
  for (const { code, line, col } of expressions(text)) {
    out += '  ';
    let afterDot = false;
    for (const token of code.matchAll(/[A-Za-z_$][\w$]*|\s+|./g)) {
      const value = token[0];
      if (/^[A-Za-z_$]/.test(value)) {
        if (!afterDot) out += 'this.';
        names.push({
          start: out.length,
          end: out.length + value.length,
          site: { file: component.template, line, col: col + token.index },
        });
      }
      if (!/^\s+$/.test(value)) afterDot = value === '.';
      out += value;
    }
    out += ';\n';
  }
  out += '}\n';
  return {
    path: shimPath(component.template),
    text: out,
    map(offset) {
      const name = names.find((n) => offset >= n.start && offset < n.end);
      return name
        ? {
            owner: templateId(component.template),
            site: { ...name.site, col: name.site.col + offset - name.start },
          }
        : undefined;
    },
  };
}

function templateSymbol(component: Component, text: string): SymbolDecl {
  const tokens = text.split(/\s+/).filter(Boolean);
  const lines = text.split('\n');
  return {
    id: templateId(component.template),
    kind: 'template',
    name: '(template)',
    container: null,
    exported: false,
    file: component.template,
    range: {
      start: { line: 1, col: 1 },
      end: { line: lines.length, col: (lines.at(-1)?.length ?? 0) + 1 },
    },
    signature: `template of ${component.name}`,
    hashes: { signature: hash(['template']), body: hash(tokens) },
    bodySize: tokens.length,
  };
}

function hash(parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

/** A plugin whose every hook throws: the analysis must go on without it. */
export const brokenPlugin: TsPlugin = {
  ...tplPlugin,
  name: 'broken',
  extract: () => {
    throw new Error('boom');
  },
};
