import { readFileSync } from 'node:fs';
import type { ChangedLines, Graph } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import {
  findingMarker,
  findingsReview,
  planFindings,
  postedMarkers,
} from '../src/post-findings.js';

// The detectors fixture: Canvas.clear removed but still used (error), perimeter and tools new
// and unused (warnings), volume new public API and Shape changed compatibly (info).
const graph = JSON.parse(
  readFileSync(
    new URL('../../core/test/__snapshots__/graph-detectors.json', import.meta.url),
    'utf8',
  ),
) as Graph;
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const lines: ChangedLines = {
  base: new Map([['src/shapes.ts', [14, 15]]]),
  head: new Map([['src/shapes.ts', [4, ...range(11, 18), ...range(28, 35)]]]),
};
const finding = (rule: string, name: string) =>
  graph.findings.find((f) => f.rule === rule && f.symbol === `src/shapes.ts#${name}`)!;

describe('planFindings', () => {
  it('anchors findings on the first changed line of their symbol', () => {
    const plan = planFindings(graph, lines, 'info', new Set());
    expect(
      plan.inline.map(({ finding, anchor }) => [finding.symbol, anchor.side, anchor.line]),
    ).toEqual([
      ['src/shapes.ts#Canvas.clear', 'base', 15],
      ['src/shapes.ts#perimeter', 'head', 11],
      ['src/shapes.ts#tools', 'head', 35],
      ['src/shapes.ts#volume', 'head', 15],
      ['src/shapes.ts#Shape', 'head', 4],
    ]);
    expect(plan.summary).toEqual([]);
  });

  it('keeps to the level and skips what was posted before', () => {
    const posted = postedMarkers([`Earlier\n\n${findingMarker(finding('orphan-added', 'tools'))}`]);
    const plan = planFindings(graph, lines, 'warning', posted);
    expect(plan.inline.map((i) => i.finding.id)).toEqual(['f1', 'f2']);
    expect(plan.skipped.map((f) => f.id)).toEqual(['f3']);
  });

  it('puts findings without a changed line into the summary', () => {
    const plan = planFindings(graph, { base: new Map(), head: lines.head }, 'error', new Set());
    expect(plan.inline).toEqual([]);
    expect(plan.summary.map((f) => f.id)).toEqual(['f1']);
  });
});

describe('findingsReview', () => {
  const plan = planFindings(graph, lines, 'warning', new Set());

  it('comments inline with a marker, and sums up', () => {
    const review = findingsReview(plan);
    expect(review.event).toBe('comment');
    expect(review.body).toBe('**CPR** · 3 new findings (1 error, 2 warnings)');
    expect(review.comments[0]).toEqual({
      side: 'base',
      path: 'src/shapes.ts',
      otherPath: 'src/shapes.ts',
      line: 15,
      body:
        '**✖ error · removed-still-referenced**\n\n' +
        'Canvas.clear was removed but is still used by 1 symbol: render\n\n' +
        '<!-- cpr:finding removed%2Dstill%2Dreferenced%3Asrc%2Fshapes.ts%23Canvas.clear -->',
    });
    expect(postedMarkers(review.comments.map((c) => c.body)).size).toBe(3);
  });

  it('lists everything in the summary when inline comments are refused', () => {
    const review = findingsReview(plan, { inline: false });
    expect(review.comments).toEqual([]);
    const items = review.body.split('\n').filter((l) => l.startsWith('- '));
    expect(items).toHaveLength(3);
    expect(items[1]).toBe(
      '- ⚠ **orphan-added** `src/shapes.ts#perimeter`: perimeter is new and nothing references it ' +
        findingMarker(finding('orphan-added', 'perimeter')),
    );
    expect(postedMarkers([review.body]).size).toBe(3);
  });
});
