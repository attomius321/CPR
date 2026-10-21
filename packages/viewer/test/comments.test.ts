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
  refreshDrafts,
  toLocalReview,
  toReview,
  type Draft,
} from '../src/comments.js';
import type { DiffRow } from '../src/detail.js';

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
