import type { AtRule, ChildNode, Container, Declaration, Node, Root } from 'postcss';
import type { Range, Shape, SymbolDecl, SymbolId, SymbolKind } from '../../model.js';
import { stylesheetLanguage } from './files.js';
import { canonicalSelector, canonicalValue, hash, splitTopLevel, valueTokens } from './tokens.js';
import { UseCollector, type StyleImport, type StyleUse } from './uses.js';

/** Joins a context (an at-rule, the rule of a custom property) to what it holds in an ID. */
export const CONTEXT = ' › ';

/** At-rules that group rules under a condition or a layer: contexts, not symbols. */
const GROUPING = new Set([
  'media',
  'supports',
  'container',
  'layer',
  'document',
  '-moz-document',
  'scope',
  'starting-style',
]);

/** SCSS control flow: at the top level, a context for the rules it holds. */
const CONTROL = new Set(['if', 'else', 'each', 'for', 'while']);

/** Preludes read as selectors rather than values. */
const SELECTOR_PRELUDES = new Set(['page', 'scope']);

/** Longest signature shown for a rule or a value. */
const MAX_SIGNATURE = 80;

/** The rule a nested symbol is in. */
interface Enclosing {
  id: string;
  qualified: string;
  /** Its resolved selectors, which nested selectors are resolved against. */
  selectors: string[];
}

interface Scope {
  context: string[];
  rule?: Enclosing;
  /** Who the names used here belong to: the enclosing symbol, or the file's top-level code. */
  owner: SymbolId;
  /** SCSS variables local here (a loop's). */
  locals: ReadonlySet<string>;
}

/** What one stylesheet declares, uses and imports. */
export interface StylesheetFacts {
  symbols: SymbolDecl[];
  uses: StyleUse[];
  imports: StyleImport[];
}

/**
 * The symbols of one stylesheet: rules (with their resolved selector), the custom properties
 * they define, keyframes, and SCSS's top-level variables, mixins and functions. IDs are
 * `<file>#<context › name>`; a name repeated in one file gets ` (2)`, ` (3)`. With them, the
 * names each symbol uses and the stylesheets the file imports.
 */
export function extractStylesheet(file: string, root: Root): StylesheetFacts {
  const language = stylesheetLanguage(file);
  const module = `${file}#(module)`;
  const uses = new UseCollector(file, root, language === 'scss');
  const symbols: SymbolDecl[] = [];
  const counts = new Map<string, number>();
  const unique = (qualified: string) => {
    const n = (counts.get(qualified) ?? 0) + 1;
    counts.set(qualified, n);
    return n === 1 ? qualified : `${qualified} (${n})`;
  };

  const add = (
    node: Node,
    kind: SymbolKind,
    name: string,
    qualified: string,
    container: string | null,
    signature: { shown: string; parts: string[] },
    body: string[],
    shape?: Shape,
  ): string => {
    const id = `${file}#${unique(qualified)}`;
    symbols.push({
      id,
      kind,
      name,
      container,
      exported: !/^[$%@]?[-_]/.test(name.replace(/^@(mixin|function) /, '')),
      file,
      range: rangeOf(node),
      signature: signature.shown,
      hashes: { signature: hash([kind, ...signature.parts]), body: hash(body) },
      bodySize: body.length,
      ...(shape ? { shape } : {}),
      language,
    });
    return id;
  };

  const rule = (node: Container, selectors: string[], name: string, scope: Scope) => {
    const qualified = [...scope.context, name].join(CONTEXT);
    const own = ownTokens(node);
    const id = add(
      node,
      'rule',
      name,
      qualified,
      scope.rule?.id ?? null,
      { shown: block(own.shown), parts: [qualified] },
      own.tokens,
    );
    const enclosing = { id, qualified: id.slice(id.indexOf('#') + 1), selectors };
    const locals = new Set(scope.locals);
    for (const child of node.nodes ?? []) {
      if (child.type === 'decl' && child.prop.startsWith('--')) {
        const property = `${enclosing.qualified}${CONTEXT}${child.prop}`;
        const propertyId = add(
          child,
          'variable',
          child.prop,
          property,
          id,
          { shown: shorten(`${child.prop}: ${canonicalValue(child.value)}`), parts: [property] },
          valueTokens(child.value),
        );
        uses.declaration(child, propertyId, locals);
      } else if (child.type === 'decl') {
        uses.declaration(child, id, locals);
        if (child.prop.startsWith('$')) locals.add(child.prop);
      } else if (child.type === 'atrule' && !isOwnRule(child)) {
        const inner = new Set(locals);
        uses.atRule(child, id, inner);
        uses.block(child.nodes, id, inner);
      }
    }
    walk(node.nodes, { context: scope.context, rule: enclosing, owner: id, locals });
  };

  const atRule = (node: AtRule, scope: Scope) => {
    const name = node.name.toLowerCase();
    if (!node.nodes) {
      // A statement: @import, @use, @include at the top level (inside a rule, its body).
      if (!scope.rule) {
        uses.statement(node);
        uses.atRule(node, scope.owner, new Set(scope.locals));
      }
      return;
    }
    if (/keyframes$/.test(name)) {
      const own = `@${node.name} ${node.params.trim()}`;
      const qualified = [...scope.context, own].join(CONTEXT);
      const id = add(
        node,
        'keyframes',
        own,
        qualified,
        null,
        { shown: own, parts: [qualified] },
        all(node.nodes),
      );
      uses.block(node.nodes, id, scope.locals);
    } else if (name === 'mixin' || name === 'function') {
      if (!scope.rule && scope.context.length === 0) callable(node, name);
    } else if (name === 'at-root') {
      const selectors = node.params ? splitTopLevel(canonicalSelector(node.params), ',') : [];
      const outer = { context: scope.context, owner: module, locals: scope.locals };
      if (selectors.length > 0) rule(node, selectors, selectors.join(', '), outer);
      else walk(node.nodes, outer);
    } else if (scope.rule) {
      // Inside a rule, only a condition (`@media`) holds a rule of its own; anything else
      // (`@include … { }`, `@if`) is part of the rule's body.
      if (!GROUPING.has(name)) return;
      const context = [...scope.context, prelude(node)];
      const inner = { ...scope, context };
      if (node.nodes.some((child) => child.type === 'decl')) {
        rule(node, scope.rule.selectors, scope.rule.selectors.join(', '), inner);
      } else {
        walk(node.nodes, inner);
      }
    } else if (
      !GROUPING.has(name) &&
      !CONTROL.has(name) &&
      !node.nodes.some((child) => child.type === 'rule' || (child.type === 'atrule' && child.nodes))
    ) {
      // A block of descriptors: `@font-face`, `@page`, `@property`, `@counter-style`.
      const own = prelude(node);
      rule(node, [own], own, scope);
    } else {
      const locals = new Set(scope.locals);
      uses.atRule(node, scope.owner, locals);
      walk(node.nodes, { ...scope, context: [...scope.context, prelude(node)], locals });
    }
  };

  const callable = (node: AtRule, kind: 'mixin' | 'function') => {
    const open = node.params.indexOf('(');
    const bare = (open < 0 ? node.params : node.params.slice(0, open)).trim();
    const args =
      open < 0 ? [] : splitTopLevel(node.params.slice(open + 1, node.params.lastIndexOf(')')), ',');
    const params = args.map((arg) => {
      const colon = arg.indexOf(':');
      const name = (colon < 0 ? arg : arg.slice(0, colon)).trim();
      const value = colon < 0 ? undefined : arg.slice(colon + 1).trim();
      return { name, value, optional: value !== undefined || name.endsWith('...') };
    });
    const own = `@${kind} ${bare}`;
    const shown = `${own}(${params.map((p) => (p.value === undefined ? p.name : `${p.name}: ${canonicalValue(p.value)}`)).join(', ')})`;
    const id = add(
      node,
      kind,
      own,
      own,
      null,
      {
        shown: shorten(shown),
        parts: [
          own,
          ...params.flatMap((p) => [
            p.name,
            ...(p.value === undefined ? [] : [':', ...valueTokens(p.value)]),
          ]),
        ],
      },
      all(node.nodes),
      {
        params: params.map((p) => ({ optional: p.optional, type: '' })),
        rest: own,
      },
    );
    // Defaults are read where the mixin is declared: they use the stylesheet's own names.
    const start = UseCollector.preludeOffset(node);
    if (start !== undefined) {
      for (const p of params) {
        if (p.value !== undefined) {
          uses.expression(p.value, start + node.params.indexOf(p.value), id, new Set());
        }
      }
    }
    uses.block(node.nodes, id, new Set(params.map((p) => p.name.replace(/\.\.\.$/, ''))));
  };

  const variable = (node: Declaration) => {
    const tokens = valueTokens(node.value);
    const isFlag = (t: string) => t === '!default' || t === '!global';
    const flags = tokens.filter(isFlag);
    const id = add(
      node,
      'variable',
      node.prop,
      node.prop,
      null,
      {
        shown: shorten(`${node.prop}: ${canonicalValue(node.value)}`),
        parts: [node.prop, ...flags],
      },
      tokens.filter((t) => !isFlag(t)),
    );
    uses.declaration(node, id, new Set());
  };

  const walk = (nodes: readonly ChildNode[] | undefined, scope: Scope) => {
    for (const node of nodes ?? []) {
      if (node.type === 'rule') {
        const selectors = resolve(scope.rule?.selectors, node.selector);
        rule(node, selectors, selectors.join(', '), scope);
      } else if (node.type === 'atrule') {
        atRule(node, scope);
      } else if (
        node.type === 'decl' &&
        node.prop.startsWith('$') &&
        node.parent?.type === 'root'
      ) {
        variable(node);
      }
    }
  };

  walk(root.nodes, { context: [], owner: module, locals: new Set() });
  return { symbols, uses: uses.uses, imports: uses.imports };
}

/** An at-rule inside a rule that holds a rule of its own (a condition, `@at-root`). */
function isOwnRule(node: AtRule): boolean {
  const name = node.name.toLowerCase();
  return node.nodes !== undefined && (GROUPING.has(name) || name === 'at-root');
}

/** A nested selector list resolved against its parent's, as Sass and CSS nesting do. */
export function resolve(parents: readonly string[] | undefined, selector: string): string[] {
  const own = splitTopLevel(canonicalSelector(selector), ',');
  if (!parents) return own;
  return parents.flatMap((parent) =>
    own.map((child) =>
      canonicalSelector(child.includes('&') ? child.replaceAll('&', parent) : `${parent} ${child}`),
    ),
  );
}

/** `@media (max-width: 900px)`: an at-rule's name and canonical prelude. */
function prelude(node: AtRule): string {
  const name = node.name.toLowerCase();
  const params = node.params.trim();
  if (params === '') return `@${name}`;
  return `@${name} ${SELECTOR_PRELUDES.has(name) ? canonicalSelector(params) : canonicalValue(params)}`;
}

/** A rule's own declarations and statements: not its custom properties or nested rules. */
function ownTokens(node: Container): { tokens: string[]; shown: string[] } {
  const tokens: string[] = [];
  const shown: string[] = [];
  for (const child of node.nodes ?? []) {
    if (child.type === 'decl') {
      if (child.prop.startsWith('--')) continue;
      declaration(child, tokens);
      shown.push(
        `${property(child.prop)}: ${canonicalValue(child.value)}${child.important ? ' !important' : ''}`,
      );
    } else if (child.type === 'atrule') {
      const name = child.name.toLowerCase();
      if (child.nodes && (GROUPING.has(name) || name === 'at-root')) continue;
      all([child], tokens);
      shown.push(
        `@${name}${child.params ? ` ${canonicalValue(child.params)}` : ''}${child.nodes ? ' { … }' : ''}`,
      );
    }
  }
  return { tokens, shown };
}

/** Every token of some nodes: declarations, rules and at-rules with what they hold. */
function all(nodes: readonly ChildNode[] | undefined, out: string[] = []): string[] {
  for (const node of nodes ?? []) {
    if (node.type === 'decl') declaration(node, out);
    else if (node.type === 'rule') {
      out.push(canonicalSelector(node.selector), '{');
      all(node.nodes, out);
      out.push('}');
    } else if (node.type === 'atrule') {
      out.push(`@${node.name.toLowerCase()}`);
      valueTokens(node.params, out);
      if (node.nodes) {
        out.push('{');
        all(node.nodes, out);
        out.push('}');
      } else out.push(';');
    }
  }
  return out;
}

function declaration(node: Declaration, out: string[]): void {
  out.push(property(node.prop), ':');
  valueTokens(node.value, out);
  if (node.important) out.push('!important');
  out.push(';');
}

/** Property names are case-insensitive, custom properties and SCSS variables are not. */
function property(name: string): string {
  return name.startsWith('--') || name.startsWith('$') ? name : name.toLowerCase();
}

/** `{ color: red; margin: 0 }`, cut at a declaration when long. */
function block(shown: readonly string[]): string {
  if (shown.length === 0) return '{ }';
  let text = '';
  for (const [i, part] of shown.entries()) {
    const next = text === '' ? part : `${text}; ${part}`;
    if (next.length > MAX_SIGNATURE && i > 0) return `{ ${text}; … }`;
    text = next;
  }
  return `{ ${shorten(text)} }`;
}

function shorten(text: string): string {
  return text.length > MAX_SIGNATURE ? `${text.slice(0, MAX_SIGNATURE - 1)}…` : text;
}

/** postcss's 1-based start, and its inclusive end made exclusive. */
function rangeOf(node: Node): Range {
  const start = node.source?.start;
  const end = node.source?.end;
  return {
    start: { line: start?.line ?? 1, col: start?.column ?? 1 },
    end: { line: end?.line ?? start?.line ?? 1, col: (end?.column ?? start?.column ?? 0) + 1 },
  };
}
