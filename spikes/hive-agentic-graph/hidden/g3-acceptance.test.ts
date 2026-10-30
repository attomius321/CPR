// HV1's hidden acceptance tests for goal G3 (never shown to an agent): copied into a result's
// checkout as test/hidden-acceptance.test.ts. Each snippet's lines are labelled by hand: c code,
// m comment, b blank; each snippet holds a line that a counter without the rule it tests gets wrong.
import { describe, expect, it } from 'vitest';
import { countLines, languageOf } from '../src/index.js';

/** Rows of [label, text]: the expected counts and the file's text. */
function snippet(rows: [string, string][]) {
  const text = rows.map(([, row]) => row).join('\n') + '\n';
  const n = (label: string) => rows.filter(([l]) => l === label).length;
  return { text, want: { lines: rows.length, code: n('c'), comments: n('m'), blank: n('b') } };
}
const count = (path: string, text: string) => countLines(text, languageOf(path)?.syntax);

describe('languageOf', () => {
  it('keeps Rust, Swift and Lua as sources', () => {
    expect(languageOf('src/main.rs')).toMatchObject({ name: 'Rust', kind: 'source' });
    expect(languageOf('App.swift')).toMatchObject({ name: 'Swift', kind: 'source' });
    expect(languageOf('init.lua')).toMatchObject({ name: 'Lua', kind: 'source' });
  });
});

describe('Rust', () => {
  it('nests block comments', () => {
    const { text, want } = snippet([
      ['m', '// line comment'],
      ['m', '/// doc comment'],
      ['m', '/* outer /* inner */'],
      ['m', '   still comment */'],
      ['c', 'fn main() {'],
      ['c', '    let s = "a // not a comment";'],
      ['c', '}'],
      ['b', ''],
      ['m', '/*'],
      ['m', ' /*'],
      ['m', ' */'],
      ['m', ' still in the outer comment'],
      ['m', '*/'],
      ['c', 'let x = 1;'],
    ]);
    expect(count('a.rs', text)).toEqual(want);
  });

  it('follows strings and raw strings over lines', () => {
    const { text, want } = snippet([
      ['c', 'let a = "line one'],
      ['c', '/* inside a string */'],
      ['c', 'end";'],
      ['c', 'let r = r#"raw "quoted" /* not a comment */"#;'],
      ['c', 'let m = r##"'],
      ['c', '// inside a raw string'],
      ['c', '"# still raw'],
      ['c', '"##;'],
      ['m', '// after'],
      ['c', 'let b = br#"bytes'],
      ['c', '/* still bytes */'],
      ['c', '"#;'],
      ['m', '/* a comment */'],
    ]);
    expect(count('a.rs', text)).toEqual(want);
  });

  it('tells character literals from lifetimes and labels', () => {
    const { text, want } = snippet([
      ['c', "fn f<'a>(x: &'a str) -> char {"],
      ['c', `    let q = '"';`],
      ['m', '    // comment after a quote char'],
      ['c', "    let e = '\\'';"],
      ['c', "    'outer: loop { break 'outer; }"],
      ['c', `    let r: &'static str = "x"; /* a comment`],
      ['m', '    that goes on */'],
      ['c', "    'x'"],
      ['c', '}'],
    ]);
    expect(count('a.rs', text)).toEqual(want);
  });
});

describe('Swift', () => {
  it('nests block comments; follows multi-line and raw strings', () => {
    const { text, want } = snippet([
      ['m', '// comment'],
      ['m', '/* outer /* inner */ still outer */'],
      ['c', 'let s = "a /* b */ c"'],
      ['c', 'let m = """'],
      ['c', '  // in a multi-line string'],
      ['c', '  """'],
      ['c', 'let r = #"raw \\" "# // trailing'],
      ['c', 'let rm = #"""'],
      ['c', '  """ not the end'],
      ['c', '  """#'],
      ['m', '/*'],
      ['m', ' /* */'],
      ['m', '*/'],
      ['c', '#if DEBUG'],
      ['m', '// debug only'],
      ['c', '#endif'],
    ]);
    expect(count('App.swift', text)).toEqual(want);
  });

  it('ends a one-line string at its line', () => {
    const { text, want } = snippet([
      ['c', 'let x = "not closed'],
      ['m', '// a comment'],
    ]);
    expect(count('App.swift', text)).toEqual(want);
  });
});

describe('Lua', () => {
  it('reads long comments and long strings', () => {
    const { text, want } = snippet([
      ['m', '-- a comment'],
      ['m', '--[[ a long'],
      ['m', 'comment ]]'],
      ['m', '--[==[ level two'],
      ['m', ']] not closed yet'],
      ['m', ']==]'],
      ['c', 'local s = [[long'],
      ['c', '-- not a comment]]'],
      ['c', 'local t = "--[[ in a string"'],
      ['c', 'print(t) -- trailing'],
      ['m', '--[ just a line comment'],
      ['c', 'x = 1'],
      ['c', 'local u = [=[ a ]] b'],
      ['c', ']=] -- closes'],
      ['m', '-- c'],
      ['c', "local q = '--[['"],
      ['m', '-- d'],
    ]);
    expect(count('init.lua', text)).toEqual(want);
  });
});

describe('other languages', () => {
  it('count as before', () => {
    const ts = snippet([
      ['m', '/* a /* b */'],
      ['c', 'still code */ x'],
      ['c', "const s = 'it''s';"],
    ]);
    expect(count('a.ts', ts.text)).toEqual(ts.want);
    const py = snippet([
      ['m', '# c'],
      ['c', "x = 'a'"],
      ['m', '"""doc"""'],
    ]);
    expect(count('a.py', py.text)).toEqual(py.want);
  });
});
