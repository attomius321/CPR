import type { ReviewFile } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import type { Draft } from '../src/diff/comments.js';
import type { DiffRow } from '../src/diff/detail.js';
import {
  changeWords,
  draftsByLine,
  foldRows,
  lineAnchor,
  parseFileDiff,
  rowKey,
  stepFile,
} from '../src/diff/file-diff.js';

const header = (path: string) => [
  `diff --git a/${path} b/${path}`,
  'index 1111111..2222222 100644',
  `--- a/${path}`,
  `+++ b/${path}`,
];

describe('parseFileDiff (V60)', () => {
  it("reads git's one hunk into rows with both line numbers", () => {
    const text = [...header('src/a.ts'), '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three', ''];
    expect(parseFileDiff(text.join('\n'))).toEqual({
      kind: 'rows',
      rows: [
        { type: 'same', text: 'one', base: 1, head: 1 },
        { type: 'del', text: 'two', base: 2 },
        { type: 'add', text: 'TWO', head: 2 },
        { type: 'same', text: 'three', base: 3, head: 3 },
      ],
    });
  });

  it('reads an added file, and lines that look like headers once the hunk began', () => {
    const added = [
      'diff --git a/n.md b/n.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/n.md',
    ];
    expect(parseFileDiff([...added, '@@ -0,0 +1,2 @@', '+# New', '++++ b', ''].join('\n'))).toEqual(
      {
        kind: 'rows',
        rows: [
          { type: 'add', text: '# New', head: 1 },
          { type: 'add', text: '+++ b', head: 2 },
        ],
      },
    );
    const removed = [...header('x.sql'), '@@ -1,2 +0,0 @@', '--- a comment', '-select 1;', ''];
    expect(parseFileDiff(removed.join('\n'))).toEqual({
      kind: 'rows',
      rows: [
        { type: 'del', text: '-- a comment', base: 1 },
        { type: 'del', text: 'select 1;', base: 2 },
      ],
    });
  });

  it("drops a line's carriage return and git's no-newline marker", () => {
    const text = [
      ...header('c.txt'),
      '@@ -1,2 +1,2 @@',
      ' one\r',
      '-two',
      '+two',
      '\\ No newline at end of file',
    ];
    expect(parseFileDiff(text.join('\n'))).toEqual({
      kind: 'rows',
      rows: [
        { type: 'same', text: 'one', base: 1, head: 1 },
        { type: 'del', text: 'two', base: 2 },
        { type: 'add', text: 'two', head: 2 },
      ],
    });
  });

  it('says a binary file, and a diff with no line: a pure rename, a mode change, nothing', () => {
    expect(
      parseFileDiff('diff --git a/l.png b/l.png\nBinary files a/l.png and b/l.png differ\n'),
    ).toEqual({ kind: 'binary' });
    const rename =
      'diff --git a/a.ts b/b.ts\nsimilarity index 100%\nrename from a.ts\nrename to b.ts\n';
    expect(parseFileDiff(rename)).toEqual({ kind: 'none' });
    expect(parseFileDiff('diff --git a/r b/r\nold mode 100644\nnew mode 100755\n')).toEqual({
      kind: 'none',
    });
    expect(parseFileDiff('')).toEqual({ kind: 'none' });
  });
});

/** `n` unchanged rows from line `from`, as a diff's rows. */
const same = (from: number, n: number): DiffRow[] =>
  Array.from({ length: n }, (_, i) => ({
    type: 'same',
    text: `line ${from + i}`,
    base: from + i,
    head: from + i,
  }));
const add = (head: number): DiffRow => ({ type: 'add', text: 'new', head });

describe('foldRows (V60)', () => {
  it('folds unchanged runs to 3 lines of context, as git cuts its hunks', () => {
    const rows = [...same(1, 10), add(11), ...same(11, 20)];
    const folds = foldRows(rows, new Set());
    expect(folds.map((f) => (f.kind === 'gap' ? `gap ${f.start}-${f.end}` : f.index))).toEqual([
      'gap 0-7',
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      'gap 14-31',
    ]);
  });

  it('keeps two changes six lines apart in one run; seven apart hide one line', () => {
    const six = [add(1), ...same(1, 6), add(8)];
    expect(foldRows(six, new Set()).every((f) => f.kind === 'row')).toBe(true);
    const seven = [add(1), ...same(1, 7), add(9)];
    expect(foldRows(seven, new Set()).filter((f) => f.kind === 'gap')).toEqual([
      { kind: 'gap', start: 4, end: 5 },
    ]);
  });

  it('shows a fold that was opened, by where it starts', () => {
    const rows = [...same(1, 10), add(11)];
    expect(foldRows(rows, new Set([0]))).toHaveLength(11);
    // A row with a comment is drawn, inside a fold too.
    expect(foldRows(rows, new Set(), 3, new Set([2])).map((f) => f.kind)).toEqual([
      'gap',
      'row',
      'gap',
      'row',
      'row',
      'row',
      'row',
    ]);
    // A file without a change is one fold.
    expect(foldRows(same(1, 4), new Set())).toEqual([{ kind: 'gap', start: 0, end: 4 }]);
  });
});

const modified: ReviewFile = { status: 'modified', path: 'src/a.ts', added: 1, removed: 1 };
const renamed: ReviewFile = { status: 'renamed', path: 'src/b.ts', previousPath: 'src/a.ts' };

describe('lineAnchor (V60)', () => {
  const del: DiffRow = { type: 'del', text: 'two', base: 2 };
  const unchanged: DiffRow = { type: 'same', text: 'one', base: 1, head: 3 };

  it('puts an added line on head, a removed one on base, an unchanged one on head', () => {
    expect(lineAnchor(modified, add(2), false)).toEqual({
      side: 'head',
      path: 'src/a.ts',
      otherPath: 'src/a.ts',
      line: 2,
    });
    expect(lineAnchor(renamed, del, false)).toEqual({
      side: 'base',
      path: 'src/a.ts',
      otherPath: 'src/b.ts',
      line: 2,
    });
    expect(lineAnchor(renamed, unchanged, true)).toEqual({
      side: 'head',
      path: 'src/b.ts',
      otherPath: 'src/a.ts',
      line: 3,
    });
  });

  it('takes no unchanged line where a forge would refuse it', () => {
    expect(lineAnchor(modified, unchanged, false)).toBeNull();
  });

  it("finds a row's comments by the side and line they are on", () => {
    const at = (side: 'base' | 'head', path: string, line: number, id: string): Draft => ({
      id,
      anchor: { side, path, otherPath: path, line },
      body: id,
      print: '',
      start: null,
    });
    const drafts = [
      at('head', 'src/b.ts', 3, 'kept'),
      at('base', 'src/a.ts', 2, 'removed'),
      at('head', 'src/a.ts', 2, 'another file'),
      { ...at('head', 'src/b.ts', 3, 'summary'), anchor: null },
    ];
    const byLine = draftsByLine(drafts, renamed);
    expect([...byLine.keys()]).toEqual(['head:3', 'base:2']);
    expect(byLine.get(rowKey(unchanged))?.map((d) => d.id)).toEqual(['kept']);
    expect(byLine.get(rowKey(del))?.map((d) => d.id)).toEqual(['removed']);
  });
});

describe("a file's words (V60)", () => {
  it('says what changed in it', () => {
    expect(changeWords(modified)).toBe('modified');
    expect(changeWords(renamed)).toBe('renamed from src/a.ts');
    expect(changeWords({ status: 'added', path: 'logo.png', binary: true })).toBe('added, binary');
    expect(changeWords({ status: 'deleted', path: 'x.md', ignored: true })).toBe(
      'deleted, not analyzed',
    );
  });

  it('walks the list with j and k, from the first file', () => {
    const files = [modified, renamed];
    expect(stepFile(files, null, 1)).toBe('src/a.ts');
    expect(stepFile(files, 'src/a.ts', 1)).toBe('src/b.ts');
    expect(stepFile(files, 'src/b.ts', 1)).toBe('src/b.ts');
    expect(stepFile(files, 'src/b.ts', -1)).toBe('src/a.ts');
    expect(stepFile([], null, 1)).toBeNull();
  });
});
