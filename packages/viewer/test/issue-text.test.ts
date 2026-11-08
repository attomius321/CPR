// IS1, decision 949: an issue's text, anyone's on a public repository, drawn with no HTML of its
// own: comments dropped, `<img>` a link to it, `<br>` a break, any other tag gone, its text kept.
import { lexer, type Token, type Tokens } from 'marked';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { issueTokens } from '../src/issues/issue-text.js';
import { MARKDOWN_OPTIONS, markdownNodes } from '../src/ui/markdown.js';

/** The issue's text as the page draws it. */
const html = (text: string) =>
  renderToStaticMarkup(
    createElement('div', null, markdownNodes(issueTokens(lexer(text, MARKDOWN_OPTIONS)))),
  );

describe("an issue's text (IS1)", () => {
  it('runs no script and loads nothing', () => {
    const drawn = html(
      [
        '<script>alert(1)</script>',
        '',
        'Hi <img src="https://tracker.example/p.png" onerror="alert(2)"> there',
        '',
        '<iframe src="https://evil.example"></iframe>',
        '',
        '<a href="javascript:alert(3)">click</a> and [me](javascript:alert(4))',
        '',
        '<div style="background:url(https://tracker.example/bg)">styled</div>',
        '',
        '![shot](https://tracker.example/shot.png)',
      ].join('\n'),
    );
    expect(drawn).not.toMatch(/<(script|img|iframe|div style|style)\b/i);
    expect(drawn).not.toMatch(/onerror|javascript:/i);
    expect(drawn).not.toContain('url(');
    // The images: links to them, named by their text, never loaded.
    expect(drawn).toContain(
      '<a href="https://tracker.example/p.png" target="_blank" rel="noreferrer">image</a>',
    );
    expect(drawn).toContain(
      '<a href="https://tracker.example/shot.png" target="_blank" rel="noreferrer">shot</a>',
    );
    // Text kept, tags gone; a script's or a style's text with them, as the forge drops them.
    expect(drawn).not.toContain('alert(1)');
    expect(drawn).toContain('styled');
    expect(drawn).toContain('click');
  });

  it('drops a script or a style whole, inline too', () => {
    const drawn = html(
      'Before <script>steal()</script> after <style>p{color:red}</style> end\n\n<style>\nbody{}\n</style>\n\nLast',
    );
    expect(drawn).not.toMatch(/steal|color:red|body\{\}/);
    expect(drawn).toMatch(/Before\s+after\s+end/);
    expect(drawn).toContain('Last');
  });

  it('drops HTML comments, as the forge does', () => {
    const drawn = html(
      '<!-- Please fill in the template -->\n\n### Describe the bug\n\nIt <!-- inline --> breaks',
    );
    expect(drawn).not.toContain('Please fill');
    expect(drawn).not.toContain('inline');
    expect(drawn).toContain('Describe the bug');
    expect(drawn).toMatch(/It\s+breaks/);
  });

  it('reads a template’s details as their text, and breaks lines at <br>', () => {
    const drawn = html(
      '<details>\n<summary>System info</summary>\n\n```\nNode 24\n```\n</details>\n\nOne<br>two',
    );
    expect(drawn).toContain('System info');
    expect(drawn).toContain('<pre><code>Node 24</code></pre>');
    expect(drawn).not.toMatch(/&lt;\/?(details|summary)/);
    expect(drawn).toContain('One<br/>two');
  });

  it('keeps HTML in code as the text it is', () => {
    const drawn = html('Use `<div>` here:\n\n```html\n<img src=x onerror=y>\n```');
    expect(drawn).toContain('<code>&lt;div&gt;</code>');
    expect(drawn).toContain('<pre><code>&lt;img src=x onerror=y&gt;</code></pre>');
  });

  it('names an image with no text "image"', () => {
    const tokens = issueTokens(lexer('![](https://github.com/user-attachments/assets/1)'));
    const image = (tokens[0] as Tokens.Paragraph).tokens[0] as Token;
    expect(image).toMatchObject({ type: 'image', text: 'image' });
  });

  it('decodes the entities between tags', () => {
    expect(html('<p>a &lt; b &amp;&amp; c &gt; d</p>')).toContain('a &lt; b &amp;&amp; c &gt; d');
  });

  it('reaches into lists, quotes and tables', () => {
    const drawn = html(
      '- one <b>bold</b>\n- <img src="https://x.example/i.png" alt="pic">\n\n> quote <i>it</i>\n\n| a |\n|---|\n| <img src="https://x.example/t.png"> |',
    );
    expect(drawn).not.toMatch(/<(b|i|img)>/);
    expect(drawn).toContain('>pic</a>');
    expect(drawn).toContain('href="https://x.example/t.png"');
    expect(drawn).toContain('bold');
  });
});
