import type { Graph } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  backLink,
  diffTitle,
  diffView,
  hrefOf,
  inShell,
  pageTitle,
  revisionsLabel,
  routeOf,
  routeTitle,
  withDiffView,
} from '../src/shell/pages.js';

describe('routeOf (V29a: no Workspaces page)', () => {
  it('opens Git and Settings at their addresses', () => {
    expect(routeOf('/git', '')).toEqual({ route: { page: 'git' } });
    expect(routeOf('/git', '?branch=wip')).toEqual({ route: { page: 'git' } });
    expect(routeOf('/settings', '')).toEqual({ route: { page: 'settings' } });
    expect(inShell(new URL('http://symbiote/git?scope=current'))).toBe(true);
  });

  it("moves History's old address to Git (V66), its scope or branch kept", () => {
    expect(routeOf('/history', '')).toEqual({ route: { page: 'git' }, moved: '/git' });
    expect(routeOf('/history', '?scope=current')).toEqual({
      route: { page: 'git' },
      moved: '/git?scope=current',
    });
    expect(routeOf('/history', '?branch=feature%2Fx')).toEqual({
      route: { page: 'git' },
      moved: '/git?branch=feature%2Fx',
    });
    expect(inShell(new URL('http://symbiote/history'))).toBe(true);
  });

  it('opens a workspace at /?branch=, the address Symbiote has given out since V25', () => {
    expect(routeOf('/', '?branch=feature%2Fx')).toEqual({
      route: { page: 'workspace', branch: 'feature/x' },
    });
    expect(routeOf('/', '?branch=feature%2Fx&thread')).toEqual({
      route: { page: 'workspace', branch: 'feature/x' },
    });
    expect(routeOf('/', '?branch=feature%2Fx&send=verdict')).toEqual({
      route: { page: 'workspace', branch: 'feature/x' },
    });
  });

  it('opens Start a workspace at /start, at a commit with ?at= (V30a)', () => {
    const sha = 'a'.repeat(40);
    expect(routeOf('/start', '')).toEqual({ route: { page: 'start' } });
    expect(routeOf('/start', `?at=${sha}`)).toEqual({ route: { page: 'start', at: sha } });
    expect(routeOf('/start', '?at=')).toEqual({ route: { page: 'start' } });
    expect(inShell(new URL('http://symbiote/start?at=x'))).toBe(true);
  });

  it('opens a merge at /?merge=', () => {
    expect(routeOf('/', '?merge=fix%2Fy')).toEqual({ route: { page: 'merge', branch: 'fix/y' } });
  });

  it('opens Git at the root alone, shown at its own address', () => {
    expect(routeOf('/', '')).toEqual({ route: { page: 'git' }, moved: '/git' });
    expect(routeOf('/', '?branch=')).toEqual({ route: { page: 'git' }, moved: '/git' });
  });

  it("moves the old addresses of Workspaces: a workspace to today's, the rest to Git", () => {
    for (const old of ['/workspaces', '/features']) {
      expect(routeOf(old, '?branch=feature%2Fx&thread')).toEqual({
        route: { page: 'workspace', branch: 'feature/x' },
        moved: '/?branch=feature%2Fx&thread',
      });
      expect(routeOf(old, '')).toEqual({ route: { page: 'git' }, moved: '/git' });
    }
  });
});

describe('hrefOf', () => {
  it('gives each route its address, the one routeOf reads', () => {
    expect(hrefOf({ page: 'git' })).toBe('/git');
    expect(hrefOf({ page: 'settings' })).toBe('/settings');
    // An entry of Settings (SK1's Skill library): the page reads it from the address, as Skills
    // reads ?skill=; the shell's route is Settings.
    expect(hrefOf({ page: 'settings', prompt: 'skill-library' })).toBe(
      '/settings?prompt=skill-library',
    );
    expect(routeOf('/settings', '?prompt=skill-library')).toEqual({ route: { page: 'settings' } });
    expect(hrefOf({ page: 'workspace', branch: 'feature/x' })).toBe('/?branch=feature%2Fx');
    expect(hrefOf({ page: 'merge', branch: 'fix/y' })).toBe('/?merge=fix%2Fy');
    expect(hrefOf({ page: 'start' })).toBe('/start');
    expect(hrefOf({ page: 'start', at: 'b'.repeat(40) })).toBe(`/start?at=${'b'.repeat(40)}`);
    for (const route of [
      { page: 'start', at: 'c'.repeat(40) },
      { page: 'workspace', branch: 'a b/c' },
      { page: 'merge', branch: 'chore/z' },
    ] as const) {
      const url = new URL(hrefOf(route), 'http://symbiote');
      expect(routeOf(url.pathname, url.search)).toEqual({ route });
    }
  });
});

describe('backLink (V25)', () => {
  const origin = 'http://127.0.0.1:4000';

  it('goes back to the page a diff was opened from, with its address', () => {
    expect(backLink(`${origin}/git?scope=current`, origin)).toEqual({
      href: '/git?scope=current',
      label: 'Git',
    });
    // Opened from History's old address, before V66: back to Git.
    expect(backLink(`${origin}/history?scope=current`, origin)).toEqual({
      href: '/git?scope=current',
      label: 'Git',
    });
    expect(backLink(`${origin}/?branch=feature%2Fx`, origin)).toEqual({
      href: '/?branch=feature%2Fx',
      label: 'Workspace',
    });
    expect(backLink(`${origin}/workspaces?branch=a`, origin)).toEqual({
      href: '/?branch=a',
      label: 'Workspace',
    });
    // A finished workspace's change, opened from History (V77): back to it there, its tab kept.
    expect(backLink(`${origin}/workspace-history?branch=feature%2Fx&changes`, origin)).toEqual({
      href: '/workspace-history?branch=feature%2Fx&changes',
      label: 'History',
    });
  });

  it('goes to Git when it does not know: a bookmark, another site, another diff', () => {
    const history = { href: '/git', label: 'Git' };
    expect(backLink('', origin)).toEqual(history);
    expect(backLink(`${origin}/`, origin)).toEqual(history);
    expect(backLink('https://github.com/acme/widgets/pull/7', origin)).toEqual(history);
    expect(backLink(`${origin}/diff/a..b/`, origin)).toEqual(history);
    expect(backLink('not a url', origin)).toEqual(history);
  });
});

describe('pageTitle and routeTitle (N1a: the window names its page)', () => {
  it('names the page, then the repository, then Symbiote', () => {
    expect(routeTitle({ page: 'git' }, 'ky')).toBe('Git · ky — Symbiote');
    expect(routeTitle({ page: 'settings' }, 'ky')).toBe('Settings · ky — Symbiote');
    expect(routeTitle({ page: 'workspace', branch: 'feature/add-clamp' }, 'ky', 'Add clamp')).toBe(
      'Add clamp · ky — Symbiote',
    );
    expect(routeTitle({ page: 'workspace', branch: 'feature/add-clamp' }, 'ky')).toBe(
      'feature/add-clamp · ky — Symbiote',
    );
    expect(routeTitle({ page: 'merge', branch: 'fix/x' }, undefined)).toBe(
      'Merge fix/x — Symbiote',
    );
    expect(routeTitle({ page: 'start' }, 'ky')).toBe('Start a workspace · ky — Symbiote');
  });

  it('leaves out what is not known', () => {
    expect(pageTitle()).toBe('Symbiote');
    expect(pageTitle(undefined, '')).toBe('Symbiote');
    expect(pageTitle('main → feature')).toBe('main → feature — Symbiote');
  });
});

describe('diffTitle (N1a)', () => {
  const graph = (extra: object = {}) =>
    ({
      revisions: {
        base: { ref: 'main', sha: '1234567890abcdef' },
        head: { ref: 'abcdef0123456789', sha: 'abcdef0123456789' },
      },
      ...extra,
    }) as unknown as Graph;

  it('names a pair by its refs, each SHA once and short', () => {
    expect(revisionsLabel(graph())).toBe('main (1234567) → abcdef0');
    expect(diffTitle(graph())).toBe('main (1234567) → abcdef0 — Symbiote');
  });

  it('names a branch review, then a pull or merge request, before the pair', () => {
    expect(diffTitle(graph(), 'feature/add-clamp')).toBe('Review of feature/add-clamp — Symbiote');
    const request = { forge: 'gitlab', number: 12, title: 'Add widgets' };
    expect(diffTitle(graph({ changeRequest: request }), 'x')).toBe('!12 Add widgets — Symbiote');
  });
});

describe('Nucleus (V35, NU1)', () => {
  it('opens at /nucleus, a page of the shell, titled Nucleus', () => {
    expect(routeOf('/nucleus', '')).toEqual({ route: { page: 'nucleus' } });
    expect(hrefOf({ page: 'nucleus' })).toBe('/nucleus');
    expect(inShell(new URL('http://symbiote/nucleus'))).toBe(true);
    expect(routeTitle({ page: 'nucleus' }, 'symbiote')).toBe('Nucleus · symbiote — Symbiote');
  });

  it("moves Scout's address, from before NU1, to Nucleus's", () => {
    expect(routeOf('/scout', '')).toEqual({ route: { page: 'nucleus' }, moved: '/nucleus' });
    expect(inShell(new URL('http://symbiote/scout'))).toBe(true);
  });
});

describe('Skills (V41)', () => {
  it('opens at /skills, a page of the shell, titled Skills', () => {
    expect(routeOf('/skills', '')).toEqual({ route: { page: 'skills' } });
    expect(routeOf('/skills', '?skill=.claude%2Fskills%2Fa%2FSKILL.md')).toEqual({
      route: { page: 'skills' },
    });
    expect(hrefOf({ page: 'skills' })).toBe('/skills');
    expect(inShell(new URL('http://symbiote/skills?new'))).toBe(true);
    expect(routeTitle({ page: 'skills' }, 'symbiote')).toBe('Skills · symbiote — Symbiote');
  });
});

describe('Monitor (RM1)', () => {
  it('opens at /monitor, a page of the shell, with the folder in view in ?path=', () => {
    expect(routeOf('/monitor', '')).toEqual({ route: { page: 'monitor' } });
    expect(routeOf('/monitor', '?path=packages%2Fviewer')).toEqual({
      route: { page: 'monitor', path: 'packages/viewer' },
    });
    expect(hrefOf({ page: 'monitor' })).toBe('/monitor');
    expect(hrefOf({ page: 'monitor', path: 'packages/viewer' })).toBe(
      '/monitor?path=packages%2Fviewer',
    );
    expect(inShell(new URL('http://symbiote/monitor?path=src'))).toBe(true);
    expect(routeTitle({ page: 'monitor' }, 'symbiote')).toBe('Monitor · symbiote — Symbiote');
    expect(routeTitle({ page: 'monitor', path: 'src' }, 'symbiote')).toBe(
      'src · Monitor · symbiote — Symbiote',
    );
  });
});

describe('History (V77)', () => {
  it('opens at /workspace-history, a page of the shell, with the workspace picked in ?branch=', () => {
    expect(routeOf('/workspace-history', '')).toEqual({ route: { page: 'workspace-history' } });
    expect(routeOf('/workspace-history', '?branch=feature%2Fcsv&brief')).toEqual({
      route: { page: 'workspace-history', branch: 'feature/csv' },
    });
    expect(hrefOf({ page: 'workspace-history' })).toBe('/workspace-history');
    expect(hrefOf({ page: 'workspace-history', branch: 'feature/csv' })).toBe(
      '/workspace-history?branch=feature%2Fcsv',
    );
    expect(inShell(new URL('http://symbiote/workspace-history?branch=x'))).toBe(true);
    expect(routeTitle({ page: 'workspace-history' }, 'symbiote')).toBe(
      'History · symbiote — Symbiote',
    );
    expect(
      routeTitle({ page: 'workspace-history', branch: 'feature/csv' }, 'symbiote', 'CSV export'),
    ).toBe('CSV export · History · symbiote — Symbiote');
    // History's old address stays Git's (V66).
    expect(routeOf('/history', '')).toEqual({ route: { page: 'git' }, moved: '/git' });
  });
});

describe("a diff's page (V60)", () => {
  it('reads Graph from the address; anything else is the default', () => {
    expect(diffView('?view=graph')).toBe('graph');
    expect(diffView('?graph=g.json&view=graph')).toBe('graph');
    expect(diffView('')).toBeNull();
    expect(diffView('?view=files')).toBeNull();
  });

  it('writes the page into the address, keeping the rest of it', () => {
    expect(withDiffView('http://x/diff/a..b/', 'graph')).toBe('http://x/diff/a..b/?view=graph');
    expect(withDiffView('http://x/diff/a..b/?view=graph', 'files')).toBe('http://x/diff/a..b/');
    expect(withDiffView('http://x/?graph=g.json#top', 'graph')).toBe(
      'http://x/?graph=g.json&view=graph#top',
    );
  });
});
