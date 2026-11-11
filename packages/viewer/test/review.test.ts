import { readFileSync } from 'node:fs';
import type { Finding, Graph, GraphNode, Project } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { stylesheetId, toFlow } from '../src/graph/flow.js';
import {
  byProject,
  changeList,
  fileViewed,
  filterChanges,
  findingPills,
  fingerprint,
  foldFindings,
  layoutView,
  neighbourhood,
  nextProject,
  onlyProject,
  projectNeighbourhood,
  reviewKey,
  reviewProgress,
  reviewStatus,
  stepChange,
  toggleFileMark,
  toggleMark,
  withoutCollapsed,
} from '../src/diff/review.js';
import {
  ONLY,
  PAGE,
  PAGE_CSS,
  RULE_IDS,
  SINGLE_CSS,
  rule,
  sheetGraph,
} from './stylesheet-graph.js';

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

describe('layoutView (V101, decision 971)', () => {
  const choice = {
    typeReferences: false,
    context: true,
    expanded: new Set<string>(),
    focusOn: null,
    project: null,
  };

  it("lays out Focus's neighbourhood with type references, whatever the toggle", () => {
    const graph = golden('detectors');
    const view = layoutView(graph, changeList(graph), {
      ...choice,
      focusOn: 'src/shapes.ts#Shape',
    });
    expect(view.typeReferences).toBe(true);
    expect([...(view.focus ?? [])].sort()).toEqual(
      [...neighbourhood(graph, 'src/shapes.ts#Shape')].sort(),
    );
    expect(view.context).toBe(true);
  });

  it('keeps the toggle without Focus, on the whole change or one project', () => {
    const graph = golden('detectors');
    expect(layoutView(graph, changeList(graph), choice)).toEqual({
      typeReferences: false,
      context: true,
      expanded: new Set(),
    });
    const acme = golden('projects');
    const acmeList = changeList(acme);
    const project = layoutView(acme, acmeList, { ...choice, project: 'libs/ui' });
    expect(project.typeReferences).toBe(false);
    expect(project.focus).toEqual(projectNeighbourhood(acme, acmeList, 'libs/ui'));
    expect(layoutView(graph, [], { ...choice, typeReferences: true }).typeReferences).toBe(true);
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

describe("a file's viewed mark (V90, decision 843)", () => {
  const graph = golden('callers');
  const file = { status: 'modified' as const, path: 'src/math.ts', blob: 'b1'.repeat(20) };

  it('marks a file viewed by its blob, and unmarks it', () => {
    const marks = toggleFileMark({}, file);
    expect(marks).toEqual({ 'file:src/math.ts': file.blob });
    expect(fileViewed(marks, file)).toBe(true);
    expect(toggleFileMark(marks, file)).toEqual({});
  });

  it('shows a file changed since unviewed, and marks its new blob', () => {
    const marks = toggleFileMark({}, file);
    const pushed = { ...file, blob: 'c2'.repeat(20) };
    expect(fileViewed(marks, pushed)).toBe(false);
    expect(toggleFileMark(marks, pushed)).toEqual({ 'file:src/math.ts': pushed.blob });
  });

  it('cannot mark a file git gave no blob for', () => {
    const bare = { status: file.status, path: file.path };
    expect(toggleFileMark({}, bare)).toEqual({});
    expect(fileViewed({ 'file:src/math.ts': 'x' }, bare)).toBe(false);
  });

  it("keeps the files' marks when a symbol is marked, and the symbols' when a file is", () => {
    const viewed = toggleFileMark({}, file);
    const both = toggleMark(graph, viewed, 'src/math.ts#add');
    expect(Object.keys(both).sort()).toEqual(['file:src/math.ts', 'src/math.ts#add']);
    // The file viewed is read as its mark's key (V108: the Graph page counts files from it).
    expect(reviewStatus(graph, both).reviewed).toEqual(
      new Set(['src/math.ts#add', 'file:src/math.ts']),
    );
    expect(Object.keys(toggleFileMark(both, file))).toEqual(['src/math.ts#add']);
  });
});

/** A walked change's findings and projects (`test/fixtures/findings/`: the spike's five, V100). */
const walked = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/findings/${name}.json`, import.meta.url), 'utf8'),
  ) as { projects: Project[]; findings: Finding[] };

/** A finding of `rule` on `symbol`, its severity and data as given. */
const finding = (
  id: string,
  symbol: string,
  severity: Finding['severity'],
  data: Record<string, unknown>,
  rule: Finding['rule'] = 'signature-changed',
): Finding => ({ id, rule, severity, symbol, related: [], message: id, data });

describe('foldFindings (V100, decision 969)', () => {
  // The five changes the graph usability spike walked: what is listed by severity, and the
  // settled signature changes folded per project.
  it.each([
    ['refactor', { warning: 1, info: 4 }, { '@symbiote/cli': 61 }],
    [
      'issues',
      { warning: 1, info: 3 },
      { '@symbiote/cli': 1, '@symbiote/forge': 2, '@symbiote/viewer': 1 },
    ],
    ['flakes', { info: 4 }, { '@symbiote/cli': 2 }],
    ['bitwarden', { warning: 7 }, { web: 2 }],
    ['qwik', { warning: 2, info: 3 }, { '@qwik.dev/core': 10, 'qwik-e2e': 1 }],
  ])('%s: lists the rest by severity, folds the settled per project', (name, listed, folded) => {
    const { findings, projects } = walked(name);
    const { shown, folds } = foldFindings(findings, projects);
    const count: Record<string, number> = {};
    for (const f of shown) count[f.severity] = (count[f.severity] ?? 0) + 1;
    expect(count).toEqual(listed);
    expect(Object.fromEntries(folds.map((f) => [f.project?.name, f.findings.length]))).toEqual(
      folded,
    );
    // Nothing lost, nothing twice; every warning and error still listed.
    expect(shown.length + folds.reduce((n, f) => n + f.findings.length, 0)).toBe(findings.length);
    expect(shown.filter((f) => f.severity !== 'info')).toHaveLength(
      findings.filter((f) => f.severity !== 'info').length,
    );
    // The worst first; folds in their projects' folder order.
    const order = { error: 0, warning: 1, info: 2 };
    const severities = shown.map((f) => order[f.severity]);
    expect(severities).toEqual([...severities].sort((a, b) => a - b));
    const folders = folds.map((f) => f.project?.folder ?? '');
    expect(folders).toEqual([...folders].sort((a, b) => a.localeCompare(b)));
  });

  it('folds a compatible change, or one whose users were all updated; keeps the rest', () => {
    const findings = [
      finding('f1', 'src/a.ts#compatible', 'info', { compatibility: 'compatible', untouched: 3 }),
      finding('f2', 'src/a.ts#updated', 'info', { compatibility: 'breaking', untouched: 0 }),
      // Code that creates it must add the new members: something is left to update.
      finding('f3', 'src/a.ts#additive', 'info', { compatibility: 'additive', untouched: 2 }),
      finding('f4', 'src/a.ts#notUpdated', 'info', { compatibility: 'breaking', untouched: 1 }),
      // A warning is never folded, whatever its data says.
      finding('f5', 'src/a.ts#warned', 'warning', { compatibility: 'compatible', untouched: 0 }),
      // Another rule with the same data.
      finding(
        'f6',
        'src/a.ts#exported',
        'info',
        { compatibility: 'compatible' },
        'exported-api-changed',
      ),
      // A graph from before `compatibility` and `untouched`.
      finding('f7', 'src/a.ts#older', 'info', { callers: 2 }),
    ];
    const { shown, folds } = foldFindings(findings);
    expect(shown.map((f) => f.id)).toEqual(['f5', 'f3', 'f4', 'f6', 'f7']);
    // Without projects, one fold.
    expect(folds).toEqual([{ findings: [findings[0], findings[1]] }]);
  });

  it('nothing settled, no fold', () => {
    const { findings } = walked('bitwarden');
    const unsettled = findings.filter((f) => f.rule !== 'signature-changed');
    expect(foldFindings(unsettled).folds).toEqual([]);
  });
});

describe('findingPills (V100, decision 968)', () => {
  it("callers: the head's pills count what the tab lists, by severity", () => {
    const graph = golden('callers');
    const { shown, folds } = foldFindings(graph.findings, graph.projects);
    // The info, `add` changed compatibly, is folded: counted in its fold, not in a pill.
    expect(findingPills(shown).map((p) => p.words)).toEqual(['1 error', '1 warning']);
    expect(folds.map((f) => f.findings.map((x) => x.symbol))).toEqual([['src/math.ts#add']]);
  });

  it('infos are notes, each severity a pill in severity order', () => {
    const graph = golden('detectors');
    const { shown } = foldFindings(graph.findings, graph.projects);
    expect(findingPills(shown)).toEqual([
      { severity: 'error', count: 1, words: '1 error' },
      { severity: 'warning', count: 2, words: '2 warnings' },
      { severity: 'info', count: 1, words: '1 note' },
    ]);
    expect(findingPills([])).toEqual([]);
  });
});

describe('a stylesheet as one item (V105, decision 980)', () => {
  const graph = sheetGraph(golden('callers'));
  const list = changeList(graph);
  const CARD = stylesheetId(PAGE_CSS);

  it('gives a stylesheet of changed rules one entry, its rules in line order', () => {
    expect(list.map((f) => [f.file, f.stylesheet ?? false, f.symbols.length])).toEqual([
      ['src/Page.tsx', false, 1],
      [SINGLE_CSS, false, 1],
      [PAGE_CSS, true, 10],
    ]);
    expect(list[2]?.symbols.map((s) => s.id)).toEqual(RULE_IDS);
    // The search keeps it one entry, with the rules that match.
    expect(
      filterChanges(list, 'card').map((f) => [f.file, f.stylesheet, f.symbols.map((s) => s.name)]),
    ).toEqual([[PAGE_CSS, true, ['.card', '.card-head']]]);
  });

  it('counts it once in the progress, reviewed when all its rules are', () => {
    expect(reviewProgress(list, new Set())).toEqual({ done: 0, total: 3 });
    expect(reviewProgress(list, new Set([PAGE, ...RULE_IDS.slice(1)]))).toEqual({
      done: 1,
      total: 3,
    });
    expect(reviewProgress(list, new Set([PAGE, ...RULE_IDS]))).toEqual({ done: 2, total: 3 });
    // Without stylesheets, a symbol an item, as before.
    const callers = changeList(golden('callers'));
    expect(reviewProgress(callers, new Set())).toEqual({
      done: 0,
      total: callers.reduce((n, f) => n + f.symbols.length, 0),
    });
  });

  it('steps over it as one, landing on its first rule', () => {
    expect(stepChange(list, PAGE, 1)).toBe(ONLY);
    expect(stepChange(list, ONLY, 1)).toBe(RULE_IDS[0]);
    expect(stepChange(list, rule('.card'), 1)).toBe(PAGE);
    expect(stepChange(list, rule('.card'), -1)).toBe(ONLY);
    expect(stepChange(list, PAGE, -1)).toBe(RULE_IDS[0]);
    expect(stepChange(list, null, -1)).toBe(RULE_IDS[0]);
  });

  it('marks all its rules with one mark, from its row or any of its rules', () => {
    const all = toggleMark(graph, {}, CARD);
    expect(reviewStatus(graph, all).reviewed).toEqual(new Set(RULE_IDS));
    expect(toggleMark(graph, all, CARD)).toEqual({});
    expect(reviewStatus(graph, toggleMark(graph, {}, rule('.card'))).reviewed).toEqual(
      new Set(RULE_IDS),
    );
    expect(toggleMark(graph, all, rule('.badge'))).toEqual({});
    // One rule changed since: the next mark reviews them all again.
    const pushed: Graph = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === rule('.card') && n.head
          ? { ...n, head: { ...n.head, hashes: { ...n.head.hashes, body: 'new' } } }
          : n,
      ),
    };
    expect(reviewStatus(pushed, all).stale).toEqual(new Set([rule('.card')]));
    expect(reviewStatus(pushed, toggleMark(pushed, all, CARD)).reviewed).toEqual(new Set(RULE_IDS));
    // A stylesheet with one changed rule is that rule's mark.
    expect(Object.keys(toggleMark(graph, {}, ONLY))).toEqual([ONLY]);
  });
});
