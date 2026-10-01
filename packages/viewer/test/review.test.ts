import { readFileSync } from 'node:fs';
import type { Graph } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { toFlow } from '../src/flow.js';
import {
  changeList,
  fingerprint,
  neighbourhood,
  reviewKey,
  reviewStatus,
  stepChange,
  toggleMark,
} from '../src/review.js';

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
  it('is per change request, else per pair of revisions', () => {
    const graph = golden('callers');
    expect(reviewKey(graph)).toBe('cpr:review:base..head');
    const request = { ...graph, changeRequest: { url: 'https://github.com/a/b/pull/7' } } as Graph;
    expect(reviewKey(request)).toBe('cpr:review:https://github.com/a/b/pull/7');
    expect(reviewKey(request, 'drafts')).toBe('cpr:drafts:https://github.com/a/b/pull/7');
  });
});

describe('review marks', () => {
  const graph = golden('callers');
  const add = 'src/math.ts#add';

  it('marks and unmarks changed symbols only', () => {
    const marks = toggleMark(graph, {}, add);
    expect(reviewStatus(graph, marks).reviewed).toEqual(new Set([add]));
    expect(toggleMark(graph, marks, add)).toEqual({});
    expect(toggleMark(graph, {}, 'src/app.ts#total')).toEqual({}); // context, not a change
  });

  it('flags symbols that changed since they were reviewed', () => {
    const marks = toggleMark(graph, {}, add);
    const pushed: Graph = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === add && n.head
          ? { ...n, head: { ...n.head, hashes: { ...n.head.hashes, body: 'new' } } }
          : n,
      ),
    };
    expect(reviewStatus(pushed, marks)).toEqual({ reviewed: new Set(), stale: new Set([add]) });
    // Reviewing it again records the new version.
    const again = toggleMark(pushed, marks, add);
    expect(again[add]).toBe(fingerprint(pushed.nodes.find((n) => n.id === add)!));
    expect(reviewStatus(pushed, again).reviewed).toEqual(new Set([add]));
  });

  it('forgets symbols that left the change', () => {
    const marks = { 'src/gone.ts#x': 'a|b' };
    expect(Object.keys(toggleMark(graph, marks, add))).toEqual([add]);
  });
});

describe('since an earlier version', () => {
  const graph = golden('callers');
  const add = 'src/math.ts#add';
  const since: Graph = {
    ...graph,
    since: { ref: 'v1', sha: 'abc', dropped: [] },
    nodes: graph.nodes.map((n) =>
      n.status === 'unchanged' ? n : { ...n, since: n.id === add ? 'updated' : 'same' },
    ),
  };

  it('can leave out symbols changed the same way as before', () => {
    const ids = (list: ReturnType<typeof changeList>) =>
      list.flatMap((f) => f.symbols.map((s) => s.id));
    expect(ids(changeList(since, { sinceOnly: true }))).toEqual([add]);
    expect(ids(changeList(since))).toEqual(ids(changeList(graph)));
  });

  it('dims them on the canvas', () => {
    const settled = (options: Parameters<typeof toFlow>[1]) =>
      toFlow(since, options)
        .nodes.filter((n) => n.type === 'symbol' && n.data.settled)
        .map((n) => n.id);
    expect(settled({ sinceOnly: false })).toEqual([]);
    expect(settled({ sinceOnly: true })).not.toContain(add);
    expect(settled({ sinceOnly: true }).length).toBeGreaterThan(0);
  });
});
