import { readFileSync } from 'node:fs';
import type { Graph, GraphNode } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { toFlow } from '../src/flow.js';
import {
  byProject,
  changeList,
  filterChanges,
  fingerprint,
  neighbourhood,
  nextProject,
  onlyProject,
  projectNeighbourhood,
  reviewKey,
  reviewStatus,
  stepChange,
  toggleMark,
  withoutCollapsed,
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

describe('filterChanges', () => {
  const names = (list: ReturnType<typeof changeList>) =>
    list.map((f) => [f.file, f.symbols.map((s) => s.name)]);
  const list = changeList(golden('service'));

  it('keeps the symbols whose name or file holds every word, ignoring case', () => {
    expect(names(filterChanges(list, 'USER'))).toEqual([
      ['src/user.ts', ['User', 'findUser', 'formatUser', 'normalizeId', 'greet']],
    ]);
    expect(names(filterChanges(list, 'case'))).toEqual([['src/text/slug.ts', ['titleCase']]]);
    expect(names(filterChanges(list, ' user.ts  find '))).toEqual([['src/user.ts', ['findUser']]]);
    expect(filterChanges(list, 'nothing-like-it')).toEqual([]);
  });

  it('keeps everything when there is nothing to search for', () => {
    expect(filterChanges(list, '  ')).toBe(list);
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

/** A monorepo change: `files` as `path:name` (a changed function each), projects by folder. */
function monorepo(files: string[], folders: string[]): Graph {
  return {
    ...golden('projects'),
    nodes: files.map((spec): GraphNode => {
      const [file = '', name = ''] = spec.split(':');
      return {
        id: `${file}#${name}`,
        kind: 'function',
        name,
        container: null,
        language: 'typescript',
        exported: true,
        status: 'modified',
        previousId: null,
        base: null,
        head: null,
      };
    }),
    edges: [],
    findings: [],
    projects: folders.map((folder) => ({
      folder,
      name: folder === '' ? 'repository root' : (folder.split('/').pop() ?? folder),
      source: folder === '' ? 'root' : 'workspace',
    })),
  };
}

describe('the change list by project', () => {
  // A nested project (`apps/web/e2e`) and the root: folder order is not path order.
  const graph = monorepo(
    ['apps/web/src/x.ts:x', 'apps/web/e2e/a.ts:a', 'libs/ui/i.ts:i', 'tools/t.ts:t'],
    ['', 'apps/web', 'apps/web/e2e', 'libs/ui'],
  );
  const list = changeList(graph);
  const files = (l: typeof list) => l.map((f) => f.file);

  it('groups files by project, in folder order, when the changes span two or more', () => {
    expect(list.map((f) => `${f.project?.folder ?? '-'} ${f.file}`)).toEqual([
      ' tools/t.ts',
      'apps/web apps/web/src/x.ts',
      'apps/web/e2e apps/web/e2e/a.ts',
      'libs/ui libs/ui/i.ts',
    ]);
    expect(byProject(list).map((g) => [g.project?.name, files(g.files)])).toEqual([
      ['repository root', ['tools/t.ts']],
      ['web', ['apps/web/src/x.ts']],
      ['e2e', ['apps/web/e2e/a.ts']],
      ['ui', ['libs/ui/i.ts']],
    ]);
    // j/k follow the list.
    expect(stepChange(list, null, 1)).toBe('tools/t.ts#t');
    expect(stepChange(list, 'apps/web/src/x.ts#x', 1)).toBe('apps/web/e2e/a.ts#a');
  });

  it('stays one flat list when the changes are in one project', () => {
    const one = changeList(
      monorepo(['apps/web/a.ts:a', 'apps/web/b.ts:b'], ['', 'apps/web', 'libs/ui']),
    );
    expect(one.map((f) => f.project)).toEqual([undefined, undefined]);
    expect(byProject(one)).toEqual([{ files: one }]);
    expect(changeList(golden('callers')).some((f) => f.project)).toBe(false);
  });

  it('finds project names with the search', () => {
    const acme = changeList(golden('projects'));
    expect(filterChanges(acme, '@acme/ui').map((f) => [f.project?.name, f.file])).toEqual([
      ['@acme/ui', 'libs/ui/src/index.ts'],
    ]);
    expect(filterChanges(acme, 'acme legacy').flatMap((f) => f.symbols.map((s) => s.name))).toEqual(
      ['legacy'],
    );
  });

  it('shows one project, or leaves collapsed ones out', () => {
    expect(files(onlyProject(list, 'apps/web'))).toEqual(['apps/web/src/x.ts']);
    expect(files(onlyProject(list, ''))).toEqual(['tools/t.ts']);
    expect(onlyProject(list, null)).toBe(list);
    expect(files(withoutCollapsed(list, new Set(['', 'apps/web'])))).toEqual([
      'apps/web/e2e/a.ts',
      'libs/ui/i.ts',
    ]);
  });

  it('cycles through the projects, then all of them', () => {
    expect(nextProject(list, null, 1)).toBe('');
    expect(nextProject(list, '', 1)).toBe('apps/web');
    expect(nextProject(list, 'libs/ui', 1)).toBeNull();
    expect(nextProject(list, null, -1)).toBe('libs/ui');
    expect(nextProject(changeList(golden('callers')), null, 1)).toBeNull();
  });

  it("keeps a project's changes and what they are linked to in other projects", () => {
    const acme = golden('projects');
    const acmeList = changeList(acme);
    expect([...projectNeighbourhood(acme, acmeList, 'libs/ui')].sort()).toEqual([
      'apps/admin/src/page.ts#page',
      'apps/shop/src/cart.ts#cart',
      'libs/ui/src/index.ts#button',
    ]);
    expect([...projectNeighbourhood(acme, acmeList, 'apps/admin')].sort()).toEqual([
      'apps/admin/src/page.ts#page',
      'libs/ui/src/index.ts#button',
    ]);
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
    expect(reviewKey(graph)).toBe('symbiote:review:base..head');
    const request = { ...graph, changeRequest: { url: 'https://github.com/a/b/pull/7' } } as Graph;
    expect(reviewKey(request)).toBe('symbiote:review:https://github.com/a/b/pull/7');
    expect(reviewKey(request, 'drafts')).toBe('symbiote:drafts:https://github.com/a/b/pull/7');
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
