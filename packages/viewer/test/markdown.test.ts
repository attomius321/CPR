import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { markdownNodes, MARKDOWN_OPTIONS } from '../src/ui/markdown.js';
import { lexer } from 'marked';

/** A report as the thread draws it. */
const html = (text: string) =>
  renderToStaticMarkup(createElement(Fragment, null, markdownNodes(lexer(text, MARKDOWN_OPTIONS))));

describe('markdownNodes', () => {
  it("draws an agent's report: bold, code, nested and numbered lists", () => {
    const report = [
      '**What changed**',
      '- **README** (`5684487`): rewritten.',
      '  - It opens with a pitch.',
      '',
      '3. a',
      '4. b',
    ].join('\n');
    expect(html(report)).toBe(
      '<p><strong>What changed</strong></p>' +
        '<ul><li><strong>README</strong> (<code>5684487</code>): rewritten.' +
        '<ul><li>It opens with a pitch.</li></ul></li></ul>' +
        '<ol start="3"><li>a</li><li>b</li></ol>',
    );
  });

  it('keeps line breaks the agent wrote; headings below the page and panel', () => {
    expect(html('# Plan\n\n## Steps\n\nfirst\nsecond')).toBe(
      '<h3>Plan</h3><h4>Steps</h4><p>first<br/>second</p>',
    );
  });

  it('draws code blocks, quotes, rules, emphasis, strike-through and escapes', () => {
    expect(html('```ts\nif (a < b) {}\n```')).toBe('<pre><code>if (a &lt; b) {}</code></pre>');
    expect(html('> quoted\n\n---\n\n*a* ~~b~~ \\*c\\*')).toBe(
      '<blockquote><p>quoted</p></blockquote><hr/><p><em>a</em> <del>b</del> *c*</p>',
    );
  });

  it('draws tables', () => {
    expect(html('| A | B |\n|---|--:|\n| 1 | 2 |')).toBe(
      '<table><thead><tr><th>A</th><th style="text-align:right">B</th></tr></thead>' +
        '<tbody><tr><td>1</td><td style="text-align:right">2</td></tr></tbody></table>',
    );
  });

  it('draws task lists with their boxes, read only', () => {
    expect(html('- [x] done\n- [ ] todo')).toBe(
      '<ul><li><input type="checkbox" disabled="" checked=""/> done</li>' +
        '<li><input type="checkbox" disabled=""/> todo</li></ul>',
    );
  });

  it('shows HTML as text, and links only to the web or mail', () => {
    expect(html('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(html('a <b>x</b> & `1 < 2`')).toBe(
      '<p>a &lt;b&gt;x&lt;/b&gt; &amp; <code>1 &lt; 2</code></p>',
    );
    expect(html('[Symbiote](https://example.com/a?b=1)')).toBe(
      '<p><a href="https://example.com/a?b=1" target="_blank" rel="noreferrer">Symbiote</a></p>',
    );
    expect(html('[x](javascript:alert(1)) [y](mailto:a@b.c)')).toBe(
      '<p>x <a href="mailto:a@b.c" target="_blank" rel="noreferrer">y</a></p>',
    );
    expect(html('![shot](https://example.com/a.png)')).toBe(
      '<p><a href="https://example.com/a.png" target="_blank" rel="noreferrer">shot</a></p>',
    );
  });
});
