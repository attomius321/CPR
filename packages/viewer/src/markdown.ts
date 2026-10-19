// Agents' reports in the thread, drawn as Markdown: marked's lexer reads them, and its tokens
// become React elements here. No HTML string is ever made, so there is nothing to sanitize: HTML
// in a report shows as text, and links go only to the web or to mail.
import { createElement as h, Fragment, useEffect, useState, type ReactNode } from 'react';
import type { MarkedOptions, Token, Tokens } from 'marked';

/** GitHub's flavour, line breaks kept as the agent wrote them (as GitHub's comments do). */
export const MARKDOWN_OPTIONS: MarkedOptions = { gfm: true, breaks: true };

const LINKABLE = /^(https?:|mailto:)/i;

/** Markdown tokens (marked's lexer) as React elements. */
export function markdownNodes(tokens: readonly Token[]): ReactNode[] {
  return tokens.map(block);
}

function block(token: Token, key: number): ReactNode {
  switch (token.type) {
    case 'space':
    case 'def':
      return null;
    case 'heading': {
      // The page's title is h1, its groups h2: an agent's headings start below them.
      const { depth, tokens } = token as Tokens.Heading;
      return h(`h${Math.min(depth + 2, 6)}`, { key }, inline(tokens));
    }
    case 'paragraph':
      return h('p', { key }, inline((token as Tokens.Paragraph).tokens));
    case 'text': {
      // A tight list's item: its text, without a paragraph.
      const { text, tokens } = token as Tokens.Text;
      return h(Fragment, { key }, tokens ? inline(tokens) : text);
    }
    case 'code':
      return h('pre', { key }, h('code', null, (token as Tokens.Code).text));
    case 'blockquote':
      return h('blockquote', { key }, markdownNodes((token as Tokens.Blockquote).tokens));
    case 'hr':
      return h('hr', { key });
    case 'list': {
      const { ordered, start, items } = token as Tokens.List;
      const from = ordered && typeof start === 'number' && start !== 1 ? { start } : {};
      return h(
        ordered ? 'ol' : 'ul',
        { key, ...from },
        items.map((item, i) => h('li', { key: i }, item.tokens.map(listPart))),
      );
    }
    case 'table': {
      const { header, rows } = token as Tokens.Table;
      const cell = (tag: 'th' | 'td', c: Tokens.TableCell, i: number) =>
        h(tag, { key: i, ...(c.align ? { style: { textAlign: c.align } } : {}) }, inline(c.tokens));
      return h(
        'table',
        { key },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            header.map((c, i) => cell('th', c, i)),
          ),
        ),
        h(
          'tbody',
          null,
          rows.map((row, r) =>
            h(
              'tr',
              { key: r },
              row.map((c, i) => cell('td', c, i)),
            ),
          ),
        ),
      );
    }
    case 'html':
      return h('p', { key }, (token as Tokens.HTML).text);
    default:
      return 'text' in token && typeof token.text === 'string' ? token.text : null;
  }
}

/** A list item's part: its task box, read only, then what it holds. */
function listPart(token: Token, key: number): ReactNode {
  if (token.type !== 'checkbox') return block(token, key);
  const { checked } = token as Tokens.Checkbox;
  return h(Fragment, { key }, h('input', { type: 'checkbox', disabled: true, checked }), ' ');
}

function inline(tokens: readonly Token[] | undefined): ReactNode[] {
  return (tokens ?? []).map((token, key) => {
    switch (token.type) {
      case 'strong':
        return h('strong', { key }, inline((token as Tokens.Strong).tokens));
      case 'em':
        return h('em', { key }, inline((token as Tokens.Em).tokens));
      case 'del':
        return h('del', { key }, inline((token as Tokens.Del).tokens));
      case 'codespan':
        return h('code', { key }, (token as Tokens.Codespan).text);
      case 'br':
        return h('br', { key });
      case 'link': {
        const { href, tokens } = token as Tokens.Link;
        return link(key, href, inline(tokens));
      }
      case 'image': {
        // Not loaded: a link to it, named by its alternative text.
        const { href, text } = token as Tokens.Image;
        return link(key, href, text);
      }
      case 'text': {
        const { text, tokens } = token as Tokens.Text;
        return tokens ? h(Fragment, { key }, inline(tokens)) : text;
      }
      default:
        // Escapes, and HTML shown as the text it is.
        return 'text' in token && typeof token.text === 'string' ? token.text : null;
    }
  });
}

function link(key: number, href: string, children: ReactNode): ReactNode {
  return LINKABLE.test(href)
    ? h('a', { key, href, target: '_blank', rel: 'noreferrer' }, children)
    : h(Fragment, { key }, children);
}

type Lexer = (text: string) => Token[];
let lexer: Lexer | null = null;
let loading: Promise<Lexer> | null = null;

/**
 * marked's lexer, loaded on first use into its own chunk (the workspaces view's first paint does
 * not wait for it); null until then, when a report shows as plain text.
 */
export function useMarkdown(): Lexer | null {
  const [loaded, setLoaded] = useState<Lexer | null>(() => lexer);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    loading ??= import('marked').then(
      (marked) => (lexer = (text) => marked.lexer(text, MARKDOWN_OPTIONS)),
    );
    void loading.then((ready) => live && setLoaded(() => ready));
    return () => {
      live = false;
    };
  }, [loaded]);
  return loaded;
}
