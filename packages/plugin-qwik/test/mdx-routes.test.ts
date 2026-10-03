import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeDirectories,
  createTypescriptAdapter,
  type Analysis,
  type TsPlugin,
} from '@cpr/core';
import qwik from '../src/index.js';

const fixture = (name: string, side: 'base' | 'head') =>
  fileURLToPath(new URL(`./fixtures/${name}/${side}`, import.meta.url));
const analyze = (name: string, plugins: TsPlugin[] = [qwik]) =>
  analyzeDirectories(fixture(name, 'base'), fixture(name, 'head'), {
    adapter: createTypescriptAdapter({ plugins }),
  });
const rules = (analysis: Analysis) =>
  analysis.findings.map((f) => `${f.severity} ${f.rule} ${f.symbol}`);
const finding = (analysis: Analysis, symbol: string) =>
  analysis.findings.find((f) => f.symbol === symbol);

describe('the qwik plugin, MDX routes', () => {
  const NOTE = 'src/components/note.tsx#Note';
  const TERM = 'src/components/term.tsx#Term';
  const DOCS = 'src/routes/docs/index.mdx#(template)';
  const edgesFrom = (analysis: Analysis, from: string) =>
    analysis.edges
      .filter((e) => e.from === from)
      .map((e) => {
        const site = e.sites.head?.[0] ?? e.sites.base?.[0];
        return `${e.kind} ${e.to} [${e.side}] ${site?.file}:${site?.line}:${site?.col}`;
      });

  it('without it, what only MDX uses looks unused, and a removal goes unseen', async () => {
    expect(rules(await analyze('qwik-mdx', []))).toEqual([
      'warning orphan-added src/components/gallery.tsx#Gallery',
      'warning orphan-added src/components/quote.tsx#Quote',
      `warning signature-changed ${TERM}`,
    ]);
  });

  it('finds what MDX routes use: removed, changed, or only used there', async () => {
    const analysis = await analyze('qwik-mdx');
    expect(rules(analysis)).toEqual([
      'error removed-still-referenced src/components/chart.tsx#Chart',
      `warning signature-changed ${NOTE}`,
      `warning signature-changed ${TERM}`,
    ]);
    expect(finding(analysis, 'src/components/chart.tsx#Chart')).toMatchObject({
      message: 'Chart was removed but is still used by 1 symbol: index.mdx',
      data: { sites: [{ file: 'src/routes/docs/charts/index.mdx', line: 5, col: 2 }] },
    });
    // The route renders `<Note kind="tip">`: it misses the new required `title`.
    expect(finding(analysis, NOTE)?.message).toBe(
      'Note changed its props; 1 of 1 user not updated passes a changed prop or misses a new required one: index.mdx',
    );
    // `<Term>` comes from the MDX provider: the provider and the route both use it.
    expect(finding(analysis, TERM)?.message).toBe(
      'Term changed its props; 2 of 2 users not updated pass a changed prop or miss a new required one: useMDXComponents, index.mdx',
    );
    expect(analysis.warnings).toEqual([]);
  });

  it('links elements to their components, provided ones too, at their .mdx lines', async () => {
    const analysis = await analyze('qwik-mdx');
    const docs = 'src/routes/docs/index.mdx';
    expect(edgesFrom(analysis, DOCS)).toEqual([
      `call ${NOTE} [both] ${docs}:11:2`,
      // Given by the MDX provider (`providerImportSource` in vite.config.ts), not imported.
      `call ${TERM} [both] ${docs}:9:11`,
    ]);
  });

  it('ignores prose: only code parts are the template', async () => {
    const analysis = await analyze('qwik-mdx');
    const status = (id: string) => analysis.changes.find((c) => c.id === id)?.status;
    // Prose and inline code edited around unchanged elements.
    expect(status(DOCS)).toBe('unchanged');
    // A prose-only page gained an import and an element.
    expect(status('src/routes/blog/index.mdx#(template)')).toBe('added');
    expect(status('src/routes/gallery/index.mdx#(template)')).toBe('added');
  });
});
