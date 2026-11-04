import { describe, expect, it } from 'vitest';
import type { Folder } from '../src/folders.js';
import type { Pin } from '../src/pins.js';
import type { Known } from '../src/repositories.js';
import {
  entryRow,
  FOUND_LIMIT,
  groupsOf,
  marks,
  searched,
  shownPath,
  type Row,
} from '../src/page/search.js';
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
const groups = groupsOf({ tabs, pins, known: knowns, scanned: `${HOME}/code`, home: HOME });
const names = (rows: readonly Row[]) => rows.map((row) => row.name);

describe('groupsOf (decision 909)', () => {
  it('is Running by name, Pinned by name, Opened before last seen first, Found by path', () => {
    expect(groups.map((g) => [g.key, g.name, names(g.rows)])).toEqual([
      [
        'running',
        'Running',
        ['design-system', 'feature-saved-carts', 'payments-api', 'storefront'],
      ],
      ['pinned', 'Pinned', ['acme', 'docs-site', 'mobile-app', 'old-shop']],
      ['opened', 'Opened before', ['infra', 'fix-tax-rounding', 'analytics-etl']],
      ['found', 'Found in ~/code', ['blog', 'rust-playground', 'storefront-legacy']],
    ]);
  });

  it('puts a repository in one group: running first, then pinned, then opened before', () => {
    const paths = groups.flatMap((g) => g.rows.map((row) => row.path));
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

  it("names Found after the folder scanned, and leaves Opened before's gone folders to the server", () => {
    const none = groupsOf({ tabs: [], pins: [], known: [], scanned: null, home: HOME });
    expect(none.map((g) => [g.key, g.name, g.rows.length])).toEqual([
      ['running', 'Running', 0],
      ['pinned', 'Pinned', 0],
      ['opened', 'Opened before', 0],
      ['found', 'Found', 0],
    ]);
    const elsewhere = groupsOf({ tabs: [], pins: [], known: [], scanned: '/srv/git', home: HOME });
    expect(elsewhere[3]?.name).toBe('Found in /srv/git');
  });

  it(`draws ${FOUND_LIMIT} found repositories at most, and counts the rest`, () => {
    const many = Array.from({ length: FOUND_LIMIT + 7 }, (_, i) =>
      known(`code/r${String(i).padStart(4, '0')}`, { found: true }),
    );
    const found = groupsOf({
      tabs: [],
      pins: [],
      known: many,
      scanned: `${HOME}/code`,
      home: HOME,
    })[3];
    expect(found?.rows).toHaveLength(FOUND_LIMIT);
    expect(found?.more).toBe(7);
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
    const hits = searched(groups, 'store', HOME);
    expect(hits.map((g) => [g.key, names(g.rows), g.all])).toEqual([
      ['running', ['storefront', 'feature-saved-carts'], 4],
      ['opened', ['fix-tax-rounding'], 3],
      ['found', ['storefront-legacy'], 3],
    ]);
  });

  it('takes several words, any case, anywhere in the path', () => {
    expect(searched(groups, 'ACME  mob', HOME).flatMap((g) => names(g.rows))).toEqual([
      'mobile-app',
    ]);
    expect(searched(groups, 'code/s', HOME).flatMap((g) => names(g.rows))).toEqual([
      'feature-saved-carts',
      'storefront',
      'fix-tax-rounding',
      'rust-playground',
      'storefront-legacy',
    ]);
    // Home's own path is not searched: "dev" is in every path, as ~.
    expect(searched(groups, 'dev', HOME)).toEqual([]);
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
    const parts = { tabs, pins, known: knowns };
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
