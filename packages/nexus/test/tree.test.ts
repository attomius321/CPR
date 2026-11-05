import { describe, expect, it } from 'vitest';
import { shownFolders, treeOf, type Tree } from '../src/page/tree.js';

const HOME = '/home/dev';
const tree: Tree = treeOf({
  folder: HOME,
  at: '2026-11-05T10:00:00.000Z',
  tree: [
    `${HOME}/code`,
    `${HOME}/code/ky`,
    `${HOME}/code/item10`,
    `${HOME}/code/item9`,
    `${HOME}/code/Zod`,
    `${HOME}/code/sandbox`,
    `${HOME}/code/sandbox/rust`,
    `${HOME}/notes`,
    `${HOME}/big`,
    `${HOME}/big/a`,
  ],
  unread: [`${HOME}/big/a`],
});
const shown = (open: string[], listed: Record<string, string[]> = {}) =>
  shownFolders(tree, new Set(open), (path) => listed[path]).map(
    (f) =>
      `${'  '.repeat(f.depth)}${f.path.slice(HOME.length + 1)}${f.open ? ' ▾' : ''}${
        f.leaf === true ? '' : f.leaf === null ? ' ?' : f.open ? '' : ' ▸'
      }`,
  );

describe('treeOf (decision 926)', () => {
  it("is each folder's folders in a file manager's order, and the ones not read", () => {
    expect(tree.children.get(HOME)).toEqual([`${HOME}/big`, `${HOME}/code`, `${HOME}/notes`]);
    expect(tree.children.get(`${HOME}/code`)).toEqual([
      `${HOME}/code/item9`,
      `${HOME}/code/item10`,
      `${HOME}/code/ky`,
      `${HOME}/code/sandbox`,
      `${HOME}/code/Zod`,
    ]);
    expect(tree.unread.has(`${HOME}/big/a`)).toBe(true);
    expect(tree.all).toHaveLength(10);
  });
});

describe('shownFolders', () => {
  it("is home's first level at first, each folder with whether it holds more", () => {
    expect(shown([])).toEqual(['big ▸', 'code ▸', 'notes']);
  });

  it("is an opened folder's folders under it, depth first", () => {
    expect(shown([`${HOME}/code`, `${HOME}/code/sandbox`])).toEqual([
      'big ▸',
      'code ▾',
      '  code/item9',
      '  code/item10',
      '  code/ky',
      '  code/sandbox ▾',
      '    code/sandbox/rust',
      '  code/Zod',
      'notes',
    ]);
    // A folder opened under a closed one stays hidden.
    expect(shown([`${HOME}/code/sandbox`])).toEqual(['big ▸', 'code ▸', 'notes']);
  });

  it('reads a folder the scan did not, once opened: unknown until its listing answers', () => {
    expect(shown([`${HOME}/big`])).toEqual(['big ▾', '  big/a ?', 'code ▸', 'notes']);
    expect(shown([`${HOME}/big`, `${HOME}/big/a`])).toEqual([
      'big ▾',
      '  big/a ▾ ?',
      'code ▸',
      'notes',
    ]);
    expect(
      shown([`${HOME}/big`, `${HOME}/big/a`], { [`${HOME}/big/a`]: [`${HOME}/big/a/b`] }),
    ).toEqual(['big ▾', '  big/a ▾', '    big/a/b ?', 'code ▸', 'notes']);
  });
});
