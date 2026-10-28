import { describe, expect, it } from 'vitest';
import type { Place } from '../src/folders.js';
import {
  actionOf,
  crumbsOf,
  folderFromHash,
  FOLDERS,
  foldersHash,
  moreText,
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
