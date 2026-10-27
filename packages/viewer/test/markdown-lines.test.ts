import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { linePieces, markdownLines, type Piece } from '../src/skills/markdown-lines.js';

/** Each line's pieces as `kind:text`, plain text bare. */
const drawn = (text: string) =>
  markdownLines(text).map((line) =>
    linePieces(line.text, line.kind).map((p: Piece) => (p.kind ? `${p.kind}:${p.text}` : p.text)),
  );

describe('a SKILL.md drawn line by line (V64)', () => {
  it('splits the lines as a text area does, a last newline making an empty line', () => {
    expect(markdownLines('a\nb\n').map((l) => l.text)).toEqual(['a', 'b', '']);
    expect(markdownLines('a\r\nb\rc').map((l) => l.text)).toEqual(['a', 'b', 'c']);
    expect(markdownLines('').map((l) => l.text)).toEqual(['']);
  });

  it('draws the frontmatter only at the top: its fences and its keys', () => {
    const text = '---\nname: a\ndescription: >\n  folded: text\n---\n\n---\nname: b';
    expect(markdownLines(text).map((l) => l.kind)).toEqual([
      'delimiter',
      'frontmatter',
      'frontmatter',
      'frontmatter',
      'delimiter',
      'text',
      'text',
      'text',
    ]);
    expect(drawn(text)).toEqual([
      ['meta:---'],
      ['key:name:', ' a'],
      ['key:description:', ' >'],
      ['  folded: text'],
      ['meta:---'],
      [],
      ['mark:---'],
      ['name: b'],
    ]);
  });

  it('keeps an unclosed frontmatter to the end', () => {
    expect(markdownLines('---\nname: a\n# not a heading').map((l) => l.kind)).toEqual([
      'delimiter',
      'frontmatter',
      'frontmatter',
    ]);
  });

  it('draws headings, list and quote markers, inline code and links', () => {
    expect(
      drawn(
        '# Title\n#tag\n- [ ] a `b` c\n  2. [x](y.md) z\n> quoted\n``a ` b``\n**not** coloured',
      ),
    ).toEqual([
      ['heading:# Title'],
      ['#tag'],
      ['mark:- [ ] ', 'a ', 'code:`b`', ' c'],
      ['mark:  2. ', 'link:[x](y.md)', ' z'],
      ['mark:> ', 'quoted'],
      ['code:``a ` b``'],
      ['**not** coloured'],
    ]);
  });

  it('draws a fence and the lines in it as code, to its closing fence or the end', () => {
    const text = '```ts\nconst a = `b`;\n# no heading\n```\n# Heading\n~~~\nopen';
    expect(markdownLines(text).map((l) => l.kind)).toEqual([
      'delimiter',
      'fence',
      'fence',
      'delimiter',
      'text',
      'delimiter',
      'fence',
    ]);
    expect(drawn(text)).toEqual([
      ['meta:```ts'],
      ['code:const a = `b`;'],
      ['code:# no heading'],
      ['meta:```'],
      ['heading:# Heading'],
      ['meta:~~~'],
      ['code:open'],
    ]);
    // A fence closes only on its own character, at least as long.
    expect(markdownLines('````\n```\n~~~~\n````').map((l) => l.kind)).toEqual([
      'delimiter',
      'fence',
      'fence',
      'delimiter',
    ]);
  });

  it('gives back every line exactly: the drawn copy and the text area hold the same text', () => {
    const text = [
      '---',
      'name: x',
      '---',
      '# H `c`',
      '- [ ] `unclosed',
      '| a | `b` |',
      '[a](b) [c] (d) `` ` ``',
      '\ttabbed > not a quote',
      '   > quote',
      '```',
      'x',
    ].join('\n');
    for (const line of markdownLines(text)) {
      expect(
        linePieces(line.text, line.kind)
          .map((p) => p.text)
          .join(''),
      ).toBe(line.text);
    }
  });

  it('gives back this repository’s own skills line for line', () => {
    const folder = join(__dirname, '../../../.claude/skills');
    const names = readdirSync(folder);
    expect(names.length).toBeGreaterThan(3);
    for (const name of names) {
      const text = readFileSync(join(folder, name, 'SKILL.md'), 'utf8');
      const lines = markdownLines(text);
      expect(lines.map((l) => l.text).join('\n')).toBe(text);
      for (const line of lines) {
        expect(
          linePieces(line.text, line.kind)
            .map((p) => p.text)
            .join(''),
        ).toBe(line.text);
      }
    }
  });
});
