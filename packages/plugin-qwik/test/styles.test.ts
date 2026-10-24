import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeDirectories, createAdapter, type TsPlugin } from '@symbiote/core';
import qwik from '../src/index.js';

const fixture = (side: 'base' | 'head') =>
  fileURLToPath(new URL(`./fixtures/qwik-styles/${side}`, import.meta.url));
const styleEdges = async (plugins: TsPlugin[]) =>
  (
    await analyzeDirectories(fixture('base'), fixture('head'), {
      adapter: createAdapter({ plugins }),
    })
  ).edges
    .filter((e) => /\.css#/.test(e.to))
    .map((e) => `${e.from} -> ${e.to}`)
    .sort();

describe('the qwik plugin and stylesheets', () => {
  it('keeps useStylesScoped$ styles to the component calling it; useStyles$ ones are global', async () => {
    expect(await styleEdges([qwik])).toEqual([
      'src/components/card.tsx#Badge -> src/components/shared.css#.chip',
      'src/components/card.tsx#Card -> src/components/card.css#.title',
      'src/components/card.tsx#Card -> src/components/shared.css#.chip',
    ]);
  });

  it('without the plugin, every stylesheet is global', async () => {
    expect(await styleEdges([])).toEqual([
      'src/components/card.tsx#Badge -> src/components/card.css#.title',
      'src/components/card.tsx#Badge -> src/components/shared.css#.chip',
      'src/components/card.tsx#Card -> src/components/card.css#.title',
      'src/components/card.tsx#Card -> src/components/shared.css#.chip',
    ]);
  });
});
