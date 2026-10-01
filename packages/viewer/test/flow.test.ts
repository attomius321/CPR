import { readFileSync } from 'node:fs';
import type { Graph } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { label, toFlow, tone, type FlowNode, type SymbolFlowNode } from '../src/flow.js';

/** The engine's golden graphs double as viewer fixtures. */
const golden = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../core/test/__snapshots__/graph-${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as Graph;

const symbols = (nodes: FlowNode[]) =>
  nodes.filter((n): n is SymbolFlowNode => n.type === 'symbol');

/** Absolute x: children are positioned relative to their file box. */
const absoluteX = (nodes: FlowNode[], id: string) => {
  const node = symbols(nodes).find((n) => n.id === id);
  const parent = nodes.find((n) => n.id === node?.parentId);
  return (node?.position.x ?? NaN) + (parent?.position.x ?? 0);
};

describe('toFlow', () => {
  it('lays out every changed symbol and its neighbours', () => {
    const { nodes, edges } = toFlow(golden('callers'));
    expect(
      symbols(nodes)
        .map((n) => `${n.data.tone} ${n.data.label}`)
        .sort(),
    ).toEqual(['added triple', 'context old', 'context total', 'modified add', 'removed legacy']);
    expect(edges.map((e) => `${e.source} → ${e.target} ${e.className}`).sort()).toEqual([
      'src/app.ts#old → src/math.ts#legacy edge-base edge-call',
      'src/app.ts#total → src/math.ts#add edge-both edge-call',
      'src/math.ts#legacy → src/math.ts#add edge-base edge-call',
      'src/math.ts#triple → src/math.ts#add edge-head edge-call',
    ]);
    // Layered left to right: callers before callees.
    expect(absoluteX(nodes, 'src/app.ts#old')).toBeLessThan(absoluteX(nodes, 'src/math.ts#legacy'));
    expect(absoluteX(nodes, 'src/math.ts#triple')).toBeLessThan(
      absoluteX(nodes, 'src/math.ts#add'),
    );
  });

  it('boxes symbols by file and lists boxes before their symbols', () => {
    const { nodes } = toFlow(golden('callers'));
    const files = nodes.filter((n) => n.type === 'file');
    expect(files.map((f) => f.data.label).sort()).toEqual(['src/app.ts', 'src/math.ts']);
    expect(files.find((f) => f.data.label === 'src/app.ts')?.data.changed).toBe(false);
    const firstSymbol = nodes.findIndex((n) => n.type === 'symbol');
    expect(nodes.slice(firstSymbol).every((n) => n.type === 'symbol')).toBe(true);
    for (const node of symbols(nodes)) {
      const box = files.find((f) => f.id === node.parentId);
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.x + node.width).toBeLessThanOrEqual(box?.width ?? 0);
    }
  });

  it('counts findings per symbol', () => {
    const { nodes } = toFlow(golden('callers'));
    const legacy = symbols(nodes).find((n) => n.id === 'src/math.ts#legacy');
    expect(legacy?.data.findings).toEqual({ error: 1, warning: 0, info: 0 });
  });

  it('hides type references unless asked, and drops neighbours left without edges', () => {
    const graph = golden('detectors');
    const hidden = toFlow(graph);
    const shown = toFlow(graph, { typeReferences: true });
    expect(hidden.edges.some((e) => e.className.includes('edge-type-reference'))).toBe(false);
    expect(shown.edges.some((e) => e.className.includes('edge-type-reference'))).toBe(true);
    expect(shown.nodes.length).toBeGreaterThanOrEqual(hidden.nodes.length);
  });

  it('can hide context entirely', () => {
    const { nodes } = toFlow(golden('callers'), { context: false });
    expect(symbols(nodes).every((n) => n.data.node.status !== 'unchanged')).toBe(true);
  });

  it('labels special nodes', () => {
    const base = {
      container: null,
      language: 'typescript',
      exported: false,
      status: 'unchanged',
      previousId: null,
      base: null,
      head: null,
    } as const;
    expect(label({ ...base, id: 'src/a.ts#(module)', kind: 'module', name: 'src/a.ts' })).toBe(
      'top level',
    );
    expect(label({ ...base, id: 'unknown:obj[key]', kind: 'unknown', name: 'obj[key]' })).toBe(
      'obj[key]',
    );
    expect(tone({ ...base, id: 'react#useState', kind: 'external', name: 'useState' })).toBe(
      'external',
    );
  });
});
