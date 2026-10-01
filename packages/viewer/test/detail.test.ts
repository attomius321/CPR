import { readFileSync } from 'node:fs';
import type { Graph } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { diffRows, excerpt, symbolDetail } from '../src/detail.js';

const graph = JSON.parse(
  readFileSync(
    new URL('../../core/test/__snapshots__/graph-callers.json', import.meta.url),
    'utf8',
  ),
) as Graph;

describe('symbolDetail', () => {
  it('lists users, callees and findings', () => {
    const add = symbolDetail(graph, 'src/math.ts#add');
    expect(add?.users.map((u) => `${u.id} ${u.side}`)).toEqual([
      'src/app.ts#total both',
      'src/math.ts#legacy base',
      'src/math.ts#triple head',
    ]);
    expect(add?.callees).toEqual([]);
    expect(add?.findings.map((f) => f.rule)).toEqual(['signature-changed']);
  });

  it('shows findings that mention a symbol', () => {
    const old = symbolDetail(graph, 'src/app.ts#old');
    expect(old?.mentions.map((f) => `${f.rule} ${f.symbol}`)).toEqual([
      'removed-still-referenced src/math.ts#legacy',
    ]);
  });

  it('is undefined for unknown IDs', () => {
    expect(symbolDetail(graph, 'nope')).toBeUndefined();
  });
});

describe('excerpt', () => {
  it('removes common indentation', () => {
    const source = 'class A {\n\tf() {\n\t\treturn 1;\n\t}\n}\n';
    expect(excerpt(source, { start: { line: 2, col: 2 }, end: { line: 4, col: 3 } }).text).toBe(
      'f() {\n\treturn 1;\n}',
    );
  });

  it('cuts the lines a range covers', () => {
    const source = 'a\nb\nc\nd\n';
    expect(excerpt(source, { start: { line: 2, col: 1 }, end: { line: 3, col: 2 } })).toEqual({
      firstLine: 2,
      text: 'b\nc',
    });
  });
});

describe('diffRows', () => {
  it('numbers lines on both sides', () => {
    const rows = diffRows(
      { firstLine: 10, text: 'function f(a) {\n  return a;\n}' },
      { firstLine: 12, text: 'function f(a, b = 0) {\n  return a;\n}' },
    );
    expect(rows).toEqual([
      { type: 'del', text: 'function f(a) {', base: 10 },
      { type: 'add', text: 'function f(a, b = 0) {', head: 12 },
      { type: 'same', text: '  return a;', base: 11, head: 13 },
      { type: 'same', text: '}', base: 12, head: 14 },
    ]);
  });

  it('shows added and removed symbols as one side', () => {
    expect(diffRows(undefined, { firstLine: 1, text: 'x\ny' }).map((r) => r.type)).toEqual([
      'add',
      'add',
    ]);
    expect(diffRows({ firstLine: 5, text: 'x' }, undefined)).toEqual([
      { type: 'del', text: 'x', base: 5 },
    ]);
  });
});
