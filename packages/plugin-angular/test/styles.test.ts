import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeDirectories, createAdapter, type Analysis, type TsPlugin } from '@symbiote/core';
import angular from '../src/index.js';

const fixture = (side: 'base' | 'head') =>
  fileURLToPath(new URL(`./fixtures/styles/${side}`, import.meta.url));
const analyze = (plugins: TsPlugin[]) =>
  analyzeDirectories(fixture('base'), fixture('head'), { adapter: createAdapter({ plugins }) });

/** Edges that end at a stylesheet rule. */
const styleEdges = (analysis: Analysis) =>
  analysis.edges
    .filter((e) => /\.s?css#/.test(e.to))
    .map((e) => `${e.from} -${e.kind}-> ${e.to}${e.possible ? ' (possible)' : ''}`)
    .sort();

describe('the angular plugin and stylesheets', () => {
  it("links templates to the rules they reach: a component's own styles from it only", async () => {
    expect(styleEdges(await analyze([angular]))).toEqual([
      'src/app/card.component.html#(template) -reference-> src/app/_shared.scss#.chip',
      'src/app/card.component.html#(template) -reference-> src/app/card.component.scss#.active',
      'src/app/card.component.html#(template) -reference-> src/app/card.component.scss#.badge',
      'src/app/card.component.html#(template) -reference-> src/app/card.component.scss#.title',
      'src/app/card.component.html#(template) -reference-> src/app/raw.component.css#.chip',
      'src/app/card.component.html#(template) -reference-> src/styles.scss#.title',
      'src/app/card.component.ts#CardComponent -reference-> src/app/card.component.scss#.open',
      'src/app/list.component.html#(template) -reference-> src/app/raw.component.css#.chip',
      'src/app/list.component.html#(template) -reference-> src/styles.scss#.title',
      'src/app/raw.component.ts#RawComponent.(template) -reference-> src/app/raw.component.css#.chip',
    ]);
  });

  it('reads no template without the plugin', async () => {
    const analysis = await analyze([]);
    expect(styleEdges(analysis)).toEqual([]);
    expect(analysis.changes.filter((c) => c.status !== 'unchanged')).toHaveLength(7);
  });
});
