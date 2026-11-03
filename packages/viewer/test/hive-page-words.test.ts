import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Settings' Hive page as it first renders: Hive off, the setting not read yet (the merge queue).
vi.mock('../src/shell/hive.js', () => ({ useHive: () => false, setHive: () => undefined }));

const { HivePage } = await import('../src/settings/HivePage.js');

/** The page's words, as a person reads them: no tags, entities as their characters. */
function wordsOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

// V92 (decision 870): off, the page says what Hive does, then its settings as grouped rows.
describe("Settings' Hive mode page, Hive off (V92)", () => {
  const words = wordsOf(
    renderToStaticMarkup(createElement(HivePage, { onBack: () => {}, onChecks: () => {} })),
  );

  it('says what Hive does, and how to start', () => {
    expect(words).toContain(
      'Hive drives every workspace you start, from its brief to landed. Your agents write, Symbiote runs the check, a reviewer proves defects with failing tests, and Hive merges and pushes. No step waits for you. Set it up below, then turn it on.',
    );
    expect(words).toContain('Turn on Hive mode');
  });

  it('groups its rows: Landing, Limits, Running reviewer, each a name and its help', () => {
    const at = (text: string) => words.indexOf(text);
    for (const text of [
      'Landing',
      'Lands through',
      'Into the branch the workspace started from; both branches are pushed.',
      'The check',
      'Rounds',
      'Limits',
      'Pause by usage',
      'Budget per workspace',
      'Running reviewer',
      'Model and effort',
    ]) {
      expect(at(text), text).toBeGreaterThan(-1);
    }
    expect(at('Landing')).toBeLessThan(at('Limits'));
    expect(at('Limits')).toBeLessThan(at('Running reviewer'));
  });
});
