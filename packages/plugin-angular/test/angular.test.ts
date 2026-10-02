import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeDirectories,
  buildGraph,
  createTypescriptAdapter,
  type Analysis,
  type TsPlugin,
} from '@cpr/core';
import angular from '../src/index.js';

const fixture = (name: string, side: 'base' | 'head') =>
  fileURLToPath(new URL(`./fixtures/${name}/${side}`, import.meta.url));
const analyze = (name: string, plugins: TsPlugin[] = [angular]) =>
  analyzeDirectories(fixture(name, 'base'), fixture(name, 'head'), {
    adapter: createTypescriptAdapter({ plugins }),
  });

const APP = 'src/app';
const ARTICLE = `${APP}/article.component.ts#ArticleComponent`;
const ARTICLE_HTML = `${APP}/article.component.html#(template)`;
const BADGE = `${APP}/badge.component.ts#BadgeComponent`;

const changed = (analysis: Analysis) =>
  analysis.changes
    .filter((c) => c.status !== 'unchanged')
    .map((c) => `${c.status} ${c.id}${c.delta?.signature ? ' (signature)' : ''}`);
const rules = (analysis: Analysis) =>
  analysis.findings.map((f) => `${f.severity} ${f.rule} ${f.symbol}`);
const edgesFrom = (analysis: Analysis, from: string) =>
  analysis.edges
    .filter((e) => e.from === from)
    .map((e) => {
      const site = e.sites.head?.[0] ?? e.sites.base?.[0];
      return `${e.kind} ${e.to} [${e.side}] ${site?.file}:${site?.line}:${site?.col}`;
    });

describe('the angular plugin', () => {
  it('sees templates: changes, uses and removed members still used', async () => {
    const analysis = await analyze('templates');
    expect(changed(analysis)).toEqual([
      `modified ${ARTICLE_HTML}`,
      `modified ${ARTICLE}`,
      `modified ${ARTICLE}.label`,
      `added ${ARTICLE}.ngOnInit`,
      `removed ${ARTICLE}.remove`,
      `added ${ARTICLE}.toggle`,
      `added ${ARTICLE}.onKey`,
      `modified ${BADGE}.(template)`,
      `modified ${APP}/broken.component.ts#BrokenComponent.title`,
      // A generic component: its new members are used by its template and host bindings.
      `modified ${APP}/table.component.html#(template)`,
      `modified ${APP}/table.component.ts#TableComponent`,
      `added ${APP}/table.component.ts#TableComponent.rowHeight`,
      `added ${APP}/table.component.ts#TableComponent.minHeight`,
    ]);
    // The only finding is real: the template still calls the removed method.
    expect(rules(analysis)).toEqual([`error removed-still-referenced ${ARTICLE}.remove`]);
    expect(analysis.findings[0]).toMatchObject({
      message:
        'ArticleComponent.remove was removed but is still used by 1 symbol: article.component.html',
      data: { sites: [{ file: `${APP}/article.component.html`, line: 6, col: 20 }] },
    });
  });

  it('resolves template names like TypeScript: members, chains, inherited members', async () => {
    const html = `${APP}/article.component.html`;
    expect(edgesFrom(await analyze('templates'), ARTICLE_HTML)).toEqual([
      `reference ${ARTICLE}.items [both] ${html}:11:15`,
      `reference ${ARTICLE}.label [both] ${html}:2:8`,
      `call ${ARTICLE}.remove [base] ${html}:5:20`,
      `call ${ARTICLE}.save [both] ${html}:4:20`,
      `reference ${ARTICLE}.title [both] ${html}:1:8`,
      `call ${ARTICLE}.toggle [head] ${html}:5:20`,
      `call ${APP}/auth.service.ts#AuthService.isLoggedIn [both] ${html}:3:11`,
      `reference ${APP}/base.component.ts#BaseComponent.loading [both] ${html}:8:6`,
      `call ${APP}/item.ts#Item.reload [both] ${html}:12:23`,
      // As in TS code: a call that no longer resolves.
      `call unknown:this.remove [head] ${html}:6:20`,
    ]);
    // `#query`, `@let count` and `let-name` are template locals: no edge to the members
    // of the same name. The sibling OtherComponent's `{{ label }}` is not a use of
    // ArticleComponent.label (R1).
  });

  it('keeps host bindings, lifecycle hooks and configuration out of the warnings', async () => {
    const without = await analyze('templates', []);
    expect(rules(without)).toEqual([
      `warning orphan-added ${ARTICLE}.ngOnInit`,
      `warning orphan-added ${ARTICLE}.onKey`,
      `warning orphan-added ${ARTICLE}.toggle`,
      `warning orphan-added ${APP}/table.component.ts#TableComponent.minHeight`,
      `warning orphan-added ${APP}/table.component.ts#TableComponent.rowHeight`,
      `warning signature-changed ${ARTICLE}`,
      `info signature-changed ${BADGE}`,
    ]);
    const analysis = await analyze('templates');
    // `imports` and `host` are configuration: the class body changed, not its signature.
    expect(changed(analysis)).toContain(`modified ${ARTICLE}`);
    expect(edgesFrom(analysis, ARTICLE)).toContain(
      `call ${ARTICLE}.onKey [head] ${APP}/article.component.ts:12:34`,
    );
  });

  it('treats an inline template as its own symbol, at its lines in the .ts file', async () => {
    const analysis = await analyze('templates');
    // The class did not change: only its template did.
    expect(changed(analysis).filter((c) => c.includes('BadgeComponent'))).toEqual([
      `modified ${BADGE}.(template)`,
    ]);
    const badge = `${APP}/badge.component.ts`;
    expect(edgesFrom(analysis, `${BADGE}.(template)`)).toEqual([
      `call ${BADGE}.hit [both] ${badge}:5:26`,
      `reference ${BADGE}.hits [head] ${badge}:5:48`,
      `reference ${BADGE}.text [both] ${badge}:5:36`,
    ]);
  });

  it('ignores formatting, and warns about templates it cannot read', async () => {
    const analysis = await analyze('templates');
    // card.component.html was only reformatted.
    expect(changed(analysis).some((c) => c.includes('card'))).toBe(false);
    expect(analysis.warnings).toEqual([
      'plugin angular: src/app/broken.component.html: template has syntax errors (1:15 Parser Error: Unexpected end of expression: save( at the end of the expression [save(]); references may be missing',
      // A shim can only import an exported class.
      'plugin angular: 1 Angular class is not exported, so its template is not analyzed: HiddenComponent (src/app/hidden.component.ts)',
    ]);
    // The rest of the broken template is still read.
    expect(edgesFrom(analysis, `${APP}/broken.component.html#(template)`)).toEqual([
      `reference ${APP}/broken.component.ts#BrokenComponent.title [both] ${APP}/broken.component.html:2:7`,
    ]);
  });

  it('reads Angular 11 templates with Angular 11 syntax', async () => {
    const analysis = await analyze('legacy');
    expect(analysis.warnings).toEqual([]);
    const html = 'src/app/contact.component.html';
    // `*ngIf="title as heading"` reads `title`; `{{ heading }}` is the alias, a local.
    const uses = analysis.edges.filter((e) => e.from === `${html}#(template)`);
    expect(uses.map((e) => [e.to, e.sites.head?.map((s) => `${s.line}:${s.col}`)])).toEqual([
      ['src/app/contact.component.ts#ContactComponent.title', ['3:12', '4:7']],
    ]);
  });

  it('labels templates in the graph', async () => {
    const graph = buildGraph(await analyze('templates'), {
      generator: { name: 'cpr', version: 'test' },
      plugins: [angular],
    });
    expect(graph.plugins).toEqual([{ name: 'angular', version: '0.1.0' }]);
    expect(graph.nodes.find((n) => n.id === ARTICLE_HTML)).toMatchObject({
      kind: 'template',
      head: { file: `${APP}/article.component.html`, signature: 'template of ArticleComponent' },
    });
  });

  it('changes nothing in a project without Angular', async () => {
    const other = (side: 'base' | 'head') =>
      fileURLToPath(new URL(`../../core/test/fixtures/diff/detectors/${side}`, import.meta.url));
    const run = (plugins: TsPlugin[]) =>
      analyzeDirectories(other('base'), other('head'), {
        adapter: createTypescriptAdapter({ plugins }),
      });
    const strip = (analysis: Analysis) => ({ ...analysis, timings: {} });
    expect(strip(await run([angular]))).toEqual(strip(await run([])));
  });
});
