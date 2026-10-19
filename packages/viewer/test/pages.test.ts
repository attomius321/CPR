import { describe, expect, it } from 'vitest';
import { backLink, pageOfPath } from '../src/pages.js';

describe('pageOfPath (V25)', () => {
  it('opens Workspaces at the root, History at /history', () => {
    expect(pageOfPath('/')).toEqual({ page: 'workspaces' });
    expect(pageOfPath('/history')).toEqual({ page: 'history' });
  });

  it('moves the old addresses of Workspaces to the root', () => {
    expect(pageOfPath('/workspaces')).toEqual({ page: 'workspaces', moved: '/' });
    expect(pageOfPath('/features')).toEqual({ page: 'workspaces', moved: '/' });
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
      label: 'Workspaces',
    });
    expect(backLink(`${origin}/workspaces?branch=a`, origin)).toEqual({
      href: '/?branch=a',
      label: 'Workspaces',
    });
  });

  it('goes to History when it does not know: a bookmark, another site, another diff', () => {
    const history = { href: '/history', label: 'History' };
    expect(backLink('', origin)).toEqual(history);
    expect(backLink('https://github.com/acme/widgets/pull/7', origin)).toEqual(history);
    expect(backLink(`${origin}/diff/a..b/`, origin)).toEqual(history);
    expect(backLink('not a url', origin)).toEqual(history);
  });
});
