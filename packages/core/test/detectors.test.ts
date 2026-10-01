import { describe, expect, it } from 'vitest';
import {
  runDetectors,
  type DetectorInput,
  type Edge,
  type SymbolChange,
  type SymbolDecl,
} from '../src/index.js';

function decl(id: string, kind: SymbolDecl['kind'] = 'function'): SymbolDecl {
  const [file = '', qualified = ''] = id.split('#');
  const dot = qualified.lastIndexOf('.');
  return {
    id,
    kind,
    name: qualified.slice(dot + 1),
    container: dot === -1 ? null : `${file}#${qualified.slice(0, dot)}`,
    exported: true,
    file,
    range: { start: { line: 1, col: 1 }, end: { line: 1, col: 2 } },
    signature: id,
    hashes: { signature: 's', body: 'b' },
    bodySize: 20,
  };
}

const change = (
  status: SymbolChange['status'],
  id: string,
  kind?: SymbolDecl['kind'],
): SymbolChange => ({
  id,
  status,
  previousId: null,
  base: status === 'added' ? null : decl(id, kind),
  head: status === 'removed' ? null : decl(id, kind),
  ...(status === 'modified' ? { delta: { signature: true, body: false, moved: false } } : {}),
});

const edge = (from: string, to: string, side: Edge['side'] = 'both'): Edge => ({
  from,
  to,
  kind: 'call',
  side,
  resolution: 'resolved',
  sites: {},
});

const input = (overrides: Partial<DetectorInput>): DetectorInput => ({
  changes: [],
  edges: [],
  files: [],
  dangling: [],
  exposure: new Map(),
  ...overrides,
});

describe('runDetectors', () => {
  it('downgrades removed-still-referenced to a warning when only untyped code still uses it', () => {
    const [finding] = runDetectors(
      input({
        changes: [change('removed', 'a.ts#gone')],
        edges: [edge('b.js#caller', 'a.ts#gone', 'base')],
        dangling: [
          {
            target: 'a.ts#gone',
            from: 'b.js#caller',
            site: { file: 'b.js', line: 1, col: 1 },
            certainty: 'unknown',
            viaImport: false,
          },
        ],
      }),
    );
    expect(finding).toMatchObject({
      id: 'f1',
      severity: 'warning',
      data: { certainty: 'unknown' },
    });
  });

  it('ignores unresolved names in symbols that never used the removed one', () => {
    const findings = runDetectors(
      input({
        changes: [change('removed', 'a.ts#gone')],
        dangling: [
          {
            target: 'a.ts#gone',
            from: 'c.ts#stranger',
            site: { file: 'c.ts', line: 1, col: 1 },
            certainty: 'resolved',
            viaImport: false,
          },
        ],
      }),
    );
    expect(findings).toEqual([]);
  });

  it('counts top-level code in a changed file as an updated user', () => {
    const [finding] = runDetectors(
      input({
        changes: [change('modified', 'a.ts#f')],
        edges: [edge('b.ts#(module)', 'a.ts#f'), edge('c.ts#(module)', 'a.ts#f')],
        files: [{ status: 'modified', path: 'b.ts' }],
      }),
    );
    expect(finding).toMatchObject({
      severity: 'warning',
      related: ['c.ts#(module)', 'b.ts#(module)'],
      data: { callers: 2, updated: 1, untouched: 1 },
    });
  });

  it('sets test users apart: only stale tests make it information', () => {
    const [finding] = runDetectors(
      input({
        changes: [change('modified', 'a.ts#f')],
        edges: [edge('test/a.test.ts#(module)', 'a.ts#f'), edge('a.spec.ts#check', 'a.ts#f')],
      }),
    );
    expect(finding).toMatchObject({
      severity: 'info',
      message: 'f changed its signature; only tests use it · 2 test users, 2 not updated',
      data: { callers: 2, untouched: 2, untouchedElsewhere: 0, tests: 2, untouchedTests: 2 },
    });
  });

  it('flags public API removed or no longer exported, once', () => {
    const findings = runDetectors(
      input({
        changes: [
          change('removed', 'a.ts#gone'),
          change('removed', 'a.ts#stillUsed'),
          change('modified', 'a.ts#hidden'),
        ],
        edges: [edge('b.ts#caller', 'a.ts#stillUsed', 'base')],
        dangling: [
          {
            target: 'a.ts#stillUsed',
            from: 'b.ts#caller',
            site: { file: 'b.ts', line: 1, col: 1 },
            certainty: 'resolved',
            viaImport: true,
          },
        ],
        publicApi: {
          base: new Set(['a.ts#gone', 'a.ts#stillUsed', 'a.ts#hidden']),
          head: new Set(),
        },
      }),
    );
    expect(
      findings.map(
        (f) => `${f.severity} ${f.rule} ${f.symbol} ${JSON.stringify(f.data.change ?? null)}`,
      ),
    ).toEqual([
      // The repo itself breaks: that error says it; no second finding.
      'error removed-still-referenced a.ts#stillUsed null',
      'warning exported-api-changed a.ts#gone "removed"',
      'warning exported-api-changed a.ts#hidden "unexported"',
    ]);
  });

  it('reports an orphan class once, not each of its members', () => {
    const findings = runDetectors(
      input({
        changes: [
          change('added', 'a.ts#Fresh', 'class'),
          change('added', 'a.ts#Fresh.run', 'method'),
          change('added', 'a.ts#Fresh.constructor', 'constructor'),
        ],
        // Members referencing their own class don't make it used.
        edges: [edge('a.ts#Fresh.run', 'a.ts#Fresh', 'head')],
      }),
    );
    expect(findings.map((f) => `${f.rule} ${f.symbol}`)).toEqual(['orphan-added a.ts#Fresh']);
  });

  it('marks public API and default exports as info and skips overrides', () => {
    const findings = runDetectors(
      input({
        changes: [
          change('added', 'a.ts#api'),
          change('added', 'a.ts#default'),
          change('added', 'a.ts#C.use', 'method'),
        ],
        exposure: new Map([
          ['a.ts#api', 'entry-export'],
          ['a.ts#default', 'default-export'],
          ['a.ts#C.use', 'override'],
        ]),
      }),
    );
    expect(findings.map((f) => `${f.severity} ${f.symbol}`)).toEqual([
      'info a.ts#api',
      'info a.ts#default',
    ]);
  });
});
