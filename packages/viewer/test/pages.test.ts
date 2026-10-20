import { describe, expect, it } from 'vitest';
import { backLink, hrefOf, routeOf } from '../src/pages.js';

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
