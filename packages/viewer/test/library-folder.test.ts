// Where a skill's folder is, as the Skills page shows it (SK1): moved out of SkillsPage.tsx
// (refactor/viewer-pages) with what it gave there.
import { describe, expect, it } from 'vitest';
import type { LibraryState, Skill } from '@symbiote/core';
import { folderOf } from '../src/skills/library.js';

const LIBRARY: LibraryState = { folder: '/home/a/skills', exists: true, commits: 'none' };

const skill = (folder: Skill['folder']): Skill => ({
  folder,
  name: 'review',
  path: `${folder}/review/SKILL.md`,
  text: '',
  version: 'v',
  files: [],
  git: 'none',
  agents: [],
});

describe('folderOf', () => {
  it("names a library skill's folder by the library's, in full", () => {
    expect(folderOf(skill('library'), LIBRARY)).toBe('/home/a/skills');
  });

  it("names the checkout's skills by their own folder", () => {
    expect(folderOf(skill('.claude/skills'), LIBRARY)).toBe('.claude/skills');
    expect(folderOf(skill('.agents/skills'), undefined)).toBe('.agents/skills');
  });

  it('keeps a library skill\'s "library" while no library is read', () => {
    expect(folderOf(skill('library'), undefined)).toBe('library');
  });
});
