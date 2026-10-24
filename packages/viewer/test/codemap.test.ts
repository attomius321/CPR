import { describe, expect, it } from 'vitest';
import type { CodeFile, FileKind } from '@symbiote/monitor';
import {
  childRows,
  codeTree,
  concentration,
  crumbs,
  headline,
  largestFiles,
  nodeAt,
} from '../src/monitor/codemap.js';

const file = (path: string, code: number, kind: FileKind = 'source'): CodeFile => ({
  path,
  kind,
  language: 'TypeScript',
  lines: code,
  code,
  comments: 0,
  blank: 0,
});

const FILES = [
  file('src/a.ts', 600),
  file('src/b.ts', 300),
  file('src/deep/only/c.ts', 50),
  file('lib/d.ts', 40),
  file('lib/e.ts', 10),
  file('README.md', 200, 'docs'),
  file('src/a.test.ts', 400, 'test'),
  file('src/empty.ts', 0),
];
const SOURCE = new Set<FileKind>(['source']);

describe('codeTree', () => {
  it('adds up the lines of the kinds on, by folder, largest first; a file with none is left out', () => {
    const root = codeTree(FILES, SOURCE);
    expect(root).toMatchObject({ path: '', lines: 1000, files: 5 });
    expect(root.children?.map((c) => [c.name, c.path, c.lines, c.files])).toEqual([
      ['src', 'src', 950, 3],
      ['lib', 'lib', 50, 2],
    ]);
    const src = root.children![0]!;
    expect(src.children?.map((c) => [c.name, c.lines])).toEqual([
      ['a.ts', 600],
      ['b.ts', 300],
      ['deep/only', 50],
    ]);
    expect(src.children![0]!.file?.path).toBe('src/a.ts');
  });

  it('shows a chain of single folders as one name, with the deepest path', () => {
    const src = codeTree(FILES, SOURCE).children![0]!;
    const chain = src.children![2]!;
    expect(chain).toMatchObject({ name: 'deep/only', path: 'src/deep/only', lines: 50 });
    expect(chain.children?.map((c) => c.path)).toEqual(['src/deep/only/c.ts']);
  });

  it('counts the kinds turned on, and only those', () => {
    expect(codeTree(FILES, new Set(['source', 'test'])).lines).toBe(1400);
    const docs = codeTree(FILES, new Set(['docs']));
    expect(docs.children?.map((c) => c.path)).toEqual(['README.md']);
    expect(codeTree(FILES, new Set()).children).toEqual([]);
  });

  it('orders equal sizes by path, so a reload draws the same picture', () => {
    const root = codeTree([file('b.ts', 5), file('a.ts', 5)], SOURCE);
    expect(root.children?.map((c) => c.path)).toEqual(['a.ts', 'b.ts']);
  });
});

describe('nodeAt and crumbs', () => {
  const root = codeTree(FILES, SOURCE);
  it('finds a folder, the chain holding a folder, else the nearest folder above', () => {
    expect(nodeAt(root, 'src').path).toBe('src');
    expect(nodeAt(root, 'src/deep').path).toBe('src/deep/only');
    expect(nodeAt(root, 'src/deep/only').path).toBe('src/deep/only');
    expect(nodeAt(root, 'src/a.ts').path).toBe('src');
    expect(nodeAt(root, 'gone/away').path).toBe('');
    expect(nodeAt(root, '').path).toBe('');
  });

  it('lists the folders from the root to the one in view', () => {
    expect(crumbs(root, 'src/deep/only').map((n) => n.name)).toEqual(['', 'src', 'deep/only']);
    expect(crumbs(root, '').map((n) => n.path)).toEqual(['']);
  });
});

describe('concentration and headline', () => {
  const root = codeTree(FILES, SOURCE);
  it('finds how few files hold half, the largest tenth, and the leading folder', () => {
    expect(concentration(root)).toEqual({
      lines: 1000,
      files: 5,
      half: 1,
      tenth: 1,
      tenthShare: 0.6,
      leader: { name: 'src', share: 0.95 },
    });
    expect(concentration(nodeAt(root, 'lib'))).toMatchObject({ half: 1, leader: { name: 'd.ts' } });
  });

  it('says it in words', () => {
    expect(headline(concentration(root), 'lines of code')).toEqual([
      '1,000 lines of code in 5 files.',
      'Half of it is in 1 file (20 %);',
      'the largest file holds 60 %.',
      'src holds 95 %.',
    ]);
    const many = codeTree(
      Array.from({ length: 20 }, (_, i) => file(`f${String(i).padStart(2, '0')}.ts`, i + 1)),
      SOURCE,
    );
    expect(headline(concentration(many), 'lines')).toEqual([
      '210 lines in 20 files.',
      'Half of it is in 6 files (30 %);',
      'the largest 10 % of files (2) hold 19 %.',
      'f19.ts holds 10 %.',
    ]);
    const one = codeTree([file('a.ts', 1)], SOURCE);
    expect(headline(concentration(one), 'lines of code')).toEqual(['1 line of code in 1 file.']);
    expect(headline(concentration(codeTree([], SOURCE)), 'lines of code')).toEqual([]);
  });
});

describe('the list', () => {
  const root = codeTree(FILES, SOURCE);
  it("ranks the folder's children with their share, and marks where half is reached", () => {
    expect(childRows(root).map((r) => [r.node.name, r.share, r.half])).toEqual([
      ['src', 0.95, true],
      ['lib', 0.05, false],
    ]);
  });

  it('ranks every file under the folder, up to a limit', () => {
    expect(largestFiles(root, 3).map((r) => [r.node.path, r.share, r.half])).toEqual([
      ['src/a.ts', 0.6, true],
      ['src/b.ts', 0.3, false],
      ['src/deep/only/c.ts', 0.05, false],
    ]);
  });
});
