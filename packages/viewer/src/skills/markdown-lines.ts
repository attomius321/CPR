// A SKILL.md as the Skills page draws it under its text area (V64, decision 460): line by line,
// each line's pieces with a kind for its colour. The pieces of a line join back into the line
// exactly, so the drawn copy and the text area always hold the same text: only colour differs,
// never a character, a weight or a width.

/** A line's place: a fence of the frontmatter or of code, inside one of them, or Markdown. */
export type LineKind = 'delimiter' | 'frontmatter' | 'fence' | 'text';

/** What a piece is drawn as; plain text has none. */
export type PieceKind = 'meta' | 'key' | 'heading' | 'mark' | 'code' | 'link';

export interface Piece {
  text: string;
  kind?: PieceKind;
}

export interface MarkdownLine {
  text: string;
  kind: LineKind;
}

/** A code fence's opening: up to 3 spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
/** A thematic break: three or more `-`, `*` or `_`, spaces between. */
const BREAK = /^ {0,3}([-*_])(?: *\1){2,} *$/;
/** A quote's `>`, or a list's marker with its task box. */
const QUOTE = /^ {0,3}> ?/;
const LIST = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;
/** A frontmatter key at the start of a line: `name:`. */
const KEY = /^[^\s:#-][^:]*:(?=\s|$)/;
/** A link, `[text](target)`, with no bracket or parenthesis inside. */
const LINK = /^\[[^\][]*\]\([^()\s]*\)/;

/**
 * The lines as a text area shows them (`\r\n` and `\r` are line breaks, a last newline an empty
 * line), each with its place: the frontmatter only at the very top (as `readSkill` reads it), a
 * fence to its closing fence or the end.
 */
export function markdownLines(text: string): MarkdownLine[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: MarkdownLine[] = [];
  let i = 0;
  if (lines[0]?.trimEnd() === '---') {
    out.push({ text: lines[0], kind: 'delimiter' });
    for (i = 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (line.trimEnd() === '---') {
        out.push({ text: line, kind: 'delimiter' });
        i++;
        break;
      }
      out.push({ text: line, kind: 'frontmatter' });
    }
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const opening = FENCE.exec(line)?.[1];
    if (fence === null) {
      if (opening) fence = opening;
      out.push({ text: line, kind: opening ? 'delimiter' : 'text' });
    } else if (
      opening !== undefined &&
      opening[0] === fence[0] &&
      opening.length >= fence.length &&
      closes(line)
    ) {
      fence = null;
      out.push({ text: line, kind: 'delimiter' });
    } else {
      out.push({ text: line, kind: 'fence' });
    }
  }
  return out;
}

/** A closing fence holds nothing after its marks but spaces. */
const closes = (line: string) => /^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(line);

/** A line's pieces, by its place; joined, they are the line. */
export function linePieces(text: string, kind: LineKind): Piece[] {
  if (text === '') return [];
  switch (kind) {
    case 'delimiter':
      return [{ text, kind: 'meta' }];
    case 'fence':
      return [{ text, kind: 'code' }];
    case 'frontmatter': {
      const key = KEY.exec(text)?.[0];
      return key ? withRest([{ text: key, kind: 'key' }], text.slice(key.length)) : [{ text }];
    }
    case 'text': {
      if (HEADING.test(text)) return [{ text, kind: 'heading' }];
      if (BREAK.test(text)) return [{ text, kind: 'mark' }];
      const marker = QUOTE.exec(text)?.[0] ?? LIST.exec(text)?.[0];
      if (marker) return [{ text: marker, kind: 'mark' }, ...inline(text.slice(marker.length))];
      return inline(text);
    }
  }
}

const withRest = (pieces: Piece[], rest: string): Piece[] =>
  rest === '' ? pieces : [...pieces, { text: rest }];

/** Inline code spans (a run of backticks to the next run as long) and links; the rest plain. */
function inline(text: string): Piece[] {
  const pieces: Piece[] = [];
  let plain = '';
  let i = 0;
  const take = (piece: Piece) => {
    if (plain !== '') pieces.push({ text: plain });
    plain = '';
    pieces.push(piece);
    i += piece.text.length;
  };
  while (i < text.length) {
    const rest = text.slice(i);
    const ticks = /^`+/.exec(rest)?.[0];
    if (ticks) {
      const end = closingTicks(rest, ticks.length);
      if (end > 0) {
        take({ text: rest.slice(0, end), kind: 'code' });
        continue;
      }
      // No closing run: the backticks are text.
      plain += ticks;
      i += ticks.length;
      continue;
    }
    const link = rest[0] === '[' ? LINK.exec(rest)?.[0] : undefined;
    if (link) {
      take({ text: link, kind: 'link' });
      continue;
    }
    plain += rest[0] ?? '';
    i++;
  }
  if (plain !== '') pieces.push({ text: plain });
  return pieces;
}

/** Where a code span that opens with `count` backticks ends (after its closing run), else 0. */
function closingTicks(text: string, count: number): number {
  const run = /`+/g;
  run.lastIndex = count;
  for (let found = run.exec(text); found; found = run.exec(text)) {
    if (found[0].length === count) return found.index + count;
  }
  return 0;
}
