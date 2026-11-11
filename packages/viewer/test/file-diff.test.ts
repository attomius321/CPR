import type { GraphNode, GraphSide, ReviewFile } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import type { Draft } from '../src/diff/comments.js';
import type { DiffRow } from '../src/diff/detail.js';
import {
  anchorKey,
  changeWords,
  draftsByLine,
  firstChangedRow,
  foldRows,
  foldsDrawn,
  lineAnchor,
  parseFileDiff,
  rowKey,
  stepFile,
  symbolFocus,
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

/** A side of a symbol: its file and its lines. */
const at = (file: string, start: number, end: number): GraphSide => ({
  file,
  range: { start: { line: start, col: 1 }, end: { line: end, col: 1 } },
  signature: '',
  hashes: { signature: '', body: '' },
});
const symbol = (
  status: GraphNode['status'],
  base: GraphSide | null,
  head: GraphSide | null,
  delta?: GraphNode['delta'],
): GraphNode => ({
  id: `${(head ?? base)?.file ?? 'pkg'}#f`,
  kind: 'function',
  name: 'f',
  container: null,
  language: 'typescript',
  exported: true,
  status,
  ...(delta ? { delta } : {}),
  previousId: null,
  base,
  head,
});

describe("a symbol's lines on the Files page (V104, decision 977)", () => {
  const added: ReviewFile = { status: 'added', path: 'src/c.ts' };
  const deleted: ReviewFile = { status: 'deleted', path: 'src/old.ts' };
  const files = [modified, renamed, added, deleted];

  it('shows an added or a modified symbol in its head file, with its lines on both sides', () => {
    expect(symbolFocus(symbol('added', null, at('src/c.ts', 3, 9)), files)).toEqual({
      path: 'src/c.ts',
      symbol: { head: { start: 3, end: 9 } },
    });
    expect(
      symbolFocus(symbol('modified', at('src/a.ts', 4, 8), at('src/a.ts', 5, 10)), files),
    ).toEqual({
      path: 'src/a.ts',
      symbol: { base: { start: 4, end: 8 }, head: { start: 5, end: 10 } },
    });
  });

  it('finds a renamed file by its old path on the base side', () => {
    // Modified in a file renamed from src/a.ts to src/b.ts: one file, both sides.
    const both = [renamed];
    expect(
      symbolFocus(symbol('modified', at('src/a.ts', 1, 3), at('src/b.ts', 1, 4)), both),
    ).toEqual({
      path: 'src/b.ts',
      symbol: { base: { start: 1, end: 3 }, head: { start: 1, end: 4 } },
    });
    // Removed from it: its deleted rows, in the file as the list names it.
    expect(symbolFocus(symbol('removed', at('src/a.ts', 6, 9), null), both)).toEqual({
      path: 'src/b.ts',
      symbol: { base: { start: 6, end: 9 } },
    });
  });

  it('shows a removed symbol in the file it was deleted from', () => {
    expect(symbolFocus(symbol('removed', at('src/old.ts', 2, 5), null), files)).toEqual({
      path: 'src/old.ts',
      symbol: { base: { start: 2, end: 5 } },
    });
    expect(symbolFocus(symbol('removed', at('src/a.ts', 12, 20), null), [modified])).toEqual({
      path: 'src/a.ts',
      symbol: { base: { start: 12, end: 20 } },
    });
  });

  it('shows a symbol moved to another file in the file it left, its head file if that is not listed', () => {
    const moved = symbol('modified', at('src/a.ts', 106, 120), at('src/c.ts', 1, 15), {
      signature: false,
      body: false,
      moved: true,
    });
    expect(symbolFocus(moved, files)).toEqual({
      path: 'src/a.ts',
      symbol: { base: { start: 106, end: 120 } },
    });
    // Moved and changed: the file it left still.
    expect(
      symbolFocus({ ...moved, delta: { signature: true, body: true, moved: true } }, files),
    ).toEqual({ path: 'src/a.ts', symbol: { base: { start: 106, end: 120 } } });
    expect(symbolFocus(moved, [added])).toEqual({
      path: 'src/c.ts',
      symbol: { head: { start: 1, end: 15 } },
    });
  });

  it('shows a context symbol in a changed file; none in a file not listed, or without a side', () => {
    expect(symbolFocus(symbol('unchanged', null, at('src/a.ts', 30, 40)), files)).toEqual({
      path: 'src/a.ts',
      symbol: { head: { start: 30, end: 40 } },
    });
    expect(symbolFocus(symbol('unchanged', null, at('src/other.ts', 1, 2)), files)).toBeNull();
    expect(symbolFocus(symbol('unchanged', null, null), files)).toBeNull();
    // A copy's old path is another file, still there: not the symbol's.
    const copied: ReviewFile = { status: 'copied', path: 'src/copy.ts', previousPath: 'src/a.ts' };
    expect(symbolFocus(symbol('removed', at('src/a.ts', 1, 2), null), [copied])).toBeNull();
  });
});

describe("a symbol's first changed row (V104, decision 977)", () => {
  const del = (base: number): DiffRow => ({ type: 'del', text: 'old', base });
  const kept = (base: number, head: number): DiffRow => ({ type: 'same', text: '', base, head });
  // Head's line 3 added; base's line 5 replaced by head's line 6.
  const rows: DiffRow[] = [
    ...same(1, 2),
    add(3),
    kept(3, 4),
    kept(4, 5),
    del(5),
    add(6),
    kept(6, 7),
  ];

  it('is its first added row: the code it has now', () => {
    expect(firstChangedRow(rows, { base: { start: 2, end: 6 }, head: { start: 2, end: 7 } })).toBe(
      'head:3',
    );
    // Not base's line 5, removed before it; not head's line 3, a change before the symbol.
    expect(firstChangedRow(rows, { base: { start: 3, end: 6 }, head: { start: 4, end: 7 } })).toBe(
      'head:6',
    );
  });

  it('is its first removed row when it has no added one: removed, or lines removed only', () => {
    expect(firstChangedRow(rows, { base: { start: 3, end: 5 } })).toBe('base:5');
    expect(firstChangedRow(rows, { base: { start: 4, end: 6 }, head: { start: 4, end: 5 } })).toBe(
      'base:5',
    );
  });

  it('is its first row when none of its lines changed, and none when no row holds it', () => {
    expect(firstChangedRow(rows, { head: { start: 4, end: 5 } })).toBe('head:4');
    expect(firstChangedRow(rows, { head: { start: 40, end: 50 } })).toBeNull();
    expect(firstChangedRow([], { head: { start: 1, end: 2 } })).toBeNull();
  });
});

describe('a line asked for on the Files page (V104)', () => {
  it("names a line clicked by its row's place, in the file it is on", () => {
    const head = { side: 'head' as const, path: 'src/b.ts', otherPath: 'src/a.ts', line: 3 };
    const base = { side: 'base' as const, path: 'src/a.ts', otherPath: 'src/b.ts', line: 2 };
    expect(anchorKey(renamed, head)).toBe('head:3');
    expect(anchorKey(renamed, base)).toBe('base:2');
    expect(anchorKey(modified, head)).toBeNull();
  });

  it('draws every row when the one asked for is past the first ones drawn', () => {
    const folds = foldRows(same(1, 10), new Set([0]));
    expect(foldsDrawn(folds, 4, null)).toHaveLength(4);
    expect(foldsDrawn(folds, 4, 'head:2')).toHaveLength(4);
    expect(foldsDrawn(folds, 4, 'head:8')).toHaveLength(10);
    expect(foldsDrawn(folds, 20, 'head:8')).toHaveLength(10);
  });
});
