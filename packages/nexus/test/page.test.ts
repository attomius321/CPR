import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The page's guards (NX1b, decision 523): it is drawn in the viewer's classes, so they must still be
// the viewer's; its own sizes are the viewer's tokens; it runs in a browser.
const nexus = fileURLToPath(new URL('..', import.meta.url));
const viewerSrc = fileURLToPath(new URL('../../viewer/src', import.meta.url));

function cssUnder(dir: string): string {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
}

/** The viewer's classes the page's markup takes its look from. */
const VIEWER_CLASSES = [
  'workspace-views',
  'selected',
  'shell-tab',
  'shell-close',
  'count',
  'page-head',
  'page-icon',
  'page-title',
  'page-name-line',
  'page-line',
  'symbiote-mark',
  'icon',
  'lucide',
  'icon-button',
  'window-buttons',
  'window-close',
  'button',
  'secondary',
  'error',
];

describe("the nexus page's look", () => {
  const page = readFileSync(join(nexus, 'src/page/main.ts'), 'utf8');
  const viewer = cssUnder(viewerSrc);

  it("uses classes the viewer's stylesheet still has", () => {
    for (const name of VIEWER_CLASSES) {
      expect(viewer, name).toMatch(new RegExp(`\\.${name}(?![\\w-])`));
      expect(page, name).toMatch(new RegExp(`['\`\\s]${name}['\`\\s]`));
    }
  });

  it("sizes its text with the viewer's tokens, never a px value", () => {
    const css = readFileSync(join(nexus, 'page/nexus.css'), 'utf8');
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1]);
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toMatch(/^var\(--size-[a-z]+\)$/);
    // Fonts are the viewer's (Geist): the nexus names none.
    expect(css).not.toMatch(/font-family|font:/);
  });

  it("imports nothing of Node's in the page's scripts: they run in the browser", () => {
    for (const name of readdirSync(join(nexus, 'src/page'))) {
      const text = readFileSync(join(nexus, 'src/page', name), 'utf8');
      const runtime = [...text.matchAll(/^import (?!type )[^;]*from '([^']+)'/gm)].map((m) => m[1]);
      for (const from of runtime) expect(from, `${name}: ${from}`).toMatch(/^\.\/[\w-]+\.js$/);
    }
  });
});
