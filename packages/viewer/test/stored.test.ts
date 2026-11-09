import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStored, writeStored } from '../src/ui/stored.js';

/** This browser's storage holding `items`. */
function storage(items: Map<string, string>): void {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('a choice kept in this browser', () => {
  it('reads what was written, and nothing for a key never written', () => {
    const items = new Map<string, string>();
    storage(items);
    expect(readStored('symbiote.viewer.sidenav')).toBeNull();
    writeStored('symbiote.viewer.sidenav', 'rail');
    expect(items.get('symbiote.viewer.sidenav')).toBe('rail');
    expect(readStored('symbiote.viewer.sidenav')).toBe('rail');
  });

  it('reads nothing and keeps nothing where the browser blocks storage', () => {
    // Chromium throws on reading `window.localStorage` itself when site data is blocked.
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError');
      },
    });
    expect(readStored('symbiote.viewer.sidenav')).toBeNull();
    expect(() => writeStored('symbiote.viewer.sidenav', 'rail')).not.toThrow();
  });

  it('reads nothing outside a browser', () => {
    expect(readStored('symbiote.viewer.sidenav')).toBeNull();
    expect(() => writeStored('symbiote.viewer.sidenav', 'rail')).not.toThrow();
  });
});
