import { readdirSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SpinIcon } from '../src/ui/icons.js';
import { Loading } from '../src/ui/Loading.js';
import { StatusLabel } from '../src/ui/StatusLabel.js';

// fix/static-loadings: whatever is under way moves. Until this fix the loader arc turned only in
// a sidenav row (`.sidenav .ws-row-icon.spinning`): a pipeline's step at work, a merge's steps,
// every "run" status label and the review page's bar stood still, and 26 loading lines were
// words alone.
const SRC = new URL('../src/', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, SRC), 'utf8');
const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).map((file) =>
  file.replaceAll('\\', '/'),
);
const css = files
  .filter((file) => file.endsWith('.css'))
  .map(read)
  .join('\n');

/** The declarations of every rule whose selector list has `selector`, outside or inside `@media`. */
function rules(text: string, selector: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!.split(',').map((s) => s.trim());
    if (selectors.includes(selector)) out.push(match[2]!);
  }
  return out;
}

/** The text of every `@media (prefers-reduced-motion: reduce)` block. */
const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/g)]
  .map((match) => {
    let depth = 0;
    const start = match.index + match[0].length;
    for (let i = start; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}') {
        if (depth === 0) return css.slice(start, i);
        depth--;
      }
    }
    return '';
  })
  .join('\n');
const outside = css.replace(
  /@media \(prefers-reduced-motion: reduce\) \{(?:[^{}]*\{[^{}]*\})*\s*\}/g,
  '',
);

/** Whether `selector` moves, and holds still without motion. */
function moves(selector: string) {
  return {
    moves: rules(outside, selector).some((body) => /animation:\s*[a-z-]+ /.test(body)),
    stillWithoutMotion: rules(reduced, selector).some((body) => /animation:\s*none/.test(body)),
  };
}

describe('the loader arc', () => {
  it('turns wherever it is drawn, not only in a sidenav row', () => {
    expect(renderToStaticMarkup(createElement(SpinIcon))).toMatch(/^<svg class="icon lucide spin"/);
    expect(moves('.icon.spin')).toEqual({ moves: true, stillWithoutMotion: true });
  });

  it('is a run status label’s icon: in progress, it turns', () => {
    const html = renderToStaticMarkup(
      createElement(StatusLabel, { tone: 'run', children: 'Analyzing' }),
    );
    expect(html).toContain('<svg class="icon lucide spin"');
  });
});

describe('a loading line', () => {
  it('is the turning arc and its words, said to a screen reader', () => {
    expect(
      renderToStaticMarkup(createElement(Loading, { className: 'hint', children: 'Reading…' })),
    ).toMatch(
      /^<p class="loading hint" role="status"><svg class="icon lucide spin"[^]*<\/svg>Reading…<\/p>$/,
    );
  });

  it('inline, in a busy button or a list’s empty place: a span, no live region of its own', () => {
    expect(
      renderToStaticMarkup(createElement(Loading, { inline: true, children: 'Working…' })),
    ).toMatch(/^<span class="loading"><svg class="icon lucide spin"[^]*<\/svg>Working…<\/span>$/);
  });

  // A phrase of something under way: "Reading the diff…", "Starting {name}…", "Working…".
  const UNDER_WAY = /\b[A-Z][a-z]+ing\b(?:[^'"`<>{}\n]|\{[^}\n]*\})*…/g;

  it('is never words alone: every "…ing…" the pages draw is in a Loading', () => {
    const bare = files
      .filter((file) => file.endsWith('.tsx'))
      .flatMap((file) => {
        const text = read(file);
        return [...text.matchAll(UNDER_WAY)]
          .filter((match) => {
            const line = text.slice(text.lastIndexOf('\n', match.index) + 1, match.index).trim();
            if (/^(\/\/|\*|\/\*|\{\/\*)/.test(line)) return false;
            return (
              text.lastIndexOf('<Loading', match.index) <=
              text.lastIndexOf('</Loading>', match.index)
            );
          })
          .map((match) => `${file}: ${match[0]}`);
      });
    expect(bare).toEqual([]);
  });
});

describe('what else waits', () => {
  it('the review page’s bar: its running step sweeps, still without motion', () => {
    expect(moves('.opening-segment.mark-running::after')).toEqual({
      moves: true,
      stillWithoutMotion: true,
    });
  });

  it('the workspaces’ first read: its outlines pulse, still without motion', () => {
    expect(moves('.skeleton-card span')).toEqual({ moves: true, stillWithoutMotion: true });
  });
});
