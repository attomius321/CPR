import type { Syntax } from './languages.js';
import type { LineCounts } from './types.js';

/** What is open at a line's end: a block comment or a string that goes on to the next line. */
interface Open {
  close: string;
  comment: boolean;
  escapes: boolean;
}

/** Characters after which a `/` starts a regular expression, not a division. */
const BEFORE_REGEX = new Set([...'(,=:[!&|?{};+-*%<>~^']);

/** Each syntax's special characters: where a comment, a string or a regex may start. */
const SPECIALS = new WeakMap<Syntax, RegExp>();

/**
 * Counts a text's lines (RM1, decision 321): a line is blank (only whitespace), a comment (only
 * comments), or code (anything else, a trailing comment included) — cloc's and scc's rule.
 * Without a syntax, every line that is not blank is code.
 */
export function countLines(text: string, syntax: Syntax | undefined): LineCounts {
  const counts: LineCounts = { lines: 0, code: 0, comments: 0, blank: 0 };
  if (text === '') return counts;
  const rows = text.split('\n');
  if (text.endsWith('\n')) rows.pop();
  const special = syntax && specialsOf(syntax);
  let open: Open | null = null;
  for (const row of rows) {
    counts.lines++;
    const line = row.endsWith('\r') ? row.slice(0, -1) : row;
    if (line.trim() === '') {
      counts.blank++;
      continue;
    }
    // A shebang says how the file runs: code, as cloc counts it.
    if (!syntax || !special || (counts.lines === 1 && line.startsWith('#!'))) {
      counts.code++;
      continue;
    }
    const read = readLine(line, syntax, special, open);
    open = read.open;
    if (read.code) counts.code++;
    else counts.comments++;
  }
  return counts;
}

function specialsOf(syntax: Syntax): RegExp {
  let special = SPECIALS.get(syntax);
  if (!special) {
    const starts = new Set(['\\']);
    for (const opener of syntax.line ?? []) starts.add(opener[0]!);
    for (const [opener] of syntax.block ?? []) starts.add(opener[0]!);
    for (const delimiter of [...(syntax.strings ?? []), ...(syntax.multiline ?? [])]) {
      starts.add(delimiter[0]!);
    }
    if (syntax.regex) starts.add('/');
    const escaped = [...starts].map((ch) => ch.replace(/[\\\]^-]/g, '\\$&')).join('');
    special = new RegExp(`[${escaped}]`, 'g');
    SPECIALS.set(syntax, special);
  }
  return special;
}

/** Reads one line from what was open at the end of the last: whether it has code, what stays open. */
function readLine(
  line: string,
  syntax: Syntax,
  special: RegExp,
  from: Open | null,
): { code: boolean; open: Open | null } {
  let open = from;
  let code = false;
  // The last character of code before `i` that is not whitespace, for telling a regex from a division.
  let before = '';
  let i = 0;
  while (i < line.length) {
    if (open) {
      if (!open.comment) code = true;
      const end = closeAt(line, i, open.close, open.escapes);
      if (end < 0) return { code, open };
      i = end;
      if (!open.comment) before = open.close.slice(-1);
      open = null;
      continue;
    }
    // Plain code up to the next character that may start something.
    special.lastIndex = i;
    const next = special.exec(line);
    const at = next ? next.index : line.length;
    for (let k = at - 1; k >= i; k--) {
      const ch = line[k]!;
      if (ch !== ' ' && ch !== '\t') {
        code = true;
        before = ch;
        break;
      }
    }
    if (!next) break;
    i = at;
    const block = syntax.block?.find(([opener]) => line.startsWith(opener, i));
    if (block) {
      open = { close: block[1], comment: true, escapes: false };
      i += block[0].length;
      continue;
    }
    if (syntax.line?.some((opener) => line.startsWith(opener, i))) return { code, open: null };
    const multiline = syntax.multiline?.find((delimiter) => line.startsWith(delimiter, i));
    if (multiline) {
      const comment = !code && !!syntax.docstrings?.includes(multiline);
      if (!comment) code = true;
      open = { close: multiline, comment, escapes: !syntax.raw?.includes(multiline) };
      i += multiline.length;
      continue;
    }
    code = true;
    const quote = syntax.strings?.find((delimiter) => line.startsWith(delimiter, i));
    if (quote) {
      // A string ends at its delimiter or at the line's end: it never goes on to the next line.
      const end = closeAt(line, i + quote.length, quote, true);
      i = end < 0 ? line.length : end;
      before = quote;
      continue;
    }
    const ch = line[i]!;
    if (ch === '/' && syntax.regex && (before === '' || BEFORE_REGEX.has(before))) {
      const end = regexEnd(line, i + 1);
      if (end > 0) {
        i = end;
        before = '/';
        continue;
      }
    }
    before = ch;
    i += ch === '\\' ? 2 : 1;
  }
  return { code, open };
}

/** The index after `close` from `start`, or -1 when the line ends first. */
function closeAt(line: string, start: number, close: string, escapes: boolean): number {
  let from = start;
  for (;;) {
    const at = line.indexOf(close, from);
    if (at < 0) return -1;
    if (!escapes) return at + close.length;
    // Escaped when an odd number of backslashes stands before it.
    let backslashes = 0;
    for (let k = at - 1; k >= start && line[k] === '\\'; k--) backslashes++;
    if (backslashes % 2 === 0) return at + close.length;
    from = at + 1;
  }
}

/** The index after a regular expression's closing `/` (and its flags), or -1: then it was none. */
function regexEnd(line: string, start: number): number {
  let inClass = false;
  for (let i = start; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') i++;
    else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      let end = i + 1;
      while (end < line.length && /[a-z]/i.test(line[end]!)) end++;
      return end;
    }
  }
  return -1;
}
