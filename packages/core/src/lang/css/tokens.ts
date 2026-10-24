import { createHash } from 'node:crypto';
import valueParser, { type Node as ValueNode } from 'postcss-value-parser';

/** 16 hex characters, as for TypeScript symbols. */
export function hash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

const NUMBER = /^([+-]?)(\d*\.?\d+|\d+\.)(e[+-]?\d+)?([a-z%]*)$/i;
const HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * A word as Prettier would print it, so a reformat hashes the same: numbers without a
 * redundant leading or trailing zero and with a lower-case unit (`.50PX` → `0.5px`), hex
 * colours in lower case. Keywords keep their case, as Prettier keeps it.
 */
function word(text: string): string {
  const number = NUMBER.exec(text);
  if (number) {
    const [, sign = '', digits = '', exponent = '', unit = ''] = number;
    let [whole = '', fraction = ''] = digits.split('.');
    whole = whole.replace(/^0+(?=\d)/, '') || '0';
    fraction = fraction.replace(/0+$/, '');
    return `${sign}${whole}${fraction ? `.${fraction}` : ''}${exponent.toLowerCase()}${unit.toLowerCase()}`;
  }
  return HEX.test(text) ? text.toLowerCase() : text;
}

/**
 * The tokens of a value with formatting removed: whitespace, comments and quote style do not
 * count (`'a'` = `"a"`), nor what Prettier changes in numbers and colours.
 */
export function valueTokens(value: string, out: string[] = []): string[] {
  collect(valueParser(value).nodes, out);
  return out;
}

function collect(nodes: readonly ValueNode[], out: string[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'space':
      case 'comment':
        break;
      case 'string':
        out.push(JSON.stringify(node.value));
        break;
      case 'function':
        out.push(`${node.value}(`);
        collect(inside(node), out);
        out.push(')');
        break;
      case 'word':
        out.push(word(node.value));
        break;
      default:
        out.push(node.value);
    }
  }
}

/**
 * What a function holds. postcss-value-parser keeps a `url(…)` that is not a lone string as one
 * word, quotes and all (`url($path + "a.svg")`): read it as a value, so quote style does not count.
 */
function inside(node: valueParser.FunctionNode): readonly ValueNode[] {
  const [only] = node.nodes;
  return node.value.toLowerCase() === 'url' &&
    node.nodes.length === 1 &&
    only?.type === 'word' &&
    /["']/.test(only.value)
    ? valueParser(only.value).nodes
    : node.nodes;
}

/**
 * A value as one canonical line: single spaces, `, ` and `: `, no space inside parentheses,
 * strings in double quotes. For at-rule preludes in IDs (`@media (max-width: 900px)`) and for
 * signatures.
 */
export function canonicalValue(value: string): string {
  return print(valueParser(value).nodes).trim();
}

function print(nodes: readonly ValueNode[]): string {
  let out = '';
  let space = false;
  const add = (text: string) => {
    if (space && out !== '' && !out.endsWith('(') && !out.endsWith(' ')) out += ' ';
    space = false;
    out += text;
  };
  for (const node of nodes) {
    switch (node.type) {
      case 'space':
        space = true;
        break;
      case 'comment':
        break;
      case 'div':
        if (node.value === ',' || node.value === ':') {
          out = out.trimEnd() + `${node.value} `;
          space = false;
        } else add(node.value);
        break;
      case 'string':
        add(`"${node.value}"`);
        break;
      case 'function':
        add(`${node.value}(${print(inside(node)).trim()})`);
        break;
      case 'word':
        add(word(node.value));
        break;
      default:
        add(node.value);
    }
  }
  return out;
}

const COMBINATORS = new Set(['>', '+', '~']);

/**
 * A selector as one canonical line, the same for every formatting of it: comments dropped,
 * single spaces, ` > `, ` + `, ` ~ ` and `, ` between selectors, attribute values in double
 * quotes without spaces (`[ data-theme = 'light' ]` → `[data-theme="light"]`). SCSS
 * interpolation (`#{$name}`) is kept as written.
 */
export function canonicalSelector(selector: string): string {
  const text = selector.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let space = false;
  const flush = () => {
    if (space && out !== '' && !/[\s(]$/.test(out)) out += ' ';
    space = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (/\s/.test(c)) {
      space = true;
    } else if (c === '#' && text[i + 1] === '{') {
      const end = closing(text, i + 1, '{', '}');
      flush();
      out += text.slice(i, end + 1);
      i = end;
    } else if (c === '[') {
      const end = closing(text, i, '[', ']');
      flush();
      out += attribute(text.slice(i + 1, end));
      i = end;
    } else if (c === '"' || c === "'") {
      const end = stringEnd(text, i);
      flush();
      out += quoted(text.slice(i + 1, end));
      i = end;
    } else if (c === ',') {
      out = `${out.trimEnd()}, `;
      space = false;
    } else if (COMBINATORS.has(c)) {
      out = `${out.trimEnd()}${out.trimEnd() === '' || out.endsWith('(') ? '' : ' '}${c} `;
      space = false;
    } else if (c === ')') {
      out = `${out.trimEnd()})`;
      space = false;
    } else {
      flush();
      out += c;
    }
  }
  return out.trim();
}

/** `data-theme = 'light' i` → `[data-theme="light" i]`. */
function attribute(inner: string): string {
  const match =
    /^\s*([^~|^$*=\s]+)\s*(?:([~|^$*]?=)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s"']+))?\s*([is])?\s*$/i.exec(
      inner,
    );
  if (!match) return `[${inner.trim()}]`;
  const [, name = '', operator, value, flag] = match;
  const quotedValue =
    value === undefined ? '' : quoted(/^["']/.test(value) ? value.slice(1, -1) : value);
  return `[${name}${operator ?? ''}${quotedValue}${flag ? ` ${flag}` : ''}]`;
}

/** A string's content in double quotes, unless it holds one (then as it was, in single). */
function quoted(content: string): string {
  return content.includes('"') ? `'${content}'` : `"${content}"`;
}

/** The index of the bracket closing the one at `start`, past nested pairs and strings. */
export function closing(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") i = stringEnd(text, i);
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return text.length - 1;
}

function stringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === quote) return i;
  }
  return text.length - 1;
}

/** Splits at `separator` outside parentheses, brackets, strings and interpolation. */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") i = stringEnd(text, i);
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter((part) => part !== '');
}
