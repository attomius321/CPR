import type { AtRule, ChildNode, Declaration, Root } from 'postcss';
import valueParser from 'postcss-value-parser';
import type { EdgeKind, Site, SymbolId } from '../../model.js';

/** What a stylesheet can name: a custom property, keyframes, or a SCSS member. */
export type UseKind = 'property' | 'keyframes' | 'variable' | 'mixin' | 'function' | 'placeholder';

/** A name a stylesheet uses, in the symbol it is in. */
export interface StyleUse {
  /** The symbol it is in, or `<file>#(module)` for top-level code. */
  from: SymbolId;
  kind: UseKind;
  /** `--accent`, `spin`, `$primary`, `themify`, `rem`, `%base`. */
  name: string;
  /** `ns` in `ns.$var` or `ns.mixin()`: a `@use` namespace. */
  namespace?: string;
  site: Site;
}

/** `@import`, `@use` or `@forward` of another stylesheet, in the order they come. */
export interface StyleImport {
  rule: 'import' | 'use' | 'forward';
  url: string;
  /** `@use`'s namespace: `as ns`, the URL's last segment by default, null for `as *`. */
  namespace?: string | null;
  /** `@forward … as prefix-*`. */
  prefix?: string;
}

export const USE_EDGE: Record<UseKind, EdgeKind> = {
  property: 'reference',
  keyframes: 'reference',
  variable: 'reference',
  mixin: 'call',
  function: 'call',
  placeholder: 'extends',
};

const VARIABLE = /(?:([A-Za-z_][\w-]*)\.)?\$([A-Za-z_][\w-]*)/g;
const FUNCTION_NAME = /^(?:([A-Za-z_][\w-]*)\.)?([A-Za-z_][\w-]*)$/;
const IDENTIFIER = /^-?[A-Za-z_][\w-]*$/;
const ANIMATION = /^(?:-[a-z]+-)?animation(?:-name)?$/i;

/**
 * Collects the names a stylesheet uses and the stylesheets it imports. CSS names only custom
 * properties and keyframes; SCSS also its variables, mixins, functions and placeholders —
 * except locals (a mixin's parameters, a loop's variables, a `$x:` set inside a block).
 */
export class UseCollector {
  readonly uses: StyleUse[] = [];
  readonly imports: StyleImport[] = [];
  private readonly lineStarts: number[];

  constructor(
    private readonly file: string,
    root: Root,
    private readonly scss: boolean,
  ) {
    const text = root.source?.input.css ?? '';
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') this.lineStarts.push(i + 1);
  }

  /** The uses in a declaration's value, and keyframes it names in `animation`. */
  declaration(node: Declaration, from: SymbolId, locals: ReadonlySet<string>): void {
    const start = node.source?.start?.offset;
    if (start === undefined) return;
    const offset = start + node.prop.length + (node.raws.between?.length ?? 1);
    this.value(node.value, offset, from, locals, ANIMATION.test(node.prop));
  }

  /**
   * The uses in an at-rule's prelude: `@include`, `@extend`, a condition, a loop. Adds the
   * loop's variables to `locals`, for what the at-rule holds.
   */
  atRule(node: AtRule, from: SymbolId, locals: Set<string>): void {
    const offset = UseCollector.preludeOffset(node);
    if (offset === undefined || !this.scss) return;
    const name = node.name.toLowerCase();
    const params = node.params;
    if (name === 'include') {
      const match = /^\s*(?:([A-Za-z_][\w-]*)\.)?([A-Za-z_][\w-]*)/.exec(params);
      if (!match) return;
      const [whole, namespace, mixin = ''] = match;
      this.add(from, 'mixin', mixin, namespace, offset + whole.search(/\S/));
      this.value(params.slice(whole.length), offset + whole.length, from, locals, false);
    } else if (name === 'extend') {
      const match = /%[\w-]+/.exec(params);
      if (match) this.add(from, 'placeholder', match[0], undefined, offset + match.index);
    } else if (name === 'each' || name === 'for') {
      const head = name === 'each' ? /^(.*?)\s+in\s/s.exec(params) : /^(\$[\w-]+)\s/.exec(params);
      for (const variable of (head?.[1] ?? '').match(/\$[\w-]+/g) ?? []) locals.add(variable);
      const rest = head ? head[0].length : 0;
      this.value(params.slice(rest), offset + rest, from, locals, false);
    } else if (
      !['use', 'forward', 'import', 'mixin', 'function', 'content', 'at-root'].includes(name)
    ) {
      this.value(params, offset, from, locals, false);
    }
  }

  /** The uses in an expression at `offset` of the file (a parameter's default). */
  expression(text: string, offset: number, from: SymbolId, locals: ReadonlySet<string>): void {
    this.value(text, offset, from, locals, false);
  }

  /** Where an at-rule's prelude starts in the file. */
  static preludeOffset(node: AtRule): number | undefined {
    const start = node.source?.start?.offset;
    return start === undefined
      ? undefined
      : start + 1 + node.name.length + (node.raws.afterName?.length ?? 1);
  }

  /** Every use inside some nodes (a mixin's or keyframes' body), all owned by `from`. */
  block(
    nodes: readonly ChildNode[] | undefined,
    from: SymbolId,
    locals: ReadonlySet<string>,
  ): void {
    const own = new Set(locals);
    for (const node of nodes ?? []) {
      if (node.type === 'decl') {
        this.declaration(node, from, own);
        if (node.prop.startsWith('$') && !/!global\b/.test(node.value)) own.add(node.prop);
      } else if (node.type === 'rule') {
        this.block(node.nodes, from, own);
      } else if (node.type === 'atrule') {
        const inner = new Set(own);
        this.atRule(node, from, inner);
        this.block(node.nodes, from, inner);
      }
    }
  }

  /** A top-level `@import`, `@use` or `@forward`. */
  statement(node: AtRule): void {
    const name = node.name.toLowerCase();
    if (name !== 'import' && name !== 'use' && name !== 'forward') return;
    const strings = valueParser(node.params).nodes.filter((n) => n.type === 'string');
    if (name === 'import') {
      for (const url of strings) this.imports.push({ rule: 'import', url: url.value });
      return;
    }
    const [first] = strings;
    if (!first) return;
    if (name === 'use') {
      const as = /\bas\s+(\*|[\w-]+)/.exec(node.params);
      this.imports.push({
        rule: 'use',
        url: first.value,
        namespace: as ? (as[1] === '*' ? null : (as[1] ?? null)) : defaultNamespace(first.value),
      });
    } else {
      const as = /\bas\s+([\w-]+)\*/.exec(node.params);
      this.imports.push({
        rule: 'forward',
        url: first.value,
        ...(as?.[1] ? { prefix: as[1] } : {}),
      });
    }
  }

  private value(
    value: string,
    offset: number,
    from: SymbolId,
    locals: ReadonlySet<string>,
    animation: boolean,
  ): void {
    valueParser(value).walk((node) => {
      const at = offset + node.sourceIndex;
      if (node.type === 'function') {
        if (node.value.toLowerCase() === 'var') {
          const name = node.nodes.find((n) => n.type === 'word');
          if (name?.value.startsWith('--')) {
            this.add(from, 'property', name.value, undefined, offset + name.sourceIndex);
          }
        } else if (this.scss) {
          const match = FUNCTION_NAME.exec(node.value);
          if (match?.[2]) this.add(from, 'function', match[2], match[1], at);
        }
      } else if (node.type === 'word') {
        if (this.scss) {
          for (const match of node.value.matchAll(VARIABLE)) {
            const [, namespace, bare] = match;
            const name = `$${bare}`;
            if (!namespace && locals.has(name)) continue;
            this.add(from, 'variable', name, namespace, at + match.index);
          }
        }
        if (animation && IDENTIFIER.test(node.value)) {
          this.add(from, 'keyframes', node.value, undefined, at);
        }
      }
    });
  }

  private add(
    from: SymbolId,
    kind: UseKind,
    name: string,
    namespace: string | undefined,
    offset: number,
  ): void {
    this.uses.push({
      from,
      kind,
      name,
      ...(namespace ? { namespace } : {}),
      site: this.site(offset),
    });
  }

  private site(offset: number): Site {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.lineStarts[mid] as number) <= offset) low = mid;
      else high = mid - 1;
    }
    return { file: this.file, line: low + 1, col: offset - (this.lineStarts[low] as number) + 1 };
  }
}

/** `@use 'src/corners'` → `corners`; `@use 'sass:math'` → `math`; `_index` folders by name. */
function defaultNamespace(url: string): string {
  const segments = url.replace(/^sass:/, '').split('/');
  let last = segments.pop() ?? url;
  if (/^_?index(\.s?css)?$/.test(last)) last = segments.pop() ?? last;
  return last.replace(/^_/, '').replace(/\.s?css$/, '');
}
