import { describe, expect, it } from 'vitest';
import type { LibraryState, Skill } from '@symbiote/core';
import {
  commitMessage,
  libraryGitText,
  libraryName,
  librarySync,
  probeText,
  skillPlace,
} from '../src/skills/library.js';

// The skill library (SK1) as the Skills page and Settings say it.
const PLAIN: LibraryState = { folder: '/home/a/skills', exists: true, commits: 'none' };
const HELD: LibraryState = {
  folder: '/home/a/projects/skillbar/skills',
  exists: true,
  commits: 'push',
  git: {
    root: '/home/a/projects/skillbar',
    path: 'skills',
    branch: 'main',
    upstream: 'origin/main',
    remote: 'origin',
    ahead: 0,
    behind: 0,
    changes: [],
  },
};

const skill = (folder: Skill['folder'], name: string): Skill => ({
  folder,
  name,
  path: `${folder}/${name}/SKILL.md`,
  text: '',
  version: 'v',
  files: [],
  git: 'none',
  agents: [],
});

describe('the library in words', () => {
  it('names it by its repository and the folder in it, else by its own folder', () => {
    expect(libraryName(HELD)).toBe('skillbar/skills');
    expect(libraryName({ ...HELD, git: { ...HELD.git!, path: '' } })).toBe('skillbar');
    expect(libraryName(PLAIN)).toBe('skills');
  });

  it('gives a library skill’s full path, and a checkout skill’s as it is', () => {
    expect(skillPlace(skill('library', 'deploy'), HELD)).toBe(
      '/home/a/projects/skillbar/skills/deploy/SKILL.md',
    );
    expect(skillPlace(skill('.claude/skills', 'review'), HELD)).toBe(
      '.claude/skills/review/SKILL.md',
    );
  });

  it('says where its git is, or that it has none', () => {
    expect(libraryGitText(HELD)).toBe(
      'In the git repository /home/a/projects/skillbar, on main, tracking origin/main.',
    );
    expect(libraryGitText(PLAIN)).toBe('A plain folder: no git.');
    const bare = { root: '/home/a/projects/skillbar', path: 'skills', ahead: 0, behind: 0 };
    const alone = { ...bare, branch: 'main', changes: [] };
    expect(libraryGitText({ ...HELD, git: alone })).toBe(
      'In the git repository /home/a/projects/skillbar, on main, with no upstream.',
    );
    expect(libraryGitText({ ...HELD, git: { ...bare, changes: [] } })).toBe(
      'In the git repository /home/a/projects/skillbar, on no branch.',
    );
    expect(libraryGitText({ ...PLAIN, exists: false })).toBe(
      '/home/a/skills is not there: set another folder in Settings.',
    );
  });

  it('says how far it is from its upstream', () => {
    expect(librarySync(HELD.git!)).toBe('');
    expect(librarySync({ ...HELD.git!, ahead: 1 })).toBe('1 commit to push');
    expect(librarySync({ ...HELD.git!, ahead: 2, behind: 3 })).toBe(
      '2 commits to push · 3 to pull, as git last knew',
    );
    expect(librarySync({ ...HELD.git!, behind: 1 })).toBe('1 commit to pull, as git last knew');
  });
});

describe('a commit’s first message', () => {
  it('names the skills its changes are in', () => {
    expect(commitMessage([{ path: 'deploy/SKILL.md', state: 'new' }])).toBe('Skills: deploy');
    expect(
      commitMessage([
        { path: 'review/SKILL.md', state: 'changed' },
        { path: 'deploy/scripts/run.sh', state: 'new' },
        { path: 'deploy/SKILL.md', state: 'new' },
      ]),
    ).toBe('Skills: deploy, review');
    expect(
      commitMessage(
        ['a', 'b', 'c', 'd', 'e'].map((name) => ({ path: `${name}/SKILL.md`, state: 'new' })),
      ),
    ).toBe('Skills: a, b, c and 2 more');
    expect(commitMessage([{ path: 'README.md', state: 'changed' }])).toBe('Skills: README.md');
    expect(commitMessage([])).toBe('Skills');
  });
});

describe('what is at a folder, before the library is set there', () => {
  it('says what Save will do in a folder', () => {
    expect(probeText({ folder: '/s', kind: 'missing', skills: 0 }, false)).toEqual({
      text: 'Nothing there yet: Save makes the folder.',
      save: 'create',
    });
    expect(probeText({ folder: '/s', kind: 'empty', skills: 0 }, false)).toEqual({
      text: 'An empty folder: no git.',
      save: 'set',
    });
    expect(
      probeText(
        { folder: '/r/skills', kind: 'folder', skills: 2, git: { root: '/r', branch: 'main' } },
        false,
      ),
    ).toEqual({ text: '2 skills, in the git repository /r, on main.', save: 'set' });
    expect(probeText({ folder: '/s', kind: 'folder', skills: 1 }, false)).toEqual({
      text: '1 skill: a plain folder, no git.',
      save: 'set',
    });
    expect(
      probeText(
        { folder: '/r', kind: 'folder', skills: 0, git: { root: '/r' }, skillsFolder: 4 },
        false,
      ),
    ).toEqual({
      text: 'No skills here, in the git repository /r, on no branch. Its skills folder holds 4: give /r/skills to use those.',
      save: 'set',
    });
  });

  it('says what a clone will do, and refuses a folder with files', () => {
    expect(probeText({ folder: '/s', kind: 'missing', skills: 0 }, true)).toEqual({
      text: 'Nothing there yet: the repository is cloned into it.',
      save: 'clone',
    });
    expect(probeText({ folder: '/s', kind: 'empty', skills: 0 }, true)).toEqual({
      text: 'An empty folder: the repository is cloned into it.',
      save: 'clone',
    });
    expect(probeText({ folder: '/s', kind: 'folder', skills: 3 }, true)).toEqual({
      text: 'It holds files: clone into a new or empty folder.',
      save: null,
      error: true,
    });
  });

  it('says what is wrong with a path', () => {
    const problem = 'give the folder’s full path (/…, or ~/… in your home)';
    expect(probeText({ folder: 's', kind: 'missing', skills: 0, problem }, false)).toEqual({
      text: problem,
      save: null,
      error: true,
    });
  });
});
