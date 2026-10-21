import type { Graph } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import {
  backLink,
  diffTitle,
  hrefOf,
  pageTitle,
  revisionsLabel,
  routeOf,
  routeTitle,
} from '../src/pages.js';

describe('routeOf (V29a: no Workspaces page)', () => {
  it('opens History and Settings at their addresses', () => {
    expect(routeOf('/history', '')).toEqual({ route: { page: 'history' } });
    expect(routeOf('/history', '?branch=wip')).toEqual({ route: { page: 'history' } });
    expect(routeOf('/settings', '')).toEqual({ route: { page: 'settings' } });
  });

  it('opens a workspace at /?branch=, the address CPR has given out since V25', () => {
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

  it('opens a merge at /?merge=', () => {
    expect(routeOf('/', '?merge=fix%2Fy')).toEqual({ route: { page: 'merge', branch: 'fix/y' } });
  });

  it('opens History at the root alone, shown at its own address', () => {
    expect(routeOf('/', '')).toEqual({ route: { page: 'history' }, moved: '/history' });
    expect(routeOf('/', '?branch=')).toEqual({ route: { page: 'history' }, moved: '/history' });
  });

  it("moves the old addresses of Workspaces: a workspace to today's, the rest to History", () => {
    for (const old of ['/workspaces', '/features']) {
      expect(routeOf(old, '?branch=feature%2Fx&thread')).toEqual({
        route: { page: 'workspace', branch: 'feature/x' },
        moved: '/?branch=feature%2Fx&thread',
      });
      expect(routeOf(old, '')).toEqual({ route: { page: 'history' }, moved: '/history' });
    }
  });
});

describe('hrefOf', () => {
  it('gives each route its address, the one routeOf reads', () => {
    expect(hrefOf({ page: 'history' })).toBe('/history');
    expect(hrefOf({ page: 'settings' })).toBe('/settings');
    expect(hrefOf({ page: 'workspace', branch: 'feature/x' })).toBe('/?branch=feature%2Fx');
    expect(hrefOf({ page: 'merge', branch: 'fix/y' })).toBe('/?merge=fix%2Fy');
    for (const route of [
      { page: 'workspace', branch: 'a b/c' },
      { page: 'merge', branch: 'chore/z' },
    ] as const) {
      const url = new URL(hrefOf(route), 'http://cpr');
      expect(routeOf(url.pathname, url.search)).toEqual({ route });
    }
  });
});

describe('backLink (V25)', () => {
  const origin = 'http://127.0.0.1:4000';

  it('goes back to the page a diff was opened from, with its address', () => {
    expect(backLink(`${origin}/history?scope=current`, origin)).toEqual({
      href: '/history?scope=current',
      label: 'History',
    });
    expect(backLink(`${origin}/?branch=feature%2Fx`, origin)).toEqual({
      href: '/?branch=feature%2Fx',
      label: 'Workspace',
    });
    expect(backLink(`${origin}/workspaces?branch=a`, origin)).toEqual({
      href: '/?branch=a',
      label: 'Workspace',
    });
  });

  it('goes to History when it does not know: a bookmark, another site, another diff', () => {
    const history = { href: '/history', label: 'History' };
    expect(backLink('', origin)).toEqual(history);
    expect(backLink(`${origin}/`, origin)).toEqual(history);
    expect(backLink('https://github.com/acme/widgets/pull/7', origin)).toEqual(history);
    expect(backLink(`${origin}/diff/a..b/`, origin)).toEqual(history);
    expect(backLink('not a url', origin)).toEqual(history);
  });
});

describe('pageTitle and routeTitle (N1a: the window names its page)', () => {
  it('names the page, then the repository, then CPR', () => {
    expect(routeTitle({ page: 'history' }, 'ky')).toBe('History · ky — CPR');
    expect(routeTitle({ page: 'settings' }, 'ky')).toBe('Settings · ky — CPR');
    expect(routeTitle({ page: 'workspace', branch: 'feature/add-clamp' }, 'ky', 'Add clamp')).toBe(
      'Add clamp · ky — CPR',
    );
    expect(routeTitle({ page: 'workspace', branch: 'feature/add-clamp' }, 'ky')).toBe(
      'feature/add-clamp · ky — CPR',
    );
    expect(routeTitle({ page: 'merge', branch: 'fix/x' }, undefined)).toBe('Merge fix/x — CPR');
  });

  it('leaves out what is not known', () => {
    expect(pageTitle()).toBe('CPR');
    expect(pageTitle(undefined, '')).toBe('CPR');
    expect(pageTitle('main → feature')).toBe('main → feature — CPR');
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
    expect(diffTitle(graph())).toBe('main (1234567) → abcdef0 — CPR');
  });

  it('names a branch review, then a pull or merge request, before the pair', () => {
    expect(diffTitle(graph(), 'feature/add-clamp')).toBe('Review of feature/add-clamp — CPR');
    const request = { forge: 'gitlab', number: 12, title: 'Add widgets' };
    expect(diffTitle(graph({ changeRequest: request }), 'x')).toBe('!12 Add widgets — CPR');
  });
});
