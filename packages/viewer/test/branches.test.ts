import type { HistoryRefs } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { branchTree, type PanelEntry } from '../src/branches.js';

const sha = (c: string) => c.repeat(40);
const remote = (name: string, row: number | null = 1) => {
  const [origin = '', ...rest] = name.split('/');
  return { name, remote: origin, branch: rest.join('/'), sha: sha('r'), row };
};
const REFS: HistoryRefs = {
  version: 'v1',
  branches: [
    { name: 'wip', sha: sha('w'), upstream: 'origin/wip', ahead: 2, behind: 1, row: 3 },
    { name: 'main', sha: sha('m'), upstream: 'origin/main', ahead: 0, behind: 0, row: 0 },
    { name: 'old', sha: sha('o'), upstream: 'origin/old', gone: true, row: 9 },
    { name: 'alpha', sha: sha('a'), row: 5 },
  ],
  remotes: [
    remote('origin/wip'),
    remote('origin/main', 0),
    remote('origin/topic'),
    remote('origin/fix/two'),
    remote('origin/fix/one'),
    remote('origin/feature/deep/x', 40),
    remote('upstream/main', null),
  ],
};
const tree = (filter = '', toggled: string[] = []) =>
  branchTree(REFS, { current: 'main', filter, toggled: new Set(toggled) });
/** Entries as short strings: the shape is easier to read than objects. */
const show = (entries: PanelEntry[]) =>
  entries.map((e) => {
    const pad = 'depth' in e ? '  '.repeat(e.depth) : '';
    if (e.kind === 'section') return `# ${e.label} ${e.count}`;
    if (e.kind === 'folder') return `${pad}${e.open ? '▾' : '▸'} ${e.label}/ ${e.count}`;
    return `${pad}${e.current ? '● ' : ''}${e.label}`;
  });

describe('branchTree', () => {
  it('lists local branches (the current first) and remotes by folder, folders closed', () => {
    expect(show(tree())).toEqual([
      '# Local 4',
      '● main',
      'alpha',
      'old',
      'wip',
      '# Remotes 7',
      '▾ origin/ 6',
      '  ▸ feature/ 1',
      '  ▸ fix/ 2',
      '  main',
      '  topic',
      '  wip',
      '▾ upstream/ 1',
      '  main',
    ]);
  });

  it("carries each branch's full name, tip row, and how far it is from its upstream", () => {
    const entries = tree();
    expect(entries.find((e) => e.kind === 'branch' && e.name === 'wip')).toMatchObject({
      row: 3,
      upstream: 'origin/wip',
      ahead: 2,
      behind: 1,
    });
    expect(entries.find((e) => e.kind === 'branch' && e.name === 'old')).toMatchObject({
      gone: true,
    });
    expect(entries.find((e) => e.kind === 'branch' && e.name === 'upstream/main')).toMatchObject({
      label: 'main',
      row: null,
      depth: 1,
    });
  });

  it('opens a folder toggled, nested folders one level at a time, and closes a remote', () => {
    expect(show(tree('', ['remote:origin/fix', 'remote:origin/feature']))).toEqual([
      '# Local 4',
      '● main',
      'alpha',
      'old',
      'wip',
      '# Remotes 7',
      '▾ origin/ 6',
      '  ▾ feature/ 1',
      '    ▸ deep/ 1',
      '  ▾ fix/ 2',
      '    one',
      '    two',
      '  main',
      '  topic',
      '  wip',
      '▾ upstream/ 1',
      '  main',
    ]);
    expect(show(tree('', ['remote:origin']))).toEqual([
      '# Local 4',
      '● main',
      'alpha',
      'old',
      'wip',
      '# Remotes 7',
      '▸ origin/ 6',
      '▾ upstream/ 1',
      '  main',
    ]);
  });

  it('filters on the whole name, any case: folders with matches open, counts are matches', () => {
    expect(show(tree('DEEP', ['remote:origin']))).toEqual([
      '# Remotes 1',
      '▾ origin/ 1',
      '  ▾ feature/ 1',
      '    ▾ deep/ 1',
      '      x',
    ]);
    expect(show(tree('wip'))).toEqual(['# Local 1', 'wip', '# Remotes 1', '▾ origin/ 1', '  wip']);
    expect(show(tree('fix/t'))).toEqual(['# Remotes 1', '▾ origin/ 1', '  ▾ fix/ 1', '    two']);
    expect(tree('zzz')).toEqual([]);
  });
});
