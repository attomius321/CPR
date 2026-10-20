import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_KEY, themeOf } from '../src/theme.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** The page's inline script: what runs before the stylesheet and the first paint. */
const inline = (() => {
  const scripts = [...html.matchAll(/<script(?<attributes>[^>]*)>(?<code>[\s\S]*?)<\/script>/g)];
  const found = scripts.find((s) => !s.groups?.attributes?.includes('src'));
  return found?.groups?.code ?? '';
})();

/** Runs the inline script with `stored` in the browser's storage: the theme it sets. */
function themeBeforePaint(stored: string | null | Error): string | undefined {
  const root = { dataset: {} as Record<string, string> };
  const storage = {
    getItem(key: string) {
      if (stored instanceof Error) throw stored;
      return key === THEME_KEY ? stored : null;
    },
  };
  // The page's own script, run as a browser runs it, with these two in its scope.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('document', 'localStorage', inline) as (
    document: unknown,
    localStorage: unknown,
  ) => void;
  run({ documentElement: root }, storage);
  return root.dataset.theme;
}

describe('the theme (V29b, decision 179)', () => {
  it('is dark unless the person chose light or the system', () => {
    expect(themeOf(null)).toBe('dark');
    expect(themeOf('dark')).toBe('dark');
    expect(themeOf('light')).toBe('light');
    expect(themeOf('system')).toBe('system');
    expect(themeOf('blue')).toBe('dark');
  });

  it('is set on <html> by a script in the page, before the stylesheet and the first paint', () => {
    expect(inline).toContain(THEME_KEY);
    expect(html.indexOf(inline)).toBeLessThan(html.indexOf('type="module"'));
    for (const stored of [null, 'dark', 'light', 'system', 'blue']) {
      expect(themeBeforePaint(stored)).toBe(themeOf(stored));
    }
  });

  it('is dark where the browser blocks storage', () => {
    expect(themeBeforePaint(new Error('SecurityError'))).toBe('dark');
  });
});
