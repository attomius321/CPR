import { readFileSync } from 'node:fs';
import type { ChangedLines, Graph } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { codeQualityReport } from '../src/codequality.js';

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

describe('codeQualityReport', () => {
  const report = codeQualityReport(graph, lines);

  it('points each finding at a line of the head version', () => {
    expect(
      report.map((i) => [i.check_name, i.severity, i.location.path, i.location.lines.begin]),
    ).toEqual([
      // Canvas.clear is gone: where render still calls it.
      ['removed-still-referenced', 'critical', 'src/app.ts', 5],
      ['orphan-added', 'major', 'src/shapes.ts', 11],
      ['orphan-added', 'major', 'src/shapes.ts', 35],
      ['orphan-added', 'info', 'src/shapes.ts', 15],
      ['signature-changed', 'info', 'src/shapes.ts', 4],
    ]);
    expect(report[0]?.description).toBe(
      'Canvas.clear was removed but is still used by 1 symbol: render',
    );
  });

  it('fingerprints by rule and symbol, so the next run matches', () => {
    expect(report[0]?.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(report.map((i) => i.fingerprint)).size).toBe(report.length);
    expect(codeQualityReport(graph, { base: new Map(), head: new Map() })[0]?.fingerprint).toBe(
      report[0]?.fingerprint,
    );
  });
});
