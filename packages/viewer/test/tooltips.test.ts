import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { longDate } from '../src/history/commits.js';
import { tip } from '../src/ui/tip.js';
import { briefTip } from '../src/workspaces/workspaces.js';

const SRC = new URL('../src/', import.meta.url);

/** Every `.tsx` under src/, in its folders too: [path, text]. */
function components(): [string, string][] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.tsx'))
    .sort()
    .map((file) => [file, readFileSync(new URL(file, SRC), 'utf8')]);
}

describe('tooltips are drawn by Symbiote (V54, decision 397)', () => {
  // A `title` is shown by the window system, after a second, square, in its own font and in
  // neither theme: every tip is a `data-tip` the one `Tooltips` draws. A component's own `title`
  // prop (a panel's heading) is not an element's.
  it('puts no title on an HTML or SVG element, and draws no SVG <title>', () => {
    const found: string[] = [];
    for (const [file, text] of components()) {
      const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const at = (node: ts.Node) =>
        `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      const visit = (node: ts.Node): void => {
        if (ts.isJsxAttribute(node) && node.name.getText() === 'title') {
          const tag = node.parent.parent.tagName.getText();
          if (/^[a-z]/.test(tag)) found.push(`${at(node)} <${tag} title>`);
        }
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          node.tagName.getText() === 'title'
        ) {
          found.push(`${at(node)} <title>`);
        }
        // `{...(note ? { title: note } : {})}` on an element.
        if (ts.isJsxSpreadAttribute(node)) {
          const tag = node.parent.parent.tagName.getText();
          const spread = (inner: ts.Node): void => {
            if (ts.isPropertyAssignment(inner) && inner.name.getText() === 'title')
              found.push(`${at(inner)} <${tag} {...{ title }}>`);
            ts.forEachChild(inner, spread);
          };
          if (/^[a-z]/.test(tag)) spread(node.expression);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(found).toEqual([]);
  });
});

describe('tip (V54)', () => {
  it('gives the text, and only the options asked', () => {
    expect(tip('Go to HEAD')).toEqual({ 'data-tip': 'Go to HEAD' });
    expect(tip('History\nEvery branch’s commits', { keys: 'h', side: 'right' })).toEqual({
      'data-tip': 'History\nEvery branch’s commits',
      'data-tip-keys': 'h',
      'data-tip-side': 'right',
    });
    expect(tip('2 errors', { tone: 'bad' })).toEqual({
      'data-tip': '2 errors',
      'data-tip-tone': 'bad',
    });
    expect(tip('src/a.ts#f', { code: true })).toEqual({
      'data-tip': 'src/a.ts#f',
      'data-tip-code': '',
    });
  });

  it('gives nothing for no text: the element has no tip', () => {
    expect(tip(undefined)).toEqual({});
    expect(tip('')).toEqual({});
  });
});

describe('longDate (V54)', () => {
  it('writes a date out, with the day, in the locale asked', () => {
    // Intl's own punctuation, which ICU versions differ on.
    expect(longDate('2026-10-25T17:02:16', 'en-GB')).toMatch(/^Sun,? 25 Oct 2026,? 17:02$/);
  });
});

describe('briefTip (V54)', () => {
  it("says a brief's first line, then its words as one paragraph, without Markdown's marks", () => {
    const brief =
      '# Feature: Tooltips\n\n## Goal\nAll tooltips look **old**.\n\n## Notes\nUse `tip()`.';
    expect(briefTip(brief)).toBe('Feature: Tooltips\nAll tooltips look old. Use tip().');
  });

  it('cuts a long brief after 240 characters', () => {
    const said = briefTip(`Title\n${'word '.repeat(100)}`).split('\n')[1]!;
    expect(said).toHaveLength(240);
    expect(said.endsWith('…')).toBe(true);
  });

  it('is the first line alone when there is nothing else', () => {
    expect(briefTip('Dates sort as text')).toBe('Dates sort as text');
  });
});
