import { readFileSync } from 'node:fs';
import type { Graph, GraphNode } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  canSubmit,
  defaultAnchor,
  describeAnchor,
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
    {
      id: '1',
      symbol: slugify.id,
      anchor: defaultAnchor(graph, slugify, rows),
      body: ' Trim first? ',
    },
    { id: '2', symbol: 'src/user.ts#User', anchor: null, body: 'Rename this class.' },
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
