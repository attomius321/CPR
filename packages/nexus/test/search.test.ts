import { describe, expect, it } from 'vitest';
import type { Folder } from '../src/folders.js';
import type { Pin } from '../src/pins.js';
import type { Known } from '../src/repositories.js';
import {
  entryRow,
  groupsOf,
  HOME_LIMIT,
  homeRows,
  marks,
  searched,
  shownPath,
  type Row,
} from '../src/page/search.js';
import { shownFolders, treeOf } from '../src/page/tree.js';
import type { Tab } from '../src/page/tabs.js';

const HOME = '/home/dev';
const tab = (path: string, branch = 'main'): Tab & { url: string } => ({
  root: `${HOME}/${path}`,
  name: path.split('/').at(-1) ?? path,
  branch,
  head: 'a1b2c3d',
  changed: 0,
  started: '2026-11-04T08:00:00.000Z',
  url: 'http://127.0.0.1:4100/',
});
const pin = (path: string, more: Partial<Pin> = {}): Pin => ({
  name: path.split('/').at(-1) ?? path,
  path: `${HOME}/${path}`,
  repository: true,
  branch: 'main',
  ...more,
});
const known = (path: string, more: Partial<Known> = {}): Known => ({
  name: path.split('/').at(-1) ?? path,
  path: `${HOME}/${path}`,
  branch: 'main',
  ...more,
});

const tabs = [
  tab('code/storefront'),
  tab('code/storefront.worktrees/feature-saved-carts', 'feature/saved-carts'),
  tab('code/payments-api'),
  tab('code/design-system'),
];
const pins = [
  pin('work/acme/mobile-app'),
  pin('code/storefront'),
  pin('work/acme', { repository: false }),
  pin('code/docs-site'),
  pin('code/old-shop', { repository: false, missing: true }),
];
const knowns = [
  known('code/infra', { opened: '2026-11-02T14:30:00.000Z' }),
  known('code/storefront.worktrees/fix-tax-rounding', { opened: '2026-10-30T11:00:00.000Z' }),
  known('work/acme/analytics-etl', { opened: '2026-10-28T09:10:00.000Z' }),
  known('code/blog', { found: true }),
  known('code/storefront-legacy', { found: true }),
  known('code/sandbox/rust-playground', { found: true }),
  known('code/payments-api', { found: true, opened: '2026-11-01T10:00:00.000Z' }),
  known('code/docs-site', { found: true }),
];
// Home's tree as the scan found it (NX6, decision 926): the folders, the repositories among them.
const tree = treeOf({
  folder: HOME,
  at: '2026-11-05T10:00:00.000Z',
  tree: [
    'code',
    'code/blog',
    'code/design-system',
    'code/docs-site',
    'code/infra',
    'code/payments-api',
    'code/sandbox',
    'code/sandbox/rust-playground',
    'code/storefront',
    'code/storefront-legacy',
    'notes',
    'work',
    'work/acme',
  ].map((path) => `${HOME}/${path}`),
  unread: [],
});
const parts = { tabs, pins, known: knowns };
const shownTree = (open: string[] = []) =>
  homeRows(
    shownFolders(tree, new Set(open.map((path) => `${HOME}/${path}`)), () => undefined),
    parts,
  );
const groups = groupsOf({ ...parts, tree: shownTree(['code']) });
/** The groups to search: home's every folder, flat (decision 926). */
const all = groupsOf({
  ...parts,
  tree: homeRows(
    tree.all.map((path) => ({ path })),
    parts,
  ),
  flat: true,
});
const names = (rows: readonly Row[]) => rows.map((row) => row.name);

describe('groupsOf (decisions 909, 926)', () => {
  it('is Running by name, Pinned by name, Opened before last seen first, then Home as a tree', () => {
    expect(groups.map((g) => [g.key, g.name, names(g.rows)])).toEqual([
      [
        'running',
        'Running',
        ['design-system', 'feature-saved-carts', 'payments-api', 'storefront'],
      ],
      ['pinned', 'Pinned', ['acme', 'docs-site', 'mobile-app', 'old-shop']],
      ['opened', 'Opened before', ['infra', 'fix-tax-rounding', 'analytics-etl']],
      [
        'home',
        'Home',
        [
          'code',
          'blog',
          'design-system',
          'docs-site',
          'infra',
          'payments-api',
          'sandbox',
          'storefront',
          'storefront-legacy',
          'notes',
          'work',
        ],
      ],
    ]);
    // In the tree, each folder in its place: a running or pinned repository too.
    expect(groups[3]?.rows.map((row) => [row.name, row.depth, row.open, row.leaf])).toEqual([
      ['code', 0, true, false],
      ['blog', 1, false, true],
      ['design-system', 1, false, true],
      ['docs-site', 1, false, true],
      ['infra', 1, false, true],
      ['payments-api', 1, false, true],
      ['sandbox', 1, false, false],
      ['storefront', 1, false, true],
      ['storefront-legacy', 1, false, true],
      ['notes', 0, false, true],
      ['work', 0, false, false],
    ]);
    expect(groups[3]?.rows.find((row) => row.name === 'storefront')).toMatchObject({
      repository: true,
      pinned: true,
      tab: { root: `${HOME}/code/storefront` },
    });
    expect(groups[3]?.rows.find((row) => row.name === 'blog')).toMatchObject({
      repository: true,
      branch: 'main',
      found: true,
    });
    expect(groups[3]?.rows.find((row) => row.name === 'code')).toEqual({
      name: 'code',
      path: `${HOME}/code`,
      repository: false,
      depth: 0,
      open: true,
      leaf: false,
    });
  });

  it('puts a repository in one group above Home: running first, then pinned, then opened before', () => {
    const paths = groups.slice(0, 3).flatMap((g) => g.rows.map((row) => row.path));
    expect(new Set(paths).size).toBe(paths.length);
    const storefront = groups[0]?.rows.find((row) => row.name === 'storefront');
    expect(storefront).toMatchObject({ pinned: true, repository: true });
    expect(storefront?.tab?.url).toBe('http://127.0.0.1:4100/');
    // Found and opened before: its time kept with it.
    expect(groups[0]?.rows.find((row) => row.name === 'payments-api')).toMatchObject({
      opened: '2026-11-01T10:00:00.000Z',
    });
  });

  it('marks a pinned folder and a pin whose folder is gone', () => {
    expect(groups[1]?.rows.find((row) => row.name === 'acme')).toEqual({
      name: 'acme',
      path: `${HOME}/work/acme`,
      repository: false,
      pinned: true,
    });
    expect(groups[1]?.rows.find((row) => row.name === 'old-shop')).toMatchObject({ missing: true });
  });

  it('has every group, empty ones too, before anything is known', () => {
    const none = groupsOf({ tabs: [], pins: [], known: [], tree: [] });
    expect(none.map((g) => [g.key, g.name, g.rows.length])).toEqual([
      ['running', 'Running', 0],
      ['pinned', 'Pinned', 0],
      ['opened', 'Opened before', 0],
      ['home', 'Home', 0],
    ]);
  });

  it(`flat, for a search: home's folders by path, none shown above, ${HOME_LIMIT} at most`, () => {
    const home = all[3];
    expect(home?.order).toBe('by path');
    expect(home?.rows.map((row) => shownPath(row.path, HOME))).toEqual([
      '~/code',
      '~/code/blog',
      '~/code/sandbox',
      '~/code/sandbox/rust-playground',
      '~/code/storefront-legacy',
      '~/notes',
      '~/work',
    ]);
    const many = Array.from({ length: HOME_LIMIT + 7 }, (_, i) => ({
      path: `${HOME}/r${String(i).padStart(4, '0')}`,
      depth: 0,
      open: false,
      leaf: true,
    }));
    const flat = groupsOf({
      tabs: [],
      pins: [],
      known: [],
      tree: homeRows(many, { tabs: [], pins: [], known: [] }),
      flat: true,
    })[3];
    expect(flat?.rows).toHaveLength(HOME_LIMIT);
    expect(flat?.more).toBe(7);
  });
});

describe('shownPath', () => {
  it('is a path from home as ~, any other as it is', () => {
    expect(shownPath(`${HOME}/code/ky`, HOME)).toBe('~/code/ky');
    expect(shownPath(HOME, HOME)).toBe('~');
    expect(shownPath(`${HOME}er/x`, HOME)).toBe(`${HOME}er/x`);
    expect(shownPath('/mnt/c/Users', HOME)).toBe('/mnt/c/Users');
  });
});

describe('searched (decision 910)', () => {
  it('keeps the rows with every word in their path from home, a name match first', () => {
    const hits = searched(all, 'store', HOME);
    expect(hits.map((g) => [g.key, names(g.rows), g.all])).toEqual([
      ['running', ['storefront', 'feature-saved-carts'], 4],
      ['opened', ['fix-tax-rounding'], 3],
      ['home', ['storefront-legacy'], 7],
    ]);
    // Folders too (decision 926).
    expect(searched(all, 'sand', HOME).flatMap((g) => names(g.rows))).toEqual([
      'sandbox',
      'rust-playground',
    ]);
  });

  it('takes several words, any case, anywhere in the path', () => {
    expect(searched(all, 'ACME  mob', HOME).flatMap((g) => names(g.rows))).toEqual(['mobile-app']);
    expect(searched(all, 'code/s', HOME).flatMap((g) => names(g.rows))).toEqual([
      'feature-saved-carts',
      'storefront',
      'fix-tax-rounding',
      'sandbox',
      'rust-playground',
      'storefront-legacy',
    ]);
    // Home's own path is not searched: "dev" is in every path, as ~.
    expect(searched(all, 'dev', HOME)).toEqual([]);
  });

  it('keeps every group as it is for no words', () => {
    expect(searched(groups, '  ', HOME)).toEqual(groups.filter((g) => g.rows.length > 0));
  });
});

describe('marks', () => {
  it("is where each word is, in the words' case aside, overlaps joined", () => {
    expect(marks('~/code/storefront', 'store')).toEqual([[7, 12]]);
    expect(marks('~/code/storefront.worktrees/store', 'STORE')).toEqual([
      [7, 12],
      [28, 33],
    ]);
    expect(marks('storefront', 'stor tore')).toEqual([[0, 5]]);
    expect(marks('storefront', 'front sto')).toEqual([
      [0, 3],
      [5, 10],
    ]);
    expect(marks('storefront', '')).toEqual([]);
  });
});

describe('entryRow', () => {
  it("is a listed folder as a row: a repository with its Symbiote, its pin and what's known", () => {
    const folder = (path: string, repository: boolean): Folder => ({
      name: path.split('/').at(-1) ?? path,
      path: `${HOME}/${path}`,
      repository,
      ...(repository ? { branch: 'main' } : {}),
    });
    expect(entryRow(folder('code/storefront', true), parts)).toMatchObject({
      name: 'storefront',
      repository: true,
      pinned: true,
      tab: { root: `${HOME}/code/storefront` },
    });
    expect(entryRow(folder('code/infra', true), parts)).toEqual({
      name: 'infra',
      path: `${HOME}/code/infra`,
      repository: true,
      branch: 'main',
      opened: '2026-11-02T14:30:00.000Z',
    });
    expect(entryRow(folder('code/sandbox', false), parts)).toEqual({
      name: 'sandbox',
      path: `${HOME}/code/sandbox`,
      repository: false,
    });
  });
});
