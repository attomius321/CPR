import { posix } from 'node:path';
import { ts } from 'ts-morph';
import type { Mention, MentionQuery, StyleScope } from '../../model.js';
import { runHook } from './plugins.js';
import { pluginRevision, type TsRevision } from './project.js';
import { enclosingSymbolId, nodeAt } from './syntax.js';

const CLASS_ATTRIBUTES = new Set(['class', 'className']);
const CLASS_LIST_METHODS = new Set(['add', 'remove', 'toggle', 'replace', 'contains']);
const CSS_MODULE = /\.module\.s?css$/;
const VAR = /var\(\s*(--[\w-]+)/g;
const CLASS_NAME = /^-?[_a-zA-Z][\w-]*$/;

/** What separates the words of a file's text that could be a class or a custom property. */
const SEPARATORS = /[\s"'`{}()[\],;=<>.!?|&+*/\\]+/;

/** Mentions per file, the files each word is in, and plugins' mentions by name: once per revision. */
interface Cached {
  files: Map<string, Mention[]>;
  words?: Map<string, string[]>;
  plugins?: Map<string, Mention[]>;
}

const cache = new WeakMap<TsRevision, Cached>();

/**
 * Where the revision's code names a class or a custom property (L2): static class names in a
 * JSX `class`/`className` (strings and object keys inside it; a token touching `${…}` names
 * none), `classList` calls, a CSS module's `styles.x`; custom properties set by a `'--x'` key
 * or `setProperty`, read by `var(--x)` in a string or `getPropertyValue`. Plugins add theirs
 * (templates). A file is walked only when its text holds a name asked for (a word index, built
 * the first time names are asked for).
 */
export function mentionsTs(revision: TsRevision, query: MentionQuery): Mention[] {
  let cached = cache.get(revision);
  if (!cached) {
    cached = { files: new Map() };
    cache.set(revision, cached);
  }
  const fromFile = query.from?.slice(0, query.from.indexOf('#')) ?? query.file;
  let paths: Iterable<string>;
  if (fromFile !== undefined) paths = [fromFile];
  else if (query.names) {
    const words = (cached.words ??= wordIndex(revision));
    const found = new Set<string>();
    for (const name of query.names) for (const path of words.get(name) ?? []) found.add(path);
    paths = found;
  } else paths = revision.context.sourceFiles();

  const found: Mention[] = [];
  for (const path of paths) {
    let mentions = cached.files.get(path);
    if (!mentions) {
      const sf = revision.context.syntax(path);
      if (!sf) continue;
      mentions = fileMentions(sf, path);
      cached.files.set(path, mentions);
    }
    found.push(...mentions);
  }
  cached.plugins ??= byName(
    revision.plugins.flatMap((active) => {
      const hook = active.plugin.mentions;
      return hook
        ? runHook(active, 'mentions', revision.warnings, [] as Mention[], () =>
            hook(pluginRevision(revision, active)),
          )
        : [];
    }),
  );
  if (query.names) {
    for (const name of query.names) found.push(...(cached.plugins.get(name) ?? []));
  } else {
    for (const mentions of cached.plugins.values()) found.push(...mentions);
  }
  return found.filter(
    (m) =>
      (!query.from || m.from === query.from) &&
      (!query.file || m.site.file === query.file) &&
      (!query.kind || m.kind === query.kind) &&
      (!query.names || query.names.has(m.name)),
  );
}

/** The source files each word of their text is in. */
function wordIndex(revision: TsRevision): Map<string, string[]> {
  const words = new Map<string, string[]>();
  for (const path of revision.context.sourceFiles()) {
    const text = revision.context.syntax(path)?.text;
    if (!text) continue;
    for (const word of new Set(text.split(SEPARATORS))) {
      const files = words.get(word);
      if (files) files.push(path);
      else words.set(word, [path]);
    }
  }
  return words;
}

function byName(mentions: readonly Mention[]): Map<string, Mention[]> {
  const found = new Map<string, Mention[]>();
  for (const m of mentions) found.set(m.name, [...(found.get(m.name) ?? []), m]);
  return found;
}

/** Stylesheets plugins say style only some markup, their owners named as extraction names them. */
export function styleScopesTs(revision: TsRevision): StyleScope[] {
  return revision.plugins.flatMap((active) => {
    const hook = active.plugin.styleScopes;
    if (!hook) return [];
    const scopes = runHook(active, 'styleScopes', revision.warnings, [], () =>
      hook(pluginRevision(revision, active)),
    );
    return scopes.map(({ stylesheet, owners = [], calls = [] }) => ({
      stylesheet,
      owners: [
        ...owners,
        ...calls.flatMap(({ file, position }) => {
          const sf = revision.context.syntax(file);
          const node = sf && nodeAt(sf, position);
          const owner = node && enclosingSymbolId(node, sf, file);
          return owner ? [owner] : [];
        }),
      ],
    }));
  });
}

function fileMentions(sf: ts.SourceFile, file: string): Mention[] {
  const mentions: Mention[] = [];
  const modules = cssModules(sf, file);
  const add = (
    node: ts.Node,
    kind: Mention['kind'],
    name: string,
    position: number,
    extra: Partial<Mention> = {},
  ) => {
    const from = enclosingSymbolId(node, sf, file);
    if (!from) return;
    const { line, character } = sf.getLineAndCharacterOfPosition(position);
    mentions.push({
      from,
      kind,
      name,
      site: { file, line: line + 1, col: character + 1 },
      ...extra,
    });
  };

  /** Class names in a piece of literal text starting at `start`; `open` sides touch `${…}`. */
  const classes = (
    node: ts.Node,
    text: string,
    start: number,
    openLeft = false,
    openRight = false,
  ) => {
    for (const match of text.matchAll(/\S+/g)) {
      const at = match.index;
      const token = match[0];
      if ((openLeft && at === 0) || (openRight && at + token.length === text.length)) continue;
      if (CLASS_NAME.test(token)) add(node, 'class', token, start + at);
    }
  };

  /** Every class name inside a class attribute's value. */
  const classValue = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      classes(node, node.text, node.getStart(sf) + 1);
    } else if (ts.isTemplateExpression(node)) {
      const head = node.head;
      classes(head, head.text, head.getStart(sf) + 1, false, true);
      for (const span of node.templateSpans) {
        classValue(span.expression);
        const literal = span.literal;
        classes(
          literal,
          literal.text,
          literal.getStart(sf) + 1,
          true,
          ts.isTemplateMiddle(literal),
        );
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        const name = property.name;
        if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
          if (CLASS_NAME.test(name.text))
            add(name, 'class', name.text, name.getStart(sf) + (ts.isStringLiteral(name) ? 1 : 0));
        }
        if (ts.isPropertyAssignment(property)) classValue(property.initializer);
      }
    } else if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) {
      ts.forEachChild(node, classValue);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (CLASS_ATTRIBUTES.has(node.name.text)) {
        const value = node.initializer;
        classValue(ts.isJsxExpression(value) ? (value.expression ?? value) : value);
      }
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const target = node.expression.expression;
      const [first] = node.arguments;
      if (
        CLASS_LIST_METHODS.has(method) &&
        ts.isPropertyAccessExpression(target) &&
        target.name.text === 'classList'
      ) {
        const args = method === 'toggle' ? node.arguments.slice(0, 1) : node.arguments;
        for (const arg of args) {
          if (ts.isStringLiteralLike(arg) && CLASS_NAME.test(arg.text)) {
            add(arg, 'class', arg.text, arg.getStart(sf) + 1);
          }
        }
      } else if (first && ts.isStringLiteralLike(first) && first.text.startsWith('--')) {
        if (method === 'setProperty')
          add(first, 'property', first.text, first.getStart(sf) + 1, { sets: true });
        else if (method === 'getPropertyValue')
          add(first, 'property', first.text, first.getStart(sf) + 1);
      }
    } else if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      modules.has(node.expression.text)
    ) {
      const name = ts.isPropertyAccessExpression(node)
        ? node.name
        : ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression
          : undefined;
      if (name && CLASS_NAME.test(name.text)) {
        add(name, 'class', name.text, name.getStart(sf) + (ts.isIdentifier(name) ? 0 : 1), {
          module: modules.get(node.expression.text) as string,
        });
      }
    } else if (
      ts.isPropertyAssignment(node) &&
      ts.isStringLiteral(node.name) &&
      node.name.text.startsWith('--')
    ) {
      add(node.name, 'property', node.name.text, node.name.getStart(sf) + 1, { sets: true });
    }
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      for (const match of node.text.matchAll(VAR)) {
        add(node, 'property', match[1] as string, node.getStart(sf) + 1 + match.index);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return mentions;
}

/** `import styles from './card.module.css'`: local name → the module's repo-relative path. */
function cssModules(sf: ts.SourceFile, file: string): Map<string, string> {
  const modules = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const specifier = statement.moduleSpecifier.text;
    if (!CSS_MODULE.test(specifier) || !specifier.startsWith('.')) continue;
    const path = posix.normalize(posix.join(posix.dirname(file), specifier));
    const clause = statement.importClause;
    if (clause?.name) modules.set(clause.name.text, path);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) modules.set(bindings.name.text, path);
  }
  return modules;
}
