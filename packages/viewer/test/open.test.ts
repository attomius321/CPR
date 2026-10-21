import { readFileSync } from 'node:fs';
import type { Graph, GraphNode } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import type { DiffRow } from '../src/detail.js';
import { anchorTarget, describeOpen, rowTarget, symbolTarget } from '../src/open.js';

const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../core/test/__snapshots__/${name}`, import.meta.url), 'utf8'),
  ) as Graph;
const service = read('graph-service.json');
const callers = read('graph-callers.json');
const node = (graph: Graph, id: string) => graph.nodes.find((n) => n.id === id) as GraphNode;

// slugify moved from src/old-utils.ts to src/text/slug.ts.
const slugify = node(service, 'src/text/slug.ts#slugify');
const rows: DiffRow[] = [
  { type: 'same', text: 'export function slugify(s: string) {', base: 4, head: 1 },
  { type: 'del', text: '  return s.toLowerCase();', base: 5 },
  { type: 'add', text: '  return s.trim().toLowerCase();', head: 2 },
];

describe('what opens', () => {
  it('a symbol at its first line: head’s, else base’s (removed)', () => {
    expect(symbolTarget(node(service, 'src/user.ts#findUser'))).toEqual({
      side: 'head',
      file: 'src/user.ts',
      line: 7,
      column: 1,
    });
    expect(symbolTarget(node(callers, 'src/math.ts#legacy'))).toEqual({
      side: 'base',
      file: 'src/math.ts',
      line: 5,
      column: 1,
    });
  });

  it('a row at its head line when it has one, else at its base line, in that side’s file', () => {
    expect(rows.map((row) => rowTarget(slugify, row))).toEqual([
      { side: 'head', file: 'src/text/slug.ts', line: 1, column: 1 },
      { side: 'base', file: 'src/old-utils.ts', line: 5, column: 1 },
      { side: 'head', file: 'src/text/slug.ts', line: 2, column: 1 },
    ]);
  });

  it('a row’s line number on its own side', () => {
    expect(rowTarget(slugify, rows[0] as DiffRow, 'base')).toEqual({
      side: 'base',
      file: 'src/old-utils.ts',
      line: 4,
      column: 1,
    });
    expect(rowTarget(slugify, rows[1] as DiffRow, 'head')).toBe(null);
  });

  it('a comment’s line', () => {
    expect(
      anchorTarget({
        side: 'base',
        path: 'src/old-utils.ts',
        otherPath: 'src/text/slug.ts',
        line: 5,
      }),
    ).toEqual({ side: 'base', file: 'src/old-utils.ts', line: 5, column: 1 });
  });
});

describe('describeOpen', () => {
  const head = { side: 'head', file: 'src/a.ts', line: 48, column: 1 } as const;
  const base = { ...head, side: 'base' } as const;

  it('says where it opened, and when the line moved in the working copy', () => {
    expect(describeOpen(head, { ok: true, line: 48, how: 'exact', moved: false })).toBe(
      'Opened in VS Code at line 48',
    );
    expect(describeOpen(head, { ok: true, line: 52, how: 'exact', moved: true })).toBe(
      'Opened in VS Code at line 52 (48 at head: moved in your working copy)',
    );
  });

  it('says when the line itself is not in the working copy', () => {
    expect(describeOpen(head, { ok: true, line: 60, how: 'nearest', moved: false })).toBe(
      'Line 48 changed in your working copy: opened at line 60, where it was',
    );
    expect(describeOpen(base, { ok: true, line: 60, how: 'nearest', moved: false })).toBe(
      'Line 48 of base is not in your working copy: opened at line 60, where it was',
    );
  });

  it('passes the server’s error on', () => {
    expect(describeOpen(head, { ok: false, error: 'src/a.ts is not in your working copy' })).toBe(
      'src/a.ts is not in your working copy',
    );
  });
});
