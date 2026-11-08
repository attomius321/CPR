// An issue's text (IS1, decision 949): anyone can open an issue on a public repository, so its
// HTML is never drawn. `ui/markdown.ts` already makes no HTML string, links only the web and mail
// and shows images as links; here, before it, the HTML marked found is turned into what the forge
// shows of it: comments dropped, `<img>` an image (drawn as a link to it), `<br>` a break, any
// other tag removed and its text kept (an issue template's `<details>` reads as its text); a
// script's or a style's text goes with it, as the forge's sanitizer drops them.
import type { Token, Tokens } from 'marked';

const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const TAG = /<\/?[a-z][^>]*>|<\/?>/gi;
/** Elements dropped with what they hold. */
const WHOLE = /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const OPENS = /^<(script|style)\b/i;
const CLOSES = /^<\/(script|style)\s*>/i;

/** marked's tokens of an issue's text, its HTML replaced by what is safe to draw. */
export function issueTokens(tokens: readonly Token[]): Token[] {
  return tokens.flatMap(block);
}

function block(token: Token): Token[] {
  if (token.type === 'html') {
    const inline = htmlPieces((token as Tokens.HTML).text);
    if (inline.every((piece) => piece.type === 'text' && !piece.raw.trim())) return [];
    const text = inline.map((piece) => piece.raw).join('');
    return [{ type: 'paragraph', raw: text, text, tokens: inline }];
  }
  return [deep(token)];
}

/** A token with the tokens inside it (a paragraph's, a list's items, a table's cells) made safe. */
function deep(token: Token): Token {
  const copy = { ...token } as Token & {
    tokens?: Token[];
    items?: Tokens.ListItem[];
    header?: Tokens.TableCell[];
    rows?: Tokens.TableCell[][];
  };
  const inline = (list: Token[]) => {
    // Inline, a script's or a style's tags are tokens of their own, its text between them.
    let skipping = false;
    return list.flatMap((token) => {
      const html = token.type === 'html' ? (token as Tokens.HTML).text.trim() : '';
      if (skipping) {
        if (CLOSES.test(html)) skipping = false;
        return [];
      }
      if (OPENS.test(html) && !/<\/(script|style)\s*>/i.test(html)) {
        skipping = true;
        return [];
      }
      return piece(token);
    });
  };
  if (copy.type === 'list' && copy.items) {
    copy.items = copy.items.map((item) => ({ ...item, tokens: item.tokens.flatMap(block) }));
  } else if (copy.type === 'blockquote' && copy.tokens) {
    copy.tokens = copy.tokens.flatMap(block);
  } else if (copy.type === 'table' && copy.header && copy.rows) {
    const cell = (c: Tokens.TableCell) => ({ ...c, tokens: inline(c.tokens) });
    copy.header = copy.header.map(cell);
    copy.rows = copy.rows.map((row) => row.map(cell));
  } else if (copy.tokens) {
    copy.tokens = inline(copy.tokens);
  }
  return copy;
}

/** An inline token made safe: HTML replaced, an image named. */
function piece(token: Token): Token[] {
  if (token.type === 'html') return htmlPieces((token as Tokens.HTML).text);
  if (token.type === 'image') {
    const image = token as Tokens.Image;
    return [{ ...image, text: image.text.trim() || 'image' }];
  }
  return [deep(token)];
}

/** HTML as inline tokens: its text, `<br>`s, `<img>`s; comments and other tags left out. */
function htmlPieces(html: string): Token[] {
  const pieces: Token[] = [];
  const source = html.replace(COMMENT, '').replace(WHOLE, '');
  let at = 0;
  const text = (raw: string) => {
    const decoded = decode(raw);
    if (decoded) pieces.push({ type: 'text', raw: decoded, text: decoded });
  };
  for (const match of source.matchAll(TAG)) {
    text(source.slice(at, match.index));
    at = match.index + match[0].length;
    const tag = match[0];
    if (/^<br\b/i.test(tag)) pieces.push({ type: 'br', raw: '\n' });
    else if (/^<img\b/i.test(tag)) {
      const src = attribute(tag, 'src');
      const alt = attribute(tag, 'alt')?.trim();
      if (src) {
        pieces.push({
          type: 'image',
          raw: tag,
          href: src,
          title: null,
          text: alt || 'image',
          tokens: [],
        });
      }
    }
  }
  text(source.slice(at));
  return pieces;
}

/** A tag's attribute, quoted or not, its entities decoded. */
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decode(value);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The entities HTML text uses most; any other is left as written. */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[name.toLowerCase()] ?? all;
  });
}
