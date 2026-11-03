// Syntax colours for a diff's lines (V93, decision 889, supersedes 845; proofs 03 and 04): a small
// tokenizer of our own, no dependency, for TypeScript and JavaScript (keywords, strings, comments,
// called names, numbers) and HTML (tags, attributes, their values, comments). Line by line: a block
// comment or a template string carries over to the next line. Pure: `test/syntax.test.ts`.

export type Language = 'ts' | 'html';
export type TokenKind = 'kw' | 'str' | 'com' | 'call' | 'num' | 'tag' | 'attr';

export interface Token {
  text: string;
  /** Absent: plain text. */
  kind?: TokenKind;
}

/** A file's language by its name; none for what the tokenizer does not read. */
export function languageOf(path: string): Language | null {
  if (/\.(?:[cm]?[jt]sx?)$/.test(path)) return 'ts';
  if (/\.html?$/.test(path)) return 'html';
  return null;
}

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue debugger declare default ' +
    'delete do else enum export extends false finally for from function get if implements ' +
    'import in instanceof interface is keyof let new null of package private protected public ' +
    'readonly return satisfies set static super switch this throw true try type typeof ' +
    'undefined var void while with yield'
  ).split(' '),
);

/** What carries from one line to the next: inside a block comment or a template string. */
type State = 'code' | 'comment' | 'template' | 'html-comment';

/** Each line's tokens; their texts join back into the line. */
export function tokenizeLines(lines: readonly string[], lang: Language): Token[][] {
  let state: State = 'code';
  return lines.map((line) => {
    const read = lang === 'ts' ? codeLine(line, state) : htmlLine(line, state);
    state = read.state;
    return read.tokens;
  });
}

const IDENT = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)n?/y;

function codeLine(line: string, from: State): { tokens: Token[]; state: State } {
  const tokens: Token[] = [];
  let plain = '';
  const flush = () => {
    if (plain) tokens.push({ text: plain });
    plain = '';
  };
  const push = (text: string, kind: TokenKind) => {
    flush();
    tokens.push({ text, kind });
  };
  let i = 0;
  let state = from;
  if (state === 'comment') {
    const end = line.indexOf('*/');
    if (end < 0) return { tokens: line ? [{ text: line, kind: 'com' }] : [], state };
    push(line.slice(0, end + 2), 'com');
    i = end + 2;
    state = 'code';
  } else if (state === 'template') {
    const end = closing(line, 0, '`');
    if (end < 0) return { tokens: line ? [{ text: line, kind: 'str' }] : [], state };
    push(line.slice(0, end + 1), 'str');
    i = end + 1;
    state = 'code';
  }
  while (i < line.length) {
    const c = line[i]!;
    const next = line[i + 1];
    if (c === '/' && next === '/') {
      push(line.slice(i), 'com');
      return { tokens, state };
    }
    if (c === '/' && next === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end < 0) {
        push(line.slice(i), 'com');
        return { tokens, state: 'comment' };
      }
      push(line.slice(i, end + 2), 'com');
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const end = closing(line, i + 1, c);
      if (end < 0) {
        push(line.slice(i), 'str');
        return { tokens, state: c === '`' ? 'template' : state };
      }
      push(line.slice(i, end + 1), 'str');
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      IDENT.lastIndex = i;
      const word = IDENT.exec(line)?.[0] ?? c;
      // A call's parenthesis may follow a space: `doIt ()`.
      const after = line.slice(i + word.length).trimStart()[0];
      const dotted = line[i - 1] === '.';
      if (!dotted && KEYWORDS.has(word)) push(word, 'kw');
      else if (after === '(') push(word, 'call');
      else plain += word;
      i += word.length;
      continue;
    }
    if (/\d/.test(c) && !/[\w$]/.test(line[i - 1] ?? '')) {
      NUMBER.lastIndex = i;
      const number = NUMBER.exec(line)?.[0] ?? c;
      push(number, 'num');
      i += number.length;
      continue;
    }
    plain += c;
    i += 1;
  }
  flush();
  return { tokens, state };
}

/** The index of the quote that closes a string from `from`, past escaped ones; -1 if none. */
function closing(line: string, from: number, quote: string): number {
  for (let i = from; i < line.length; i++) {
    if (line[i] === '\\') i += 1;
    else if (line[i] === quote) return i;
  }
  return -1;
}

const ATTR = /[^\s=>/"']+/y;

function htmlLine(line: string, from: State): { tokens: Token[]; state: State } {
  const tokens: Token[] = [];
  let plain = '';
  const flush = () => {
    if (plain) tokens.push({ text: plain });
    plain = '';
  };
  const push = (text: string, kind: TokenKind) => {
    flush();
    tokens.push({ text, kind });
  };
  let i = 0;
  if (from === 'html-comment') {
    const end = line.indexOf('-->');
    if (end < 0) return { tokens: line ? [{ text: line, kind: 'com' }] : [], state: from };
    push(line.slice(0, end + 3), 'com');
    i = end + 3;
  }
  while (i < line.length) {
    if (line.startsWith('<!--', i)) {
      const end = line.indexOf('-->', i + 4);
      if (end < 0) {
        push(line.slice(i), 'com');
        return { tokens, state: 'html-comment' };
      }
      push(line.slice(i, end + 3), 'com');
      i = end + 3;
      continue;
    }
    if (line[i] === '<' && /[A-Za-z/!]/.test(line[i + 1] ?? '')) {
      const name = /<\/?[\w-]+/y;
      name.lastIndex = i;
      const tag = name.exec(line)?.[0] ?? '<';
      push(tag, 'tag');
      i += tag.length;
      // Its attributes, to the tag's end on this line.
      while (i < line.length && line[i] !== '>') {
        const c = line[i]!;
        if (c === '"' || c === "'") {
          const end = closing(line, i + 1, c);
          const stop = end < 0 ? line.length : end + 1;
          push(line.slice(i, stop), 'str');
          i = stop;
        } else if (/\s|=|\//.test(c)) {
          plain += c;
          i += 1;
        } else {
          ATTR.lastIndex = i;
          const attr = ATTR.exec(line)?.[0] ?? c;
          push(attr, 'attr');
          i += attr.length;
        }
      }
      if (line[i] === '>') {
        push('>', 'tag');
        i += 1;
      }
      continue;
    }
    plain += line[i];
    i += 1;
  }
  flush();
  return { tokens, state: 'code' };
}
