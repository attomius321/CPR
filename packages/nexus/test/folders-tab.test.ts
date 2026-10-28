import { describe, expect, it } from 'vitest';
import type { Folder, Place } from '../src/folders.js';
import {
  actionOf,
  checkoutWords,
  countsText,
  crumbsOf,
  folderFromHash,
  FOLDERS,
  foldersHash,
  idleRepositories,
  moreText,
  nextOnGrid,
  typedFolder,
} from '../src/page/folders-tab.js';
import { selectedFrom } from '../src/page/tabs.js';

const places: Place[] = [
  { kind: 'home', name: 'Home', path: '/home/me' },
  { kind: 'symbiotes', name: 'projects', path: '/home/me/projects' },
  { kind: 'top', name: '/', path: '/' },
  { kind: 'drive', name: 'C:', path: '/mnt/c' },
];

describe('the Folders tab in the address', () => {
  it('is #folders, with the folder shown', () => {
    expect(foldersHash(null)).toBe('#folders');
    expect(foldersHash('/home/me/my projects')).toBe('#folders:%2Fhome%2Fme%2Fmy%20projects');
    expect(folderFromHash('#folders:%2Fhome%2Fme%2Fmy%20projects')).toBe('/home/me/my projects');
    expect(folderFromHash('#folders')).toBeNull();
    expect(folderFromHash('#folders:%E0%A4%A')).toBeNull();
    expect(folderFromHash('#%2Fhome%2Fme%2Fky')).toBeNull();
  });

  it("selects the Folders tab, apart from a Symbiote's, whose root is always absolute", () => {
    expect(selectedFrom('#folders')).toBe(FOLDERS);
    expect(selectedFrom('#folders:%2Fhome%2Fme')).toBe(FOLDERS);
    expect(selectedFrom('#%2Fhome%2Fme%2Fky')).toBe('/home/me/ky');
    expect(FOLDERS.startsWith('/')).toBe(false);
  });
});

describe('crumbsOf', () => {
  it('starts at home or a drive when the folder is in one, else at the top', () => {
    expect(crumbsOf('/home/me/projects/ky', places)).toEqual([
      { name: 'Home', path: '/home/me' },
      { name: 'projects', path: '/home/me/projects' },
      { name: 'ky', path: '/home/me/projects/ky' },
    ]);
    expect(crumbsOf('/home/me', places)).toEqual([{ name: 'Home', path: '/home/me' }]);
    expect(crumbsOf('/mnt/c/Users', places)).toEqual([
      { name: 'C:', path: '/mnt/c' },
      { name: 'Users', path: '/mnt/c/Users' },
    ]);
    expect(crumbsOf('/home/meow', places)).toEqual([
      { name: '/', path: '/' },
      { name: 'home', path: '/home' },
      { name: 'meow', path: '/home/meow' },
    ]);
    expect(crumbsOf('/', places)).toEqual([{ name: '/', path: '/' }]);
  });
});

describe('typedFolder', () => {
  it('is a full path as typed or pasted; ~ is home; anything else is none', () => {
    expect(typedFolder('/home/me/projects', '/home/me')).toBe('/home/me/projects');
    expect(typedFolder('  /srv/x/../y/ ', '/home/me')).toBe('/srv/x/../y/');
    expect(typedFolder('~', '/home/me')).toBe('/home/me');
    expect(typedFolder('~/projects', '/home/me')).toBe('/home/me/projects');
    expect(typedFolder('projects', '/home/me')).toBeNull();
    expect(typedFolder('~other/x', '/home/me')).toBeNull();
    expect(typedFolder('   ', '/home/me')).toBeNull();
  });
});

describe('actionOf', () => {
  it('opens a repository, shows one that runs, and has nothing for a plain folder', () => {
    const running = new Set(['/home/me/projects/ky']);
    const folder = (name: string, repository: boolean) => ({
      name,
      path: `/home/me/projects/${name}`,
      repository,
    });
    expect(actionOf(folder('ky', true), running)).toBe('show');
    expect(actionOf(folder('zod', true), running)).toBe('open');
    expect(actionOf(folder('notes', false), running)).toBeNull();
  });
});

describe('moreText', () => {
  it('counts the folders not listed', () => {
    expect(moreText(1)).toBe('and 1 more folder');
    expect(moreText(3950)).toBe('and 3,950 more folders');
  });
});

const folder = (name: string, over: Partial<Folder> = {}): Folder => ({
  name,
  path: `/home/me/projects/${name}`,
  repository: false,
  ...over,
});

describe("a repository's card (NX3)", () => {
  it('says what it has checked out: its branch, or the commit it is detached at', () => {
    expect(checkoutWords(folder('ky', { repository: true, branch: 'feature/x' }))).toBe(
      'feature/x',
    );
    expect(
      checkoutWords(
        folder('redis', {
          repository: true,
          detached: 'c5031f43a7eaa0d96311746acf759ee6d6acb053',
        }),
      ),
    ).toBe('detached at c5031f4');
    expect(checkoutWords(folder('odd', { repository: true }))).toBeNull();
  });

  it('is offered under the running Symbiotes when none serves it', () => {
    const listed = [
      folder('ky', { repository: true }),
      folder('notes'),
      folder('zod', { repository: true }),
    ];
    expect(idleRepositories(listed, new Set(['/home/me/projects/zod']))).toEqual([listed[0]]);
  });
});

describe("a folder's counts", () => {
  it('names its repositories and its other folders', () => {
    const repo = folder('ky', { repository: true });
    expect(countsText([repo, repo, folder('a'), folder('b'), folder('c')])).toBe(
      '2 repositories · 3 folders',
    );
    expect(countsText([repo, folder('a')])).toBe('1 repository · 1 folder');
    expect(countsText([folder('a'), folder('b')])).toBe('2 folders');
    expect(countsText([repo])).toBe('1 repository');
    expect(countsText([])).toBe('');
  });
});

describe('the arrows on a grid of cards and rows', () => {
  const box = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
  });
  // Five cards in three columns, then four rows in two columns under them.
  const boxes = [
    box(0, 0, 220, 72),
    box(240, 0, 220, 72),
    box(480, 0, 220, 72),
    box(0, 90, 220, 72),
    box(240, 90, 220, 72),
    box(0, 200, 280, 40),
    box(300, 200, 280, 40),
    box(0, 244, 280, 40),
    box(300, 244, 280, 40),
  ];

  it('moves to the next or the previous in reading order by → and ←', () => {
    expect(nextOnGrid(boxes, 2, 'ArrowRight')).toBe(3);
    expect(nextOnGrid(boxes, 4, 'ArrowRight')).toBe(5);
    expect(nextOnGrid(boxes, 3, 'ArrowLeft')).toBe(2);
    expect(nextOnGrid(boxes, 0, 'ArrowLeft')).toBeNull();
    expect(nextOnGrid(boxes, 8, 'ArrowRight')).toBeNull();
  });

  it('moves to the nearest under or over by ↓ and ↑, cards to rows and back', () => {
    expect(nextOnGrid(boxes, 1, 'ArrowDown')).toBe(4);
    expect(nextOnGrid(boxes, 2, 'ArrowDown')).toBe(4);
    expect(nextOnGrid(boxes, 4, 'ArrowDown')).toBe(6);
    expect(nextOnGrid(boxes, 3, 'ArrowDown')).toBe(5);
    expect(nextOnGrid(boxes, 6, 'ArrowDown')).toBe(8);
    expect(nextOnGrid(boxes, 8, 'ArrowDown')).toBeNull();
    expect(nextOnGrid(boxes, 7, 'ArrowUp')).toBe(5);
    expect(nextOnGrid(boxes, 6, 'ArrowUp')).toBe(4);
    expect(nextOnGrid(boxes, 4, 'ArrowUp')).toBe(1);
    expect(nextOnGrid(boxes, 0, 'ArrowUp')).toBeNull();
  });

  it('goes to the first by Home and the last by End; other keys do nothing', () => {
    expect(nextOnGrid(boxes, 4, 'Home')).toBe(0);
    expect(nextOnGrid(boxes, 4, 'End')).toBe(8);
    expect(nextOnGrid(boxes, 4, 'Enter')).toBeNull();
    expect(nextOnGrid([], 0, 'ArrowDown')).toBeNull();
  });
});
