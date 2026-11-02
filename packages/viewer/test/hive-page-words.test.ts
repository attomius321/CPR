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

// HV8: with the setting at its default, the merge queue, the page's warning says what main's says.
describe("Settings' Hive page, Hive landing through the merge queue (the default, HV8)", () => {
  it("the warning's sentences read as on main: the landing's, then turning Hive off", () => {
    const words = wordsOf(renderToStaticMarkup(createElement(HivePage, { onBack: () => {} })));
    expect(words).toContain(
      'in your place. Then Hive approves the commit, merges it into the branch the workspace started from through the merge queue, which checks the merge again, and pushes both branches. A conflict goes back to the agent. Turning Hive off stops',
    );
  });
});
