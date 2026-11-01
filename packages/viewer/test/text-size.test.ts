import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEXT_SIZE_KEY, TEXT_SIZES, textSizeOf } from '../src/shell/text-size.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** The page's inline script: what runs before the stylesheet and the first paint. */
const inline = (() => {
  const scripts = [...html.matchAll(/<script(?<attributes>[^>]*)>(?<code>[\s\S]*?)<\/script>/g)];
  const found = scripts.find((s) => !s.groups?.attributes?.includes('src'));
  return found?.groups?.code ?? '';
})();

/** Runs the inline script with `stored` as the kept text size: what it sets on <html>. */
function beforePaint(stored: string | null | Error): Record<string, string> {
  const root = { dataset: {} as Record<string, string> };
  const storage = {
    getItem(key: string) {
      if (stored instanceof Error) throw stored;
      return key === TEXT_SIZE_KEY ? stored : null;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('document', 'localStorage', 'window', inline) as (
    document: unknown,
    localStorage: unknown,
    window: unknown,
  ) => void;
  run({ documentElement: root }, storage, {});
  return root.dataset;
}

// V87c (decision 763): Settings' text size, kept in this browser as the theme is.
describe('the text size (V87c)', () => {
  it('is the default unless the person chose compact or large', () => {
    expect(textSizeOf(null)).toBe('default');
    expect(textSizeOf('default')).toBe('default');
    expect(textSizeOf('compact')).toBe('compact');
    expect(textSizeOf('large')).toBe('large');
    expect(textSizeOf('huge')).toBe('default');
  });

  it('offers compact, the default and large, in that order', () => {
    expect(TEXT_SIZES).toEqual(['compact', 'default', 'large']);
  });

  it('is set on <html> before the first paint; the default sets nothing', () => {
    expect(inline).toContain(TEXT_SIZE_KEY);
    expect(beforePaint('compact').textSize).toBe('compact');
    expect(beforePaint('large').textSize).toBe('large');
    for (const stored of [null, 'default', 'huge']) {
      expect(beforePaint(stored).textSize).toBeUndefined();
    }
  });

  it('is the default where the browser blocks storage', () => {
    expect(beforePaint(new Error('SecurityError')).textSize).toBeUndefined();
  });
});
