// V108 (decisions 983–985): a file viewed and its symbols reviewed meet, one progress line on both
// pages, and R marks a file's symbols. On the small fix the graph usability spike walked.
import { readFileSync } from 'node:fs';
import type { Graph, ReviewFile } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  changeList,
  derivedMarks,
  fileSymbols,
  fileViewed,
  fingerprint,
  foldFindings,
  leftAfter,
  progressLine,
  reviewStatus,
  toggleFileSymbols,
  toggleFileViewed,
  toggleMark,
  viewedIn,
  type Marks,
} from '../src/diff/review.js';
import { stylesheetId } from '../src/graph/flow.js';
import { PAGE_CSS, RULE_IDS, sheetGraph } from './stylesheet-graph.js';

/**
 * The small fix (`fix/e2e-flakes`, 4cbcae0c): its 19 changed symbols in 10 of its 18 files, the
 * files with git's blobs, its findings (`test/fixtures/review-progress/flakes.json`).
 */
const flakes = JSON.parse(
  readFileSync(new URL('./fixtures/review-progress/flakes.json', import.meta.url), 'utf8'),
) as Graph & { files: ReviewFile[] };
const graph: Graph = flakes;
const files: ReviewFile[] = flakes.files;
const changed = graph.nodes.filter((n) => n.status !== 'unchanged');
const byId = new Map(changed.map((n) => [n.id, n]));
const file = (path: string) => files.find((f) => f.path.endsWith(path))!;
const node = (id: string) => byId.get(id)!;
/** Every changed symbol marked reviewed, as `r` on each leaves the marks. */
const allSymbols: Marks = Object.fromEntries(changed.map((n) => [n.id, fingerprint(n)]));
const fileMark = (f: ReviewFile, blob = f.blob!) => ({ [`file:${f.path}`]: blob });
/** V105's stylesheet change, on the callers golden's revisions; its card's id. */
const golden = JSON.parse(
  readFileSync(
    new URL('../../core/test/__snapshots__/graph-callers.json', import.meta.url),
    'utf8',
  ),
) as Graph;
const CARD = stylesheetId(PAGE_CSS);

const LAUNCHES = 'packages/cli/src/workspace-launches.ts';
const USE_WORKSPACES = 'packages/viewer/src/workspaces/useWorkspaces.ts';
const MERGES = 'packages/cli/src/merges.ts';
const JOURNAL = 'docs/JOURNAL.md';

/** What both pages read from `marks`: the symbols reviewed, and the files viewed by path. */
function read(marks: Marks, over: readonly ReviewFile[] = files) {
  const derived = derivedMarks(graph, over, marks);
  const { reviewed, stale } = reviewStatus(graph, derived);
  return {
    symbols: changed.filter((n) => reviewed.has(n.id)).map((n) => n.id),
    viewed: files.filter((f) => viewedIn(derived, f.path)).map((f) => f.path),
    /** What the Graph page counts: `file:<path>` in the reviewed set. */
    viewedOnGraph: graph.files.filter((f) => reviewed.has(`file:${f.path}`)).map((f) => f.path),
    stale: [...stale],
  };
}

describe('the small fix', () => {
  it('has 19 changed symbols in 10 of its 18 files', () => {
    expect(changed).toHaveLength(19);
    expect(files).toHaveLength(18);
    const held = fileSymbols(graph, files);
    expect([...held.keys()]).toHaveLength(10);
    expect(held.get(LAUNCHES)?.map((n) => n.id)).toEqual([
      `${LAUNCHES}#WorkspaceLaunches`,
      `${LAUNCHES}#workspaceLaunches`,
    ]);
    expect(held.get(USE_WORKSPACES)).toHaveLength(5);
    expect(held.get(JOURNAL)).toBeUndefined();
  });
});

describe('derivedMarks (V108, decision 983)', () => {
  it('shows every file with symbols viewed once all 19 symbols are reviewed', () => {
    const now = read(allSymbols);
    expect(now.symbols).toHaveLength(19);
    // The spike: 0 of 18. Each of the 10 files with symbols reads viewed, on both pages.
    expect(now.viewed).toEqual([...fileSymbols(graph, files).keys()].sort(byFileOrder));
    expect(now.viewed).toHaveLength(10);
    expect(now.viewedOnGraph).toEqual(now.viewed);
    // The files without symbols are left to view.
    expect(now.viewed).not.toContain(JOURNAL);
  });

  it("reviews a viewed file's changed symbols", () => {
    const now = read(fileMark(file(USE_WORKSPACES)));
    expect(now.symbols).toEqual(
      fileSymbols(graph, files)
        .get(USE_WORKSPACES)!
        .map((n) => n.id),
    );
    expect(now.viewed).toEqual([USE_WORKSPACES]);
    expect(now.viewedOnGraph).toEqual([USE_WORKSPACES]);
  });

  it('reads both kinds of marks together', () => {
    const marks = { ...fileMark(file(USE_WORKSPACES)), ...fileMark(file(JOURNAL)) };
    marks[`${MERGES}#merger`] = fingerprint(node(`${MERGES}#merger`));
    const now = read(marks);
    expect(now.symbols).toHaveLength(6);
    expect(now.viewed.sort()).toEqual([JOURNAL, MERGES, USE_WORKSPACES].sort());
  });

  it('leaves a file changed since unviewed, and its symbols as their own marks say', () => {
    const marks = fileMark(file(USE_WORKSPACES), 'f'.repeat(40));
    const refresh = `${USE_WORKSPACES}#refresh`;
    const now = read({ ...marks, [refresh]: fingerprint(node(refresh)) });
    expect(now.viewed).toEqual([]);
    expect(now.symbols).toEqual([refresh]);
  });

  it("reviews a symbol changed since its own mark while its file's mark is current", () => {
    const refresh = `${USE_WORKSPACES}#refresh`;
    const now = read({ ...fileMark(file(USE_WORKSPACES)), [refresh]: 'old|old' });
    expect(now.symbols).toContain(refresh);
    expect(now.stale).toEqual([]);
  });

  it('does not view a file one of whose symbols changed since it was reviewed', () => {
    const marks = { ...allSymbols, [`${MERGES}#merger`]: 'old|old' };
    const now = read(marks);
    expect(now.viewed).not.toContain(MERGES);
    expect(now.viewed).toHaveLength(9);
    expect(now.stale).toEqual([`${MERGES}#merger`]);
  });

  it('without blobs (a graph opened from a file): viewed through its symbols, not its own mark', () => {
    const bare = files.map((f) => ({ ...f, blob: undefined }));
    const now = read({ ...allSymbols, ...fileMark(file(JOURNAL)) }, bare);
    expect(now.symbols).toHaveLength(19);
    expect(now.viewed).toEqual([...fileSymbols(graph, files).keys()].sort(byFileOrder));
    expect(now.viewedOnGraph).toEqual(now.viewed);
    expect(now.viewed).not.toContain(JOURNAL);
  });

  it('agrees with fileViewed on a file with a blob', () => {
    const derived = derivedMarks(graph, files, allSymbols);
    for (const f of files) expect(viewedIn(derived, f.path)).toBe(fileViewed(derived, f));
  });

  it('keeps the marks it is given: an old review reads as before, plus what it implies', () => {
    const marks = { ...fileMark(file(JOURNAL)), 'packages/gone.ts#x': 'a|b' };
    const derived = derivedMarks(graph, files, marks);
    expect(derived).toMatchObject(marks);
  });
});

describe('the toggles keep the two kinds of marks meeting', () => {
  const launches = fileSymbols(graph, files)
    .get(LAUNCHES)!
    .map((n) => n.id);

  it('`v` stores the file mark only; its symbols read reviewed', () => {
    const marks = toggleFileViewed(graph, files, {}, file(LAUNCHES));
    expect(marks).toEqual(fileMark(file(LAUNCHES)));
    expect(read(marks).symbols).toEqual(launches);
  });

  it('`v` on a file viewed through its symbols unmarks them', () => {
    const marks = Object.fromEntries(launches.map((id) => [id, fingerprint(node(id))]));
    expect(read(marks).viewed).toEqual([LAUNCHES]);
    const next = toggleFileViewed(graph, files, marks, file(LAUNCHES));
    expect(next).toEqual({});
  });

  it("`v` again keeps a symbol's own mark made before it", () => {
    const own = { [launches[0]!]: fingerprint(node(launches[0]!)) };
    const viewed = toggleFileViewed(graph, files, own, file(LAUNCHES));
    expect(read(viewed).symbols).toEqual(launches);
    expect(toggleFileViewed(graph, files, viewed, file(LAUNCHES))).toEqual(own);
  });

  it('`v` on a file changed since views it at its new blob', () => {
    const old = fileMark(file(LAUNCHES), 'f'.repeat(40));
    expect(toggleFileViewed(graph, files, old, file(LAUNCHES))).toEqual(fileMark(file(LAUNCHES)));
  });

  it("`r` on a symbol reviewed through its file unviews the file, keeping the others' review", () => {
    const viewed = toggleFileViewed(graph, files, {}, file(USE_WORKSPACES));
    const newer = `${USE_WORKSPACES}#newer`;
    const next = toggleMark(graph, viewed, newer, files);
    const now = read(next);
    expect(now.viewed).toEqual([]);
    expect(now.symbols).toHaveLength(4);
    expect(now.symbols).not.toContain(newer);
    expect(Object.keys(next)).not.toContain(`file:${USE_WORKSPACES}`);
  });

  it('`r` on the last symbol of a file views it, with no file mark stored', () => {
    const first = toggleMark(graph, {}, launches[0]!, files);
    expect(read(first).viewed).toEqual([]);
    const both = toggleMark(graph, first, launches[1]!, files);
    expect(read(both).viewed).toEqual([LAUNCHES]);
    expect(Object.keys(both).sort()).toEqual([...launches].sort());
  });

  it('`r` without the files works as before', () => {
    const marks = toggleMark(graph, {}, launches[0]!);
    expect(marks).toEqual({ [launches[0]!]: fingerprint(node(launches[0]!)) });
    expect(toggleMark(graph, marks, launches[0]!)).toEqual({});
  });

  it('a stylesheet is still marked as one', () => {
    const sheets = sheetGraph(golden);
    const all = toggleMark(sheets, {}, CARD, []);
    expect(reviewStatus(sheets, all).reviewed).toEqual(new Set(RULE_IDS));
    expect(toggleMark(sheets, all, CARD, [])).toEqual({});
  });
});

describe("`R`: a file's symbols at once (V108, decision 985)", () => {
  const ids = fileSymbols(graph, files)
    .get(USE_WORKSPACES)!
    .map((n) => n.id);
  const newer = `${USE_WORKSPACES}#newer`;

  it("marks every unreviewed changed symbol of the picked symbol's file, in one write", () => {
    const one = { [ids[0]!]: fingerprint(node(ids[0]!)) };
    const marks = toggleFileSymbols(graph, files, one, newer);
    expect(Object.keys(marks).sort()).toEqual([...ids].sort());
    expect(read(marks).viewed).toEqual([USE_WORKSPACES]);
    // Nothing else of the change.
    expect(read(marks).symbols).toHaveLength(5);
  });

  it('unmarks them all once all are reviewed, the file viewed or not', () => {
    const marked = toggleFileSymbols(graph, files, {}, newer);
    expect(toggleFileSymbols(graph, files, marked, newer)).toEqual({});
    const viewed = toggleFileViewed(graph, files, {}, file(USE_WORKSPACES));
    expect(toggleFileSymbols(graph, files, viewed, newer)).toEqual({});
  });

  it('keeps the rest of the review', () => {
    const rest = {
      ...fileMark(file(JOURNAL)),
      [`${MERGES}#merger`]: fingerprint(node(`${MERGES}#merger`)),
    };
    const marks = toggleFileSymbols(graph, files, rest, newer);
    expect(marks).toMatchObject(rest);
  });

  it("works on a graph opened from a file: by the symbol's own file", () => {
    const marks = toggleFileSymbols(graph, [], {}, newer);
    expect(Object.keys(marks).sort()).toEqual([...ids].sort());
  });

  it('marks nothing for a symbol not in the change', () => {
    expect(toggleFileSymbols(graph, files, {}, 'packages/x.ts#nothing')).toEqual({});
  });
});

describe('progressLine (V108, decision 984)', () => {
  const list = changeList(graph);
  const listed = foldFindings(graph.findings, graph.projects).shown;
  const line = (marks: Marks) => {
    const { reviewed } = reviewStatus(graph, derivedMarks(graph, files, marks));
    return progressLine(files, list, reviewed, listed);
  };

  it('counts files viewed, symbols reviewed and findings left', () => {
    const none = line({});
    expect(none.files).toEqual({ done: 0, total: 18 });
    expect(none.items).toEqual({ done: 0, total: 19, sheets: 0 });
    expect(none.findings).toBe(listed.length);
    expect(listed.length).toBe(4);
    // Each symbol once, and each file without one.
    expect(none.bar).toEqual({ done: 0, total: 19 + 8 });
    expect(none.itemsLeft).toHaveLength(19);
    expect(none.filesLeft).toEqual(files.map((f) => f.path));
  });

  it('after all 19 symbols: 10 of 18 files, nothing left on the graph, the docs and tests left', () => {
    const all = line(allSymbols);
    expect(all.files).toEqual({ done: 10, total: 18 });
    expect(all.items).toEqual({ done: 19, total: 19, sheets: 0 });
    expect(all.findings).toBe(0);
    expect(all.bar).toEqual({ done: 19, total: 27 });
    expect(all.itemsLeft).toEqual([]);
    expect(all.filesLeft).toHaveLength(8);
    expect(all.filesLeft).toContain(JOURNAL);
  });

  it('is done once every file is viewed', () => {
    let marks: Marks = {};
    for (const f of files) marks = toggleFileViewed(graph, files, marks, f);
    const done = line(marks);
    expect(done.files).toEqual({ done: 18, total: 18 });
    expect(done.items.done).toBe(19);
    expect(done.bar).toEqual({ done: 27, total: 27 });
    expect(done.filesLeft).toEqual([]);
  });

  it('counts a finding left until its symbol is reviewed', () => {
    const first = listed[0]!;
    const marks = { [first.symbol]: fingerprint(node(first.symbol)) };
    expect(line(marks).findings).toBe(listed.filter((f) => f.symbol !== first.symbol).length);
  });

  it('counts the same on both pages: the Graph page has no blobs, only the reviewed set', () => {
    const marks = { ...fileMark(file(JOURNAL)), ...fileMark(file(USE_WORKSPACES)) };
    const { reviewed } = reviewStatus(graph, derivedMarks(graph, files, marks));
    // The Graph page passes the graph's own files, without lines or blobs.
    const onGraph = progressLine(graph.files, list, reviewed, listed);
    const onFiles = progressLine(files, list, reviewed, listed);
    expect(onGraph.files).toEqual(onFiles.files);
    expect(onGraph.items).toEqual(onFiles.items);
    expect(onGraph.bar).toEqual(onFiles.bar);
    expect(onGraph.files).toEqual({ done: 2, total: 18 });
  });

  it('counts a stylesheet once, as the list does (V105)', () => {
    const sheets = sheetGraph(golden);
    const sheetFiles = [...new Set(sheets.nodes.map((n) => n.id.slice(0, n.id.indexOf('#'))))].map(
      (path): ReviewFile => ({ path, status: 'modified' }),
    );
    const progress = progressLine(sheetFiles, changeList(sheets), new Set(), []);
    expect(progress.items.sheets).toBe(1);
    const items = changeList(sheets).map((f) => (f.stylesheet ? 1 : f.symbols.length));
    expect(progress.items.total).toBe(items.reduce((a, b) => a + b, 0));
  });
});

describe('leftAfter: the "next" of the line', () => {
  it('is the first thing left after the current one, wrapping around', () => {
    expect(leftAfter(['a', 'b', 'c', 'd'], ['b', 'd'], null)).toBe('b');
    expect(leftAfter(['a', 'b', 'c', 'd'], ['b', 'd'], 'b')).toBe('d');
    expect(leftAfter(['a', 'b', 'c', 'd'], ['b', 'd'], 'c')).toBe('d');
    expect(leftAfter(['a', 'b', 'c', 'd'], ['b', 'd'], 'd')).toBe('b');
    expect(leftAfter(['a', 'b', 'c', 'd'], ['b'], 'b')).toBe('b');
    expect(leftAfter(['a', 'b'], [], 'a')).toBeNull();
    // A current one not in the order: the first left.
    expect(leftAfter(['a', 'b', 'c'], ['c'], 'x')).toBe('c');
  });
});

/** The fixture's files in git's order, as `files` lists them. */
function byFileOrder(a: string, b: string): number {
  return files.findIndex((f) => f.path === a) - files.findIndex((f) => f.path === b);
}
