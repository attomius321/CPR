import { readFileSync } from 'node:fs';
import type { Graph, GraphNode } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  canFinish,
  canSubmit,
  defaultAnchor,
  describeAnchor,
  describeDraft,
  newDraft,
  newLineDraft,
  refreshDrafts,
  symbolAt,
  toLocalReview,
  toReview,
  type Draft,
} from '../src/diff/comments.js';
import type { DiffRow } from '../src/diff/detail.js';

const graph = JSON.parse(
  readFileSync(
    new URL('../../core/test/__snapshots__/graph-service.json', import.meta.url),
    'utf8',
  ),
) as Graph;
const node = (id: string) => graph.nodes.find((n) => n.id === id) as GraphNode;

// slugify moved from src/old-utils.ts to src/text/slug.ts.
const slugify = node('src/text/slug.ts#slugify');
const rows: DiffRow[] = [
  { type: 'same', text: 'export function slugify(s: string) {', base: 4, head: 1 },
  { type: 'del', text: '  return s.toLowerCase();', base: 5 },
  { type: 'add', text: '  return s.trim().toLowerCase();', head: 2 },
  { type: 'same', text: '}', base: 6, head: 3 },
];

describe('anchors', () => {
  it('prefers the first added line', () => {
    expect(defaultAnchor(graph, slugify, rows)).toEqual({
      side: 'head',
      path: 'src/text/slug.ts',
      otherPath: 'src/text/slug.ts',
      line: 2,
    });
  });

  it('anchors removed lines on the base side', () => {
    expect(anchorFor(graph, slugify, rows[1] as DiffRow)).toMatchObject({
      side: 'base',
      path: 'src/old-utils.ts',
      line: 5,
    });
    expect(defaultAnchor(graph, slugify, rows.slice(0, 2))?.side).toBe('base');
  });

  it('has no anchor on unchanged lines, which the forge may refuse', () => {
    expect(anchorFor(graph, slugify, rows[0] as DiffRow)).toBeNull();
    expect(defaultAnchor(graph, slugify, [rows[0] as DiffRow])).toBeNull();
  });

  it('pairs paths across a rename', () => {
    const renamed: Graph = {
      ...graph,
      files: [{ status: 'renamed', path: 'src/text/slug.ts', previousPath: 'src/old-utils.ts' }],
    };
    expect(defaultAnchor(renamed, slugify, rows)?.otherPath).toBe('src/old-utils.ts');
    expect(anchorFor(renamed, slugify, rows[1] as DiffRow)?.otherPath).toBe('src/text/slug.ts');
  });

  it('describes where a comment goes', () => {
    expect(describeAnchor(defaultAnchor(graph, slugify, rows))).toBe(
      'on line 2 of src/text/slug.ts',
    );
    expect(describeAnchor(anchorFor(graph, slugify, rows[1] as DiffRow))).toBe(
      'on removed line 5 of src/old-utils.ts',
    );
    expect(describeAnchor(null)).toBe('in the review summary (no changed line)');
  });
});

describe('toReview', () => {
  const drafts: Draft[] = [
    newDraft(slugify, defaultAnchor(graph, slugify, rows), ' Trim first? '),
    newDraft(node('src/user.ts#User'), null, 'Rename this class.'),
  ];

  it('posts anchored drafts inline and quotes the others in the summary', () => {
    expect(toReview(graph, drafts, 'comment', 'Looks good overall.')).toEqual({
      event: 'comment',
      body: 'Looks good overall.\n\n**`User`** (src/user.ts)\nRename this class.',
      comments: [
        {
          side: 'head',
          path: 'src/text/slug.ts',
          otherPath: 'src/text/slug.ts',
          line: 2,
          body: 'Trim first?',
        },
      ],
    });
  });

  it('knows what the forge accepts', () => {
    expect(canSubmit([], 'approve', '')).toBe(true);
    expect(canSubmit([], 'comment', '')).toBe(false);
    expect(canSubmit(drafts, 'comment', '')).toBe(true);
    expect(canSubmit(drafts, 'request-changes', ' ')).toBe(false);
    expect(canSubmit([], 'request-changes', 'Split it')).toBe(true);
  });
});

describe('toLocalReview (V16)', () => {
  const drafts: Draft[] = [
    newDraft(slugify, defaultAnchor(graph, slugify, rows), ' Trim first? '),
    newDraft(node('src/user.ts#User'), null, 'Rename this class.'),
  ];

  it('keeps every draft a comment, with its symbol and id; a line when it has one', () => {
    const [first, second] = drafts;
    expect(toLocalReview(drafts, 'request-changes', ' Two things. ')).toEqual({
      event: 'request-changes',
      body: 'Two things.',
      comments: [
        {
          id: first?.id,
          symbol: 'src/text/slug.ts#slugify',
          body: 'Trim first?',
          side: 'head',
          path: 'src/text/slug.ts',
          otherPath: 'src/text/slug.ts',
          line: 2,
        },
        { id: second?.id, symbol: 'src/user.ts#User', body: 'Rename this class.' },
      ],
    });
  });

  it('finishes with a verdict alone, else with something to say', () => {
    expect(canFinish([], 'approve', '')).toBe(true);
    expect(canFinish([], 'request-changes', ' ')).toBe(false);
    expect(canFinish(drafts, 'request-changes', '')).toBe(true);
    expect(canFinish([], 'comment', 'A thought.')).toBe(true);
  });
});

describe('refreshDrafts', () => {
  /** The same change after another push: slugify moved down 3 lines, maybe with new code. */
  const pushed = (body?: string): Graph => ({
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === slugify.id && n.head
        ? {
            ...n,
            head: {
              ...n.head,
              range: {
                start: { ...n.head.range.start, line: n.head.range.start.line + 3 },
                end: { ...n.head.range.end, line: n.head.range.end.line + 3 },
              },
              hashes: { ...n.head.hashes, body: body ?? n.head.hashes.body },
            },
          }
        : n,
    ),
  });
  const draft = newDraft(slugify, defaultAnchor(graph, slugify, rows), 'Trim first?');

  it('keeps a comment on the same line of an unchanged symbol', () => {
    const [moved] = refreshDrafts(pushed(), [draft]);
    expect(moved?.anchor?.line).toBe(5);
    expect(moved?.outdated).toBeUndefined();
    expect(refreshDrafts(graph, [draft])[0]).toBe(draft);
  });

  it('turns comments on changed or vanished symbols into summary notes', () => {
    const [changed] = refreshDrafts(pushed('ffff'), [draft]);
    expect(changed).toMatchObject({ anchor: null, outdated: true, body: 'Trim first?' });
    expect(describeDraft(changed as Draft)).toBe(
      'outdated: the symbol changed since; in the review summary',
    );
    const gone = { ...graph, nodes: graph.nodes.filter((n) => n.id !== slugify.id) };
    expect(refreshDrafts(gone, [draft])[0]?.outdated).toBe(true);
  });
});

describe('comments on a line of a file (V60)', () => {
  const head = (path: string, line: number) => ({
    side: 'head' as const,
    path,
    otherPath: path,
    line,
  });

  it('finds the innermost symbol holding a line on its side', () => {
    expect(symbolAt(graph, 'head', 'src/user.ts', 8)?.id).toBe('src/user.ts#findUser');
    expect(symbolAt(graph, 'head', 'src/user.ts', 6)).toBeUndefined();
    expect(symbolAt(graph, 'base', 'src/old-utils.ts', 2)?.id).toBe('src/text/slug.ts#slugify');
    expect(symbolAt(graph, 'head', 'README.md', 1)).toBeUndefined();
    const user = node('src/user.ts#User');
    const method: GraphNode = {
      ...user,
      id: 'src/user.ts#User.name',
      head: user.head && {
        ...user.head,
        range: { start: { line: 2, col: 3 }, end: { line: 3, col: 4 } },
      },
    };
    const nested = { ...graph, nodes: [...graph.nodes, method] };
    expect(symbolAt(nested, 'head', 'src/user.ts', 3)?.id).toBe('src/user.ts#User.name');
    expect(symbolAt(nested, 'head', 'src/user.ts', 4)?.id).toBe('src/user.ts#User');
  });

  it('names the symbol holding its line, as a comment written on the symbol does', () => {
    const draft = newLineDraft(graph, head('src/user.ts', 8), ' Why? ');
    const findUser = node('src/user.ts#findUser');
    expect(draft).toMatchObject({
      symbol: 'src/user.ts#findUser',
      body: 'Why?',
      start: findUser.head?.range.start.line,
    });
    expect(draft.print).toBe(newDraft(findUser, null, 'x').print);
    expect(draft.at).toBeUndefined();
  });

  it('names none outside every symbol, and keeps the head it was written at', () => {
    const draft = newLineDraft(graph, head('README.md', 1), 'Typo.');
    expect(draft).toMatchObject({ anchor: head('README.md', 1), body: 'Typo.', at: 'head' });
    expect(draft).not.toHaveProperty('symbol');
    expect(refreshDrafts(graph, [draft])[0]).toBe(draft);
    const later: Graph = {
      ...graph,
      revisions: { ...graph.revisions, head: { ref: 'h2', sha: 'c'.repeat(40) } },
    };
    const [moved] = refreshDrafts(later, [draft]);
    expect(moved).toMatchObject({ anchor: null, outdated: true, was: head('README.md', 1) });
    expect(describeDraft(moved as Draft)).toBe(
      'outdated: new commits since; in the review summary',
    );
    expect(describeDraft(draft)).toBe('on line 1 of README.md');
  });

  it('posts a line comment inline, and quotes an outdated one in the summary', () => {
    const line = newLineDraft(graph, head('README.md', 1), 'Typo.');
    const outdated: Draft = {
      ...line,
      id: 'o',
      anchor: null,
      outdated: true,
      was: head('README.md', 3),
    };
    expect(toReview(graph, [line, outdated], 'comment', '')).toEqual({
      event: 'comment',
      body: '**`README.md:3`**\nTypo.',
      comments: [
        { side: 'head', path: 'README.md', otherPath: 'README.md', line: 1, body: 'Typo.' },
      ],
    });
    expect(toLocalReview([line, outdated], 'comment', 'Two notes.')).toEqual({
      event: 'comment',
      body: 'Two notes.\n\n**`README.md:3`**\nTypo.',
      comments: [
        {
          id: line.id,
          body: 'Typo.',
          side: 'head',
          path: 'README.md',
          otherPath: 'README.md',
          line: 1,
        },
      ],
    });
  });
});
