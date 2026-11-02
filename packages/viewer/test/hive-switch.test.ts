import { describe, expect, it } from 'vitest';
import {
  forgeWords,
  landsByWords,
  nameOf,
  offWords,
  onRefusal,
} from '../src/settings/hive-switch.js';

describe("Hive's switch, in words (HV4, decisions 771, 772)", () => {
  it('says what Hive off does to each step in flight, and what on again does', () => {
    expect(offWords('writing')).toBe('its agent is stopped; on again, Hive tells it to continue');
    expect(offWords('checking')).toBe('its check is stopped; on again, the check runs again');
    expect(offWords('reviewing')).toBe(
      'its review is stopped and its copy deleted; on again, a new review',
    );
    expect(offWords('landing')).toMatch(/^its landing goes on: the merge queue checks, lands/);
  });

  it('refuses to turn on while a workspace is in normal mode, and says what to do', () => {
    expect(onRefusal({ normal: [] })).toBeNull();
    expect(onRefusal({ normal: [{ branch: 'feature/a' }] })).toBe(
      'Hive cannot turn on while a workspace is in normal mode. Land it or clean it up first:',
    );
    expect(onRefusal({ normal: [{ branch: 'a' }, { branch: 'b' }] })).toMatch(
      /^Hive cannot turn on while these workspaces are in normal mode\. Land them/,
    );
  });

  it('names a workspace by its title, else its branch', () => {
    expect(nameOf({ branch: 'feature/a', title: 'A' })).toBe('A');
    expect(nameOf({ branch: 'feature/a' })).toBe('feature/a');
  });
});

describe('Hive lands by (HV8)', () => {
  it('Hive off leaves a request open on the forge, and reads it again once on', () => {
    expect(offWords('landing', { forge: 'github', number: 12 })).toBe(
      'its pull request #12 stays open on GitHub: merge it there; Hive reads it again once on',
    );
    expect(offWords('landing', { forge: 'gitlab', number: 3 })).toBe(
      'its merge request !3 stays open on GitLab: merge it there; Hive reads it again once on',
    );
  });

  it('says what each choice does, and whether a request can be opened', () => {
    expect(landsByWords('queue')).toBe(
      'Hive merges each workspace into the branch it started from through the merge queue, which checks the merge, lands it and pushes both branches.',
    );
    expect(landsByWords('request')).toBe(
      'Hive pushes the branch and opens a pull request (GitHub) or merge request (GitLab) into the branch the workspace started from. You review and merge it there: your merge lands it. A conflict goes back to the agent.',
    );
    expect(
      forgeWords({
        by: 'request',
        forge: { kind: 'github', host: 'github.com', project: 'acme/app' },
        token: true,
      }),
    ).toEqual({ text: 'origin is acme/app on GitHub; a token is found.', ok: true });
    expect(
      forgeWords({
        by: 'queue',
        forge: { kind: 'gitlab', host: 'gitlab.com', project: 'acme/app' },
        token: false,
        why: 'no GitLab token for gitlab.com: set GITLAB_TOKEN',
      }),
    ).toEqual({
      text: 'origin is acme/app on GitLab. Hive cannot open a request now: no GitLab token for gitlab.com: set GITLAB_TOKEN.',
      ok: false,
    });
    expect(
      forgeWords({ by: 'request', token: false, why: 'the repository has no remote named origin' }),
    ).toEqual({
      text: 'Hive cannot open a request now: the repository has no remote named origin.',
      ok: false,
    });
  });
});
