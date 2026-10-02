import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  analyzeDirectories,
  analyzeGit,
  buildGraph,
  createTypescriptAdapter,
  typescriptAdapter,
  type Analysis,
  type TsPlugin,
} from '../src/index.js';
import { createRepo } from './helpers/git-repo.js';
import { brokenPlugin, tplPlugin } from './helpers/tpl-plugin.js';

const fixture = (side: 'base' | 'head') =>
  fileURLToPath(new URL(`./fixtures/diff/plugin/${side}`, import.meta.url));

const analyze = (plugins: TsPlugin[]) =>
  analyzeDirectories(fixture('base'), fixture('head'), {
    adapter: createTypescriptAdapter({ plugins }),
  });

const change = (analysis: Analysis, id: string) => analysis.changes.find((c) => c.id === id);
const rules = (analysis: Analysis) => analysis.findings.map((f) => `${f.rule} ${f.symbol}`).sort();

describe('plugins', () => {
  it('turns templates into symbols whose uses are edges at their real sites', async () => {
    const analysis = await analyze([tplPlugin]);
    expect(change(analysis, 'src/card.tpl#(template)')).toMatchObject({
      status: 'modified',
      head: { kind: 'template', file: 'src/card.tpl', signature: 'template of Card' },
    });
    const fromTemplate = analysis.edges
      .filter((e) => e.from === 'src/card.tpl#(template)')
      .map((e) => [e.to, e.kind, e.side, e.sites.head?.[0] ?? e.sites.base?.[0]]);
    const at = (line: number, col: number) => ({ file: 'src/card.tpl', line, col });
    expect(fromTemplate).toEqual([
      ['src/card.ts#Card.double', 'call', 'head', at(3, 22)],
      ['src/card.ts#Card.increment', 'call', 'both', at(2, 22)],
      ['src/card.ts#Card.label', 'call', 'both', at(5, 7)],
      ['src/card.ts#Card.reset', 'call', 'base', at(3, 22)],
      ['src/card.ts#Card.title', 'reference', 'both', at(1, 8)],
      // As in TS code: a call that no longer resolves.
      ['unknown:this.reset', 'call', 'head', at(4, 22)],
    ]);
  });

  it('analyzes a change to a template alone', async () => {
    const repo = createRepo();
    try {
      const files = (side: 'base' | 'head', path: string) =>
        readFileSync(`${fixture(side)}/${path}`, 'utf8');
      repo.write(
        Object.fromEntries(
          [
            'package.json',
            'tsconfig.json',
            'src/framework.ts',
            'src/badge.ts',
            'src/badge.tpl',
          ].map((path) => [path, files('base', path)]),
        ),
      );
      const base = repo.commit('base');
      repo.write({ 'src/badge.tpl': files('head', 'src/badge.tpl') });
      repo.commit('template only');

      const without = await analyzeGit({ cwd: repo.root, base, head: 'HEAD' });
      expect(without.changes).toEqual([]);
      const withPlugin = await analyzeGit({
        cwd: repo.root,
        base,
        head: 'HEAD',
        adapter: createTypescriptAdapter({ plugins: [tplPlugin] }),
      });
      expect(withPlugin.changes.map((c) => [c.id, c.status])).toEqual([
        ['src/badge.tpl#(template)', 'modified'],
      ]);
      expect(withPlugin.edges.map((e) => [e.from, e.to, e.side, e.sites.head?.[0]?.line])).toEqual([
        ['src/badge.tpl#(template)', 'src/badge.ts#Badge.count', 'head', 1],
        ['src/badge.tpl#(template)', 'src/badge.ts#Badge.text', 'both', 1],
      ]);
    } finally {
      repo.cleanup();
    }
  });

  it('reports a removed method its template still calls', async () => {
    const analysis = await analyze([tplPlugin]);
    const finding = analysis.findings.find((f) => f.rule === 'removed-still-referenced');
    expect(finding).toMatchObject({
      severity: 'error',
      symbol: 'src/card.ts#Card.reset',
      related: ['src/card.tpl#(template)'],
      data: { certainty: 'resolved', sites: [{ file: 'src/card.tpl', line: 4, col: 22 }] },
    });
  });

  it('knows what the framework uses, and that configuration is not contract', async () => {
    // Without it: template users are invisible and a `tags` edit looks like a new signature.
    expect(rules(await analyze([]))).toEqual([
      'orphan-added src/card.ts#Card.double',
      'orphan-added src/card.ts#Card.onStart',
      'signature-changed src/card.ts#Card',
    ]);
    expect(rules(await analyze([tplPlugin]))).toEqual([
      'removed-still-referenced src/card.ts#Card.reset',
    ]);
  });

  it('hashes claimed decorator arguments by role', async () => {
    // `tags` is configuration: with the plugin, editing it is a body change of the class.
    expect(change(await analyze([]), 'src/card.ts#Card')?.delta).toMatchObject({
      signature: true,
    });
    expect(change(await analyze([tplPlugin]), 'src/card.ts#Card')?.delta).toMatchObject({
      signature: false,
      body: true,
    });
  });

  it('lists the plugins in the graph', async () => {
    const schema = JSON.parse(
      readFileSync(new URL('../schema/graph.schema.json', import.meta.url), 'utf8'),
    ) as object;
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    const graph = buildGraph(await analyze([tplPlugin]), {
      generator: { name: 'cpr', version: 'test' },
      plugins: [tplPlugin],
    });
    expect(validate(graph), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(graph.plugins).toEqual([{ name: 'tpl', version: '1.0.0' }]);
    expect(graph.nodes.find((n) => n.id === 'src/card.tpl#(template)')?.kind).toBe('template');
    expect(
      buildGraph(await analyze([]), { generator: { name: 'cpr', version: 'test' } }),
    ).not.toHaveProperty('plugins');
  });

  it('applies only where the plugin says so', async () => {
    const other: TsPlugin = { ...tplPlugin, applies: () => false };
    const analysis = await analyze([other]);
    expect(change(analysis, 'src/card.tpl#(template)')).toBeUndefined();
    expect(rules(analysis)).toEqual(rules(await analyze([])));
  });

  it('goes on without a plugin that throws', async () => {
    const analysis = await analyze([brokenPlugin]);
    expect(analysis.warnings).toContain(
      'plugin broken: extract failed (boom); continuing without it',
    );
    expect(change(analysis, 'src/card.tpl#(template)')).toBeUndefined();
    expect(analysis.edges.filter((e) => e.from.includes('.tpl'))).toEqual([]);
    expect(change(analysis, 'src/card.ts#Card.reset')?.status).toBe('removed');
  });

  it('passes on plugin warnings and never overwrites a real file', async () => {
    const clashing: TsPlugin = {
      ...tplPlugin,
      virtualFiles: () => [{ path: 'src/card.ts', text: 'export {};\n', map: () => undefined }],
      warnings: () => ['templates look odd'],
    };
    const analysis = await analyze([clashing]);
    expect(analysis.warnings).toEqual([
      'plugin tpl: virtual file src/card.ts clashes; skipped',
      'plugin tpl: templates look odd',
    ]);
    expect(change(analysis, 'src/card.ts#Card.reset')?.status).toBe('removed');
  });

  it('says which warnings only the base revision has', async () => {
    const sided: TsPlugin = {
      ...tplPlugin,
      warnings: (revision) => [revision.root.endsWith('base') ? 'old problem' : 'new problem'],
    };
    expect((await analyze([sided])).warnings).toEqual([
      'plugin tpl: new problem',
      'in base: plugin tpl: old problem',
    ]);
  });

  it('refuses another plugin API version', () => {
    const future = { ...tplPlugin, apiVersion: 2 } as unknown as TsPlugin;
    expect(() => createTypescriptAdapter({ plugins: [future] })).toThrow(
      'plugin tpl targets plugin API 2; this CPR implements 1',
    );
  });

  it('is the plain adapter without plugins', async () => {
    const plain = await analyzeDirectories(fixture('base'), fixture('head'), {
      adapter: typescriptAdapter,
    });
    const none = await analyze([]);
    const strip = (analysis: Analysis) => ({ ...analysis, timings: {} });
    expect(strip(none)).toEqual(strip(plain));
  });
});
