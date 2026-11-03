// V93 (decision 889, supersedes 845): syntax colours in a diff, from a small tokenizer of our own
// for TS, JS and HTML — keywords, strings, comments, called names, numbers — line by line, a block
// comment or a template string carried to the next line.
import { describe, expect, it } from 'vitest';
import { languageOf, tokenizeLines } from '../src/ui/syntax.js';

const kinds = (lines: string[], lang: 'ts' | 'html' = 'ts') =>
  tokenizeLines(lines, lang).map((tokens) =>
    tokens.filter((t) => t.kind).map((t) => `${t.kind}:${t.text}`),
  );

describe('languageOf', () => {
  it('reads a file name: TS and JS as code, HTML and Angular templates as markup, else none', () => {
    expect(languageOf('src/a.ts')).toBe('ts');
    expect(languageOf('src/a.tsx')).toBe('ts');
    expect(languageOf('lib/b.mjs')).toBe('ts');
    expect(languageOf('app/c.component.html')).toBe('html');
    expect(languageOf('README.md')).toBeNull();
  });
});

describe('tokenizeLines', () => {
  it('keywords, a called name, strings and numbers; the text whole', () => {
    const line =
      "export function legacyCoupon(total) { if (total < 5000) return round('x', 0.1); }";
    const [tokens] = tokenizeLines([line], 'ts');
    expect(tokens?.map((t) => t.text).join('')).toBe(line);
    expect(kinds([line])).toEqual([
      [
        'kw:export',
        'kw:function',
        'call:legacyCoupon',
        'kw:if',
        'num:5000',
        'kw:return',
        'call:round',
        "str:'x'",
        'num:0.1',
      ],
    ]);
  });

  it('a line comment, and a block comment carried over lines', () => {
    expect(kinds(['const a = 1; // the end', '/* one', 'two */ let b'])).toEqual([
      ['kw:const', 'num:1', 'com:// the end'],
      ['com:/* one'],
      ['com:two */', 'kw:let'],
    ]);
  });

  it('a template string over lines, an escaped quote kept in its string', () => {
    expect(kinds(['const t = `a', 'b` + "it\\"s"'])).toEqual([
      ['kw:const', 'str:`a'],
      ['str:b`', 'str:"it\\"s"'],
    ]);
  });

  it('a name is not a keyword inside a longer name; a call is one before its parenthesis, a space between too', () => {
    expect(kinds(['const returned = format; doIt ()'])).toEqual([['kw:const', 'call:doIt']]);
  });

  it('HTML: tags, attributes and their strings, comments', () => {
    expect(kinds(['<button (click)="go()" class="a"> Go </button> <!-- note -->'], 'html')).toEqual(
      [
        [
          'tag:<button',
          'attr:(click)',
          'str:"go()"',
          'attr:class',
          'str:"a"',
          'tag:>',
          'tag:</button',
          'tag:>',
          'com:<!-- note -->',
        ],
      ],
    );
  });

  it('2,000 lines in a few milliseconds', () => {
    const lines = Array.from(
      { length: 2000 },
      (_, i) => `  const value${i} = compute(${i}, "text ${i}"); // why ${i}`,
    );
    const start = performance.now();
    tokenizeLines(lines, 'ts');
    expect(performance.now() - start).toBeLessThan(50);
  });
});
