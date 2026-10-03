import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@cpr/core';
import { scanMdx } from '../src/mdx.js';
import { mdxShim } from '../src/mdx-shim.js';

const parts = (source: string) => {
  const code = scanMdx(source);
  return {
    esm: code.esm.map((p) => p.text),
    elements: code.elements.map((e) => `${e.tag}${e.selfClosing ? '/' : ''}: ${e.text}`),
    expressions: code.expressions.map((p) => p.text),
    ...(code.error ? { error: code.error } : {}),
  };
};

describe('the MDX scanner', () => {
  it('finds imports, exports, components and expressions', () => {
    const source = [
      '---',
      'title: <Not> {jsx}',
      '---',
      "import { Note } from '~/components/note';",
      'import Chart, {',
      "  Legend } from './chart';",
      '',
      '# Hello {name}',
      '',
      'Some *text* with <Note kind="tip">a note</Note> and <ui.Card',
      '  title={`multi ${line}`}',
      '  size={2} /> after.',
      '',
      'export const head = { title: "x" };',
      '',
      '<img src={image} alt="a" />',
    ].join('\n');
    expect(parts(source)).toEqual({
      esm: [
        "import { Note } from '~/components/note';\nimport Chart, {\n  Legend } from './chart';",
        'export const head = { title: "x" };',
      ],
      elements: [
        'Note: <Note kind="tip">',
        'ui.Card/: <ui.Card\n  title={`multi ${line}`}\n  size={2} />',
      ],
      expressions: ['name', 'image'],
    });
  });

  it('leaves code, escapes and comments alone', () => {
    const source = [
      'Inline `<Note />` and ``a ` {b}`` code, \\{escaped} and \\<Not />.',
      '',
      '```tsx',
      "import { X } from 'y';",
      '<Note />',
      '```',
      '',
      '    ~~~',
      '    <InList />',
      '    ~~~',
      '',
      '{/* a comment */}',
      '<Real />',
    ].join('\n');
    expect(parts(source)).toEqual({ esm: [], elements: ['Real/: <Real />'], expressions: [] });
  });

  it('reads ESM only where a block starts, as MDX does', () => {
    const source = [
      'A paragraph',
      'export this is prose',
      '',
      'import("x").Type is prose too',
      '',
      '## Heading',
      "import { A } from 'a';",
    ].join('\n');
    expect(parts(source).esm).toEqual(["import { A } from 'a';"]);
  });

  it('stops where an element never closes, and says where', () => {
    expect(parts('Fine <A />\n\n<B title={open\n').error).toBe(
      'an element is not closed at line 3',
    );
  });
});

describe('the MDX shim', () => {
  const tsApi = ts as unknown as PluginContext['ts'];
  const shim = (source: string) =>
    mdxShim(
      tsApi,
      'src/routes/docs/index.mdx',
      source,
      scanMdx(source),
      new Map([
        ['Term', { module: 'src/components/term.tsx', file: true, name: 'Term' }],
        ['Icon', { module: '@acme/icons', file: false, name: 'default' }],
      ]),
    );

  it('renders elements self-closed, imports what the provider gives, and maps back', () => {
    const source = [
      "import { Note } from './note';",
      '',
      'See <Term id="a" />, <Icon /> and <Unknown />.',
      '',
      '<Note kind="tip">',
      '  text',
      '</Note>',
      '',
      'Sum: {1 + 1}',
    ].join('\n');
    const file = shim(source);
    expect(file.text).toBe(
      [
        "import { Note } from './note';",
        'import { Term } from "../../components/term";',
        'import Icon from "@acme/icons";',
        'declare function __cpr_use(...values: unknown[]): void;',
        'export function __cpr_mdx(): void {',
        '  __cpr_use(<Term id="a" />);',
        '  __cpr_use(<Icon />);',
        '  __cpr_use(<Note kind="tip"/>);',
        '  __cpr_use((1 + 1));',
        '}',
        '',
      ].join('\n'),
    );
    const at = (text: string) => file.map(file.text.indexOf(text));
    expect(at('Note kind')).toEqual({
      owner: 'src/routes/docs/index.mdx#(template)',
      site: { file: 'src/routes/docs/index.mdx', line: 5, col: 2 },
    });
    expect(at('1 + 1')?.site).toEqual({ file: 'src/routes/docs/index.mdx', line: 9, col: 7 });
    // Imports are scaffolding.
    expect(at('Note }')).toBeUndefined();
  });

  it('keeps a component whose element TSX cannot parse, by its tag', () => {
    const file = shim("import { Note } from './note';\n\n<Note size={010} />\n");
    expect(file.text).toContain('  __cpr_use(Note);\n');
    expect(file.map(file.text.indexOf('Note);'))?.site).toEqual({
      file: 'src/routes/docs/index.mdx',
      line: 3,
      col: 2,
    });
  });
});
