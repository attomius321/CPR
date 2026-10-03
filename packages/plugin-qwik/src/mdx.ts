/**
 * The code parts of an MDX file, found without an MDX compiler: what CPR needs is imports,
 * exports, component elements and expressions, with their offsets — not the markdown.
 *
 * MDX's rules (2.x/3.x) that matter here: `import ` or `export ` at the start of a line that does
 * not continue a paragraph begins an ESM block, which ends at a blank line; ``` and ~~~ fences
 * (at any indentation: in list items too) hold code that is text; `` `…` `` is inline code;
 * `<Tag …>` is JSX and `{…}` an expression anywhere else; `\` escapes the next character.
 * Indented code blocks do not exist in MDX. YAML frontmatter (`---` lines first in the file, as
 * Qwik's router reads it) is data.
 */
export interface MdxCode {
  /** `import` and `export` blocks, in order. */
  esm: MdxPart[];
  /** Opening tags of JSX elements: components (`<Note>`, `<ui.Card>`), with their name. */
  elements: MdxElement[];
  /**
   * `{…}` expressions: in content, and in attributes of HTML elements (`<img src={img} />`),
   * without their braces. Comments-only ones are left out.
   */
  expressions: MdxPart[];
  /** Why the rest of the file could not be read, if it stopped early. */
  error?: string;
}

export interface MdxPart {
  /** Offsets in the file: `text` is `source.slice(start, end)`. */
  start: number;
  end: number;
  text: string;
}

export interface MdxElement extends MdxPart {
  /** `Note`, `ui.Card`. */
  tag: string;
  /** `<Note … />`; otherwise its children follow and `</Note>` closes it. */
  selfClosing: boolean;
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const ESM = /^(?:import|export) /;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;

export function scanMdx(source: string): MdxCode {
  const code: MdxCode = { esm: [], elements: [], expressions: [] };
  let fence: string | undefined;
  // Whether a line here starts a block rather than continuing a paragraph.
  let blockStart = true;
  let first = 0;
  const frontmatter = /^---[ \t]*\r?\n[\s\S]*?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (frontmatter) first = frontmatter[0].length;
  // `i` is always at the start of a line here.
  for (let i = first; i < source.length;) {
    const end = lineEnd(source, i);
    const text = source.slice(i, end);
    if (fence !== undefined) {
      const close = FENCE.exec(text)?.[1];
      const closes =
        close !== undefined &&
        close[0] === fence[0] &&
        close.length >= fence.length &&
        text.trim() === close;
      if (closes) fence = undefined;
      blockStart = closes;
      i = end + 1;
      continue;
    }
    const open = FENCE.exec(text)?.[1];
    if (open) {
      fence = open;
      i = end + 1;
      continue;
    }
    if (blockStart && ESM.test(text)) {
      // The block runs to the next blank line.
      let blockEnd = end;
      while (blockEnd < source.length) {
        const next = lineEnd(source, blockEnd + 1);
        if (source.slice(blockEnd + 1, next).trim() === '') break;
        blockEnd = next;
      }
      code.esm.push({ start: i, end: blockEnd, text: source.slice(i, blockEnd) });
      i = blockEnd + 1;
      continue;
    }
    blockStart = text.trim() === '' || HEADING.test(text);
    // Content; an element or expression may run on over the next lines.
    let at = scanInline(source, i, end, code);
    while (!code.error && at < source.length && source[at - 1] !== '\n') {
      at = scanInline(source, at, lineEnd(source, at), code);
    }
    if (code.error) return code;
    i = at;
  }
  return code;
}

/**
 * Scans content from `i` to the end of its line, following elements and expressions past it.
 * Returns where it stopped.
 */
function scanInline(source: string, i: number, end: number, code: MdxCode): number {
  while (i < end) {
    const char = source[i];
    if (char === '\\') {
      i += 2;
    } else if (char === '`') {
      i = inlineCode(source, i, end);
      if (i > end) return i;
    } else if (char === '{') {
      const close = balanced(source, i);
      if (close === undefined) return stop(code, source, i, 'an expression is not closed');
      const text = source.slice(i + 1, close);
      if (!isComment(text)) code.expressions.push({ start: i + 1, end: close, text });
      i = close + 1;
      if (close >= end) return i;
    } else if (char === '<' && /[A-Za-z]/.test(source[i + 1] ?? '')) {
      const element = openingTag(source, i);
      if (!element) return stop(code, source, i, 'an element is not closed');
      if (/^[A-Z]/.test(element.tag) || element.tag.includes('.')) {
        code.elements.push(element);
      } else {
        // An HTML element: only its attribute expressions are code.
        attributeExpressions(source, element, code);
      }
      i = element.end;
      if (element.end > end) return i;
    } else if (char === '<' && source[i + 1] === '/') {
      const close = source.indexOf('>', i);
      i = close === -1 ? end : close + 1;
    } else {
      i++;
    }
  }
  return end + 1;
}

/** `` `code` ``: skips to the matching run of backticks, if the paragraph has one. */
function inlineCode(source: string, i: number, end: number): number {
  let run = 0;
  while (source[i + run] === '`') run++;
  const ticks = '`'.repeat(run);
  let at = source.indexOf(ticks, i + run);
  // Inline code may wrap, but not past a blank line.
  const blank = source.indexOf('\n\n', i);
  while (at !== -1 && source[at + run] === '`') at = source.indexOf(ticks, at + run + 1);
  if (at === -1 || (blank !== -1 && at > blank)) return i + run > end ? end : i + run;
  return at + run;
}

/** The opening tag starting at `<`, through its `>` or `/>`; undefined if it never closes. */
function openingTag(source: string, start: number): MdxElement | undefined {
  const name = /^<([A-Za-z][\w.:-]*)/.exec(source.slice(start, start + 200));
  if (!name?.[1]) return undefined;
  let i = start + name[0].length;
  while (i < source.length) {
    const char = source[i];
    if (char === '"' || char === "'") {
      const close = source.indexOf(char, i + 1);
      if (close === -1) return undefined;
      i = close + 1;
    } else if (char === '{') {
      const close = balanced(source, i);
      if (close === undefined) return undefined;
      i = close + 1;
    } else if (char === '>') {
      const selfClosing = source[i - 1] === '/';
      return {
        start,
        end: i + 1,
        text: source.slice(start, i + 1),
        tag: name[1],
        selfClosing,
      };
    } else {
      i++;
    }
  }
  return undefined;
}

function attributeExpressions(source: string, element: MdxElement, code: MdxCode): void {
  let i = element.start;
  while (i < element.end) {
    const char = source[i];
    if (char === '"' || char === "'") {
      i = source.indexOf(char, i + 1) + 1;
    } else if (char === '{') {
      const close = balanced(source, i) as number;
      const text = source.slice(i + 1, close);
      if (!isComment(text)) code.expressions.push({ start: i + 1, end: close, text });
      i = close + 1;
    } else {
      i++;
    }
  }
}

/** The offset of the `}` closing the `{` at `start`, past strings, templates and comments. */
function balanced(source: string, start: number): number | undefined {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return i;
    } else if (char === '"' || char === "'" || char === '`') {
      const close = stringEnd(source, i);
      if (close === undefined) return undefined;
      i = close;
    } else if (char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close === -1) return undefined;
      i = close + 1;
    } else if (char === '/' && source[i + 1] === '/') {
      const close = source.indexOf('\n', i);
      if (close === -1) return undefined;
      i = close;
    }
  }
  return undefined;
}

/** The closing quote of a string or template literal (a template's `${}` followed). */
function stringEnd(source: string, start: number): number | undefined {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') i++;
    else if (char === quote) return i;
    else if (quote === '`' && char === '$' && source[i + 1] === '{') {
      const close = balanced(source, i + 1);
      if (close === undefined) return undefined;
      i = close;
    } else if (char === '\n' && quote !== '`') return undefined;
  }
  return undefined;
}

function isComment(text: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*)*$/.test(text);
}

function stop(code: MdxCode, source: string, at: number, why: string): number {
  code.error = `${why} at line ${source.slice(0, at).split('\n').length}`;
  return source.length;
}

function lineEnd(source: string, start: number): number {
  const end = source.indexOf('\n', start);
  return end === -1 ? source.length : end;
}
