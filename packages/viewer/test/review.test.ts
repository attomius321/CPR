import { readFileSync } from 'node:fs';
import type { Graph } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { toFlow } from '../src/flow.js';
import { changeList, neighbourhood, reviewKey, stepChange } from '../src/review.js';

const golden = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../core/test/__snapshots__/graph-${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as Graph;

describe('changeList', () => {
  it('orders changed symbols by file and position', () => {
    const list = changeList(golden('service'));
    expect(list.map((f) => [f.file, f.symbols.map((s) => s.name)])).toEqual([
      ['src/text/slug.ts', ['slugify', 'titleCase']],
      ['src/user.ts', ['User', 'findUser', 'formatUser', 'normalizeId', 'greet']],
    ]);
  });
});

describe('stepChange', () => {
  const list = changeList(golden('callers'));
  const ids = list.flatMap((f) => f.symbols.map((s) => s.id));

  it('starts at the first or last change', () => {
    expect(stepChange(list, null, 1)).toBe(ids[0]);
    expect(stepChange(list, null, -1)).toBe(ids[ids.length - 1]);
  });

  it('moves and wraps around', () => {
    expect(stepChange(list, ids[0] ?? null, 1)).toBe(ids[1]);
    expect(stepChange(list, ids[0] ?? null, -1)).toBe(ids[ids.length - 1]);
  });

  it('starts over from a context symbol', () => {
    expect(stepChange(list, 'src/app.ts#total', 1)).toBe(ids[0]);
  });
});

describe('neighbourhood', () => {
  it('collects symbols within a number of hops', () => {
    const graph = golden('callers');
    expect([...neighbourhood(graph, 'src/math.ts#legacy')].sort()).toEqual([
      'src/app.ts#old',
      'src/math.ts#add',
      'src/math.ts#legacy',
    ]);
    expect(neighbourhood(graph, 'src/math.ts#legacy', 2).has('src/app.ts#total')).toBe(true);
  });

  it('limits the flow to the focus set', () => {
    const graph = golden('callers');
    const { nodes } = toFlow(graph, { focus: neighbourhood(graph, 'src/math.ts#legacy') });
    expect(
      nodes
        .filter((n) => n.type === 'symbol')
        .map((n) => n.id)
        .sort(),
    ).toEqual(['src/app.ts#old', 'src/math.ts#add', 'src/math.ts#legacy']);
  });
});

describe('reviewKey', () => {
  it('is specific to the compared revisions', () => {
    expect(reviewKey(golden('callers'))).toBe('cpr:reviewed:base..head');
  });
});
