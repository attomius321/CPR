// What the nexus page's list shows, and why a folder cannot be made a repository: moved out of
// main.ts (refactor/viewer-pages) as functions of the page's state, with what they gave there.
import { describe, expect, it } from 'vitest';
import type { Folder, FoldersAnswer } from '../src/folders.js';
import type { Known, RepositoriesAnswer } from '../src/repositories.js';
import { folderName, refusedFor, view } from '../src/page/home-view.js';
import type { Listings } from '../src/page/listings.js';
import type { PageState } from '../src/page/state.js';

const HOME = '/home/dev';
const KNOWN: RepositoriesAnswer = {
  home: HOME,
  drives: ['/mnt/c'],
  repositories: [],
  pins: [],
  scan: {
    folder: HOME,
    at: '2026-11-09T08:00:00.000Z',
    folders: 3,
    ms: 12,
    short: false,
    repositories: 0,
  },
};
const known = (path: string): Known => ({
  name: path.split('/').at(-1) ?? path,
  path: `${HOME}/${path}`,
  branch: 'main',
  opened: '2026-11-08T10:00:00.000Z',
});
const folder = (name: string, repository = false): Folder => ({
  name,
  path: `${HOME}/${name}`,
  repository,
});

function state(more: Partial<PageState> = {}): PageState {
  return {
    tabs: [],
    selected: null,
    browsed: null,
    asked: null,
    opened: new Set(),
    frames: new Map(),
    failure: null,
    readOnce: true,
    problem: null,
    known: KNOWN,
    query: '',
    pick: null,
    tree: null,
    openFolders: new Set(),
    starting: new Set(),
    failures: new Map(),
    restarting: new Set(),
    restartFailure: null,
    copied: null,
    lastView: {
      groups: [],
      rows: [],
      ghost: '',
      hint: 'slash',
      message: null,
      welcome: false,
      entries: null,
      preferred: null,
    },
    runningKey: '',
    readingKnown: null,
    ...more,
  };
}

/** Listings that answer `answer` for every folder asked. */
const reads = (answer: FoldersAnswer | null): Listings => ({
  listingOf: () => answer,
  folderListing: () => undefined,
  listedFolders: () => new Map(),
  readOpened: () => {},
  checkoutsOf: () => undefined,
  entriesOf: () => undefined,
});

describe('folderName', () => {
  it('names a folder as the list heads it: from home as ~, with its slash', () => {
    expect(folderName('/', HOME)).toBe('/');
    expect(folderName(`${HOME}/projects`, HOME)).toBe('~/projects/');
    expect(folderName('/srv/git', HOME)).toBe('/srv/git/');
  });
});

describe('refusedFor', () => {
  it('refuses the top, home and a drive; any other folder is the server’s to check', () => {
    const s = state();
    expect(refusedFor(s, '/')).toBe('The top folder (/) cannot be made a repository.');
    expect(refusedFor(s, HOME)).toBe(
      'Your home folder cannot be made a repository: pick a folder in it.',
    );
    expect(refusedFor(s, '/mnt/c')).toBe(
      'The drive /mnt/c cannot be made a repository: pick a folder on it.',
    );
    expect(refusedFor(s, `${HOME}/notes`)).toBeNull();
    expect(refusedFor({ known: null }, '/')).toBeNull();
  });
});

describe('view', () => {
  it('lists a typed folder’s folders by name, Tab completing from them', () => {
    const folders = [folder('app', true), folder('notes')];
    const v = view(
      state({ query: '~/' }),
      reads({ path: HOME, parent: '/home', folders, more: 0, places: [], picked: null }),
    );
    expect(v.groups.map((g) => [g.key, g.name, g.order])).toEqual([['hits', '~/', 'by name']]);
    expect(v.rows.map((r) => r.path)).toEqual([`${HOME}/app`, `${HOME}/notes`]);
    expect(v.hint).toBe('tab');
    expect(v.message).toBeNull();
    expect(v.entries).toBe(folders);
    expect(v.preferred).toBeNull();
    expect(v.welcome).toBe(false);
  });

  it('says what a typed folder does not hold', () => {
    const answer = {
      path: HOME,
      parent: '/home',
      folders: [folder('app')],
      more: 0,
      places: [],
      picked: null,
    };
    expect(view(state({ query: '~/z' }), reads(answer)).message).toBe(
      'Nothing in ~/ starts with “z”',
    );
    expect(view(state({ query: '~/' }), reads({ ...answer, folders: [] })).message).toBe(
      '~/ holds no folder',
    );
  });

  it('searches what the nexus knows by any part of its path, and counts what it searched', () => {
    const s = state({
      query: 'app',
      known: { ...KNOWN, repositories: [known('projects/app'), known('work/site')] },
    });
    const v = view(s, reads(null));
    expect(v.rows.map((r) => r.path)).toEqual([`${HOME}/projects/app`]);
    expect(v.hint).toBe('1 of 2');
    expect(v.message).toBeNull();
    expect(view(state({ ...s, query: 'zzz' }), reads(null)).message).toBe(
      'Nothing in home or the lists above has “zzz” in its path',
    );
  });

  it('welcomes a first run: nothing running, pinned or opened, and home holds nothing to show', () => {
    const v = view(state(), reads(null));
    expect(v.rows).toEqual([]);
    expect(v.welcome).toBe(true);
    expect(v.hint).toBe('slash');
    expect(v.message).toBe(
      'Home holds no folder to show: run symbiote view in a repository, or type a path.',
    );
    expect(view(state({ readOnce: false }), reads(null)).welcome).toBe(false);
  });
});
