import { describe, expect, it } from 'vitest';
import { countLines } from '../src/count.js';
import { languageOf } from '../src/languages.js';

/** A file's text counted with its language's syntax, as the scan does. */
const count = (path: string, text: string) => countLines(text, languageOf(path)?.syntax);

const lines = (...rows: string[]) => rows.join('\n') + '\n';

describe('countLines', () => {
  it('sorts lines into code, comments and blank', () => {
    const text = lines(
      '// header comment',
      "import { a } from './a.js';",
      '',
      '/**',
      ' * Doc comment.',
      ' */',
      'export function f(): string {',
      "  return 'x'; // trailing",
      '}',
    );
    expect(count('a.ts', text)).toEqual({ lines: 9, code: 4, comments: 4, blank: 1 });
  });

  it('does not take a comment opener inside a string for a comment', () => {
    const text = lines(
      "const glob = 'src/**/*.ts';",
      'const url = "https://example.com";',
      'const after = 1;',
    );
    expect(count('a.ts', text)).toEqual({ lines: 3, code: 3, comments: 0, blank: 0 });
  });

  it('keeps a template literal open across lines', () => {
    const text = lines('const text = `', '// not a comment', '/* nor this', '`;', '// a comment');
    expect(count('a.ts', text)).toEqual({ lines: 5, code: 4, comments: 1, blank: 0 });
    // A line that only opens one is code too (vite's `entry-worker.jsx`).
    expect(count('a.jsx', lines('respond(', '  `', '  <h1>hi</h1>', '`)'))).toEqual({
      lines: 4,
      code: 4,
      comments: 0,
      blank: 0,
    });
  });

  it('skips regular expressions, and tells them from a division', () => {
    const text = lines(
      "const trimmed = path.replace(/\\/*$/, '');",
      'const quote = /`/g;',
      '// a comment',
      'const ratio = total / count; /* inline */',
      '/* a block',
      '   over lines */',
    );
    expect(count('a.js', text)).toEqual({ lines: 6, code: 3, comments: 3, blank: 0 });
  });

  it('counts a line that ends a block comment and has code as code', () => {
    const text = lines('/* start', ' middle', '*/ const x = 1;');
    expect(count('a.ts', text)).toEqual({ lines: 3, code: 1, comments: 2, blank: 0 });
  });

  it('reads CRLF endings and a last line without a newline', () => {
    expect(count('a.ts', 'a();\r\n\r\n// c')).toEqual({ lines: 3, code: 1, comments: 1, blank: 1 });
    expect(count('a.ts', '')).toEqual({ lines: 0, code: 0, comments: 0, blank: 0 });
    expect(count('a.ts', '\n')).toEqual({ lines: 1, code: 0, comments: 0, blank: 1 });
  });

  it("counts Python's docstrings as comments, other triple-quoted strings as code", () => {
    const text = lines(
      '#!/usr/bin/env python3',
      '"""Module docstring."""',
      'import os',
      '',
      '',
      'def f():',
      '    """',
      '    A docstring',
      '    over lines.',
      '    """',
      '    s = """not a',
      'docstring"""',
      '    return s  # trailing',
    );
    // The shebang is code: it says how the file runs (cloc counts it so).
    expect(count('a.py', text)).toEqual({ lines: 13, code: 6, comments: 5, blank: 2 });
  });

  it('counts a shebang as code, and a #! further down as a comment', () => {
    expect(count('run.sh', lines('#!/usr/bin/env bash', '# usage', 'echo hi', '#!x'))).toEqual({
      lines: 4,
      code: 2,
      comments: 2,
      blank: 0,
    });
  });

  it('has no line comments in CSS, and SCSS has them', () => {
    const css = lines(
      '/* Tokens */',
      '.a {',
      "  background: url('//cdn/x.png');",
      '  color: red; /* note */',
      '}',
    );
    expect(count('a.css', css)).toEqual({ lines: 5, code: 4, comments: 1, blank: 0 });
    expect(count('a.scss', lines('// a note', '$gap: 8px;'))).toEqual({
      lines: 2,
      code: 1,
      comments: 1,
      blank: 0,
    });
  });

  it("reads HTML's comments, and apostrophes in its text are not strings", () => {
    const text = lines('<!-- a', 'comment -->', "<p>Don't stop</p>", '<!-- one --> <p>x</p>');
    expect(count('a.html', text)).toEqual({ lines: 4, code: 2, comments: 2, blank: 0 });
  });

  it("reads a Vue file's template and script comments", () => {
    const text = lines(
      '<template>',
      '  <!-- note -->',
      '  <p>{{ msg }}</p>',
      '</template>',
      '<script setup lang="ts">',
      '// a comment',
      "const msg = 'hi';",
      '</script>',
    );
    expect(count('a.vue', text)).toEqual({ lines: 8, code: 6, comments: 2, blank: 0 });
  });

  it('reads # comments, and not inside a string', () => {
    const text = lines('# config', 'name: x # trailing', 'url: "http://a#b"', '# end');
    expect(count('a.yaml', text)).toEqual({ lines: 4, code: 2, comments: 2, blank: 0 });
  });

  it("closes Go's raw strings at the backtick, backslash or not", () => {
    const text = lines('// Package p.', 'package p', '', 'var path = `C:\\`', '// done');
    expect(count('a.go', text)).toEqual({ lines: 5, code: 2, comments: 2, blank: 1 });
  });

  it('counts every non-blank line as code in a language it does not know', () => {
    expect(countLines('a\n\n# b\n', undefined)).toEqual({
      lines: 3,
      code: 2,
      comments: 0,
      blank: 1,
    });
  });
});

describe('languageOf', () => {
  it('knows a language by its extension, in any case, or by its file name', () => {
    expect(languageOf('src/a.ts')).toMatchObject({ name: 'TypeScript', kind: 'source' });
    expect(languageOf('src/App.TSX')).toMatchObject({ name: 'TSX', kind: 'source' });
    expect(languageOf('docker/Dockerfile')).toMatchObject({ name: 'Dockerfile', kind: 'source' });
    expect(languageOf('README.md')).toMatchObject({ name: 'Markdown', kind: 'docs' });
    expect(languageOf('package.json')).toMatchObject({ name: 'JSON', kind: 'data' });
    expect(languageOf('.gitignore')).toBeUndefined();
    expect(languageOf('LICENSE')).toBeUndefined();
  });
});
