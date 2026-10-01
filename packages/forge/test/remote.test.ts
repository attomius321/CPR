import { describe, expect, it } from 'vitest';
import { detectForge, parseRemote } from '../src/index.js';

describe('parseRemote', () => {
  it.each([
    ['https://github.com/acme/widgets.git', 'github.com', 'acme/widgets'],
    ['https://github.com/acme/widgets', 'github.com', 'acme/widgets'],
    ['git@github.com:acme/widgets.git', 'github.com', 'acme/widgets'],
    [
      'ssh://git@gitlab.example.com:2222/group/sub/proj.git',
      'gitlab.example.com',
      'group/sub/proj',
    ],
    ['https://oauth2:secret@gitlab.com/group/proj.git', 'gitlab.com', 'group/proj'],
    ['git@GitLab.com:group/sub/proj', 'gitlab.com', 'group/sub/proj'],
  ])('%s', (url, host, path) => {
    expect(parseRemote(url)).toEqual({ host, path });
  });

  it('rejects remotes without a project path', () => {
    expect(() => parseRemote('/srv/repos/widgets.git')).toThrow('cannot tell the forge project');
    expect(() => parseRemote('https://github.com/widgets')).toThrow(
      'cannot tell the forge project',
    );
  });
});

describe('detectForge', () => {
  it('reads the forge from the host name', () => {
    expect(detectForge('git@github.com:a/b.git', {}).kind).toBe('github');
    expect(detectForge('https://gitlab.example.com/g/p.git', {}).kind).toBe('gitlab');
  });

  it('needs to be told for other hosts', () => {
    expect(() => detectForge('https://code.example.com/g/p.git', {})).toThrow(
      '--forge github|gitlab',
    );
    expect(detectForge('https://code.example.com/g/p.git', {}, 'gitlab').kind).toBe('gitlab');
    expect(detectForge('https://code.example.com/g/p.git', { CPR_FORGE: 'github' }).kind).toBe(
      'github',
    );
  });

  it('keeps nested GitLab groups in the project path', () => {
    expect(detectForge('https://gitlab.com/a/b/c.git', {}).project).toBe('a/b/c');
  });
});
