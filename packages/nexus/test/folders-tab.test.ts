import { describe, expect, it } from 'vitest';
import { folderFromHash, foldersHash } from '../src/page/folders-tab.js';

describe('the folder browsed, in the address', () => {
  it('is #folders, with the folder shown', () => {
    expect(foldersHash(null)).toBe('#folders');
    expect(foldersHash('/home/me/my projects')).toBe('#folders:%2Fhome%2Fme%2Fmy%20projects');
    expect(folderFromHash('#folders:%2Fhome%2Fme%2Fmy%20projects')).toBe('/home/me/my projects');
    expect(folderFromHash('#folders')).toBeNull();
    expect(folderFromHash('#folders:%E0%A4%A')).toBeNull();
    expect(folderFromHash('#%2Fhome%2Fme%2Fky')).toBeNull();
  });
});
