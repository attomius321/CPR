import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StageTrack, HIVE_STAGES, NORMAL_STAGES } from '../src/ui/StageTrack.js';
import { StatusLabel } from '../src/ui/StatusLabel.js';

// V88 (decisions 817, 818): the redesign's shared parts, as the kits draw them.
describe('StatusLabel (V88)', () => {
  it('is an icon and a word, tinted by its tone: never colour alone', () => {
    const html = renderToStaticMarkup(
      createElement(StatusLabel, { tone: 'run', children: 'Checking 2/4' }),
    );
    expect(html).toMatch(/^<span class="status-label" data-tone="run"><svg class="icon[^"]*"/);
    expect(html).toContain('<span class="status-word">Checking 2/4</span>');
  });

  it('has an icon of its own for each tone, or the one given', () => {
    const icons = (['run', 'ok', 'error', 'info', 'idle', 'you', 'hive', 'warning'] as const).map(
      (tone) =>
        renderToStaticMarkup(createElement(StatusLabel, { tone, children: 'x' })).replace(
          /^.*?<svg/,
          '<svg',
        ),
    );
    expect(new Set(icons).size).toBe(icons.length);
    const given = renderToStaticMarkup(
      createElement(StatusLabel, {
        tone: 'ok',
        icon: createElement('i'),
        className: 'history-outcome',
        children: 'Merged',
      }),
    );
    expect(given).toBe(
      '<span class="status-label history-outcome" data-tone="ok"><i></i><span class="status-word">Merged</span></span>',
    );
  });
});

describe('StageTrack (V88)', () => {
  it("names Hive's four steps and normal mode's five", () => {
    expect(HIVE_STAGES).toEqual(['Write', 'Check', 'Review', 'Land']);
    expect(NORMAL_STAGES).toEqual(['Plan', 'Your OK', 'Build', 'Review', 'Merge']);
  });

  it('draws a hexagon a step, joined by lines, done ones green-linked, and says it in words', () => {
    const html = renderToStaticMarkup(
      createElement(StageTrack, { steps: HIVE_STAGES, at: 1, state: 'now' }),
    );
    expect(html.match(/<svg class="stage-hex/g)).toHaveLength(4);
    expect(html.match(/class="stage-link/g)).toHaveLength(3);
    expect(html).toContain('class="stage-hex done"');
    expect(html).toContain('class="stage-hex now"');
    expect(html.match(/class="stage-hex todo"/g)).toHaveLength(2);
    expect(html).toContain('class="stage-link done"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Write done, Check now, Review and Land to come"');
  });

  it('marks the step that failed, and all done once landed', () => {
    const bad = renderToStaticMarkup(
      createElement(StageTrack, { steps: HIVE_STAGES, at: 1, state: 'bad' }),
    );
    expect(bad).toContain('class="stage-hex bad"');
    expect(bad).toContain('Check failed');
    const landed = renderToStaticMarkup(
      createElement(StageTrack, { steps: NORMAL_STAGES, at: 5, state: 'now' }),
    );
    expect(landed.match(/class="stage-hex done"/g)).toHaveLength(5);
    expect(landed).toContain('aria-label="Plan, Your OK, Build, Review and Merge done"');
  });
});
