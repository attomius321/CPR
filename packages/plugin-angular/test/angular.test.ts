import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('the angular plugin, across components', () => {
  const PREVIEW = `${APP}/preview.component.ts#PreviewComponent`;
  const PARENT_HTML = `${APP}/parent.component.html`;

  it('finds what templates still use of what was removed or changed', async () => {
    // parent.component.html did not change; what it uses did.
    const findings = (await analyze('bindings')).findings.map(
      (f) =>
        `${f.severity} ${f.rule} ${f.symbol} ${(f.data.sites as { line: number; col: number }[] | undefined)?.map((s) => `${s.line}:${s.col}`).join(',') ?? ''}`,
    );
    expect(findings).toEqual([
      // A removed component whose selector a template still uses: Angular rejects it.
      `error removed-still-referenced ${APP}/badge.component.ts#BadgeComponent 15:2`,
      // An input renamed while a template still binds the old name: rejected too.
      `error removed-still-referenced ${PREVIEW}.label 5:4`,
      // The new name is not bound anywhere yet.
      `warning orphan-added ${PREVIEW}.caption `,
      // A removed output still listened to: Angular accepts it, and it never fires.
      `warning removed-still-referenced ${PREVIEW}.closed 10:4`,
      // Breaking changes whose template users were not updated.
      `warning signature-changed ${APP}/markdown.pipe.ts#MarkdownPipe.transform `,
      `warning signature-changed ${PREVIEW}.size `,
    ]);
    const without = await analyze('bindings', []);
    expect(without.findings.map((f) => `${f.rule} ${f.symbol}`)).toEqual([
      // A directive used only as `*ifAuthenticated` looks unused without the plugin.
      `orphan-added ${APP}/if-authenticated.directive.ts#IfAuthenticatedDirective`,
      `orphan-added ${PREVIEW}.caption`,
    ]);
  });

  it('links elements, bindings, references and pipes to what they use', async () => {
    const short = (text: string) => text.replaceAll(`${APP}/`, '');
    const edges = edgesFrom(await analyze('bindings'), `${PARENT_HTML}#(template)`).map(short);
    const html = 'parent.component.html';
    expect(edges).toEqual([
      `call badge.component.ts#BadgeComponent [base] ${html}:15:2`,
      // An input inherited from a base directive.
      `reference base-card.ts#BaseCard.theme [both] ${html}:7:4`,
      // A structural directive and its input.
      `call if-authenticated.directive.ts#IfAuthenticatedDirective [head] ${html}:13:5`,
      `reference if-authenticated.directive.ts#IfAuthenticatedDirective.ifAuthenticated [head] ${html}:13:5`,
      `call markdown.pipe.ts#MarkdownPipe.transform [both] ${html}:14:24`,
      `call preview.component.ts#PreviewComponent [both] ${html}:1:2`,
      // A signal input.
      `reference preview.component.ts#PreviewComponent.article [both] ${html}:3:4`,
      `reference preview.component.ts#PreviewComponent.closed [base] ${html}:10:4`,
      // `[total]` is the alias of the signal input `count`.
      `reference preview.component.ts#PreviewComponent.count [both] ${html}:4:4`,
      `reference preview.component.ts#PreviewComponent.label [base] ${html}:5:4`,
      // `#p="appPreview"` … `p.reload()`.
      `call preview.component.ts#PreviewComponent.reload [both] ${html}:12:20`,
      // `[(selected)]` on a `model()`.
      `reference preview.component.ts#PreviewComponent.selected [both] ${html}:8:5`,
      `reference preview.component.ts#PreviewComponent.size [both] ${html}:6:4`,
    ]);
  });

  it('marks components that share a selector as possible', async () => {
    const analysis = await analyze('bindings');
    const twins = analysis.edges
      .filter((e) => e.from === `${APP}/shelf.component.html#(template)`)
      .map((e) => [e.to, e.possible]);
    expect(twins).toEqual([
      [`${APP}/twins.component.ts#TwinAComponent`, true],
      [`${APP}/twins.component.ts#TwinBComponent`, true],
    ]);
  });
});

describe('the angular plugin, with libraries', () => {
  const ORG = `${APP}/org.component.html#(template)`;
  const ORGANIZATION = `${APP}/org.ts#Organization`;

  it('types what library pipes return: a member read only through `| await` is a use', async () => {
    const analysis = await analyze('libraries');
    expect(rules(analysis)).toEqual([`error removed-still-referenced ${ORGANIZATION}.name`]);
    expect(analysis.findings[0]?.data).toMatchObject({
      sites: [{ file: `${APP}/org.component.html`, line: 2, col: 14 }],
    });
    // Organization.plan is new and read only in `@if (org$ | await; as org)`: not an orphan.
    expect(changed(analysis)).toContain(`added ${ORGANIZATION}.plan`);
    expect(analysis.warnings).toEqual([
      'plugin angular: 1 Angular library class has metadata in a form CPR cannot read, so templates do not match it: UiFuture (@acme/ui)',
    ]);
  });

  it('stays as without libraries when dependencies are not installed', async () => {
    const copy = mkdtempSync(join(tmpdir(), 'cpr-ng-'));
    try {
      for (const side of ['base', 'head'] as const) {
        cpSync(fixture('libraries', side), join(copy, side), {
          recursive: true,
          filter: (path) => !path.includes('node_modules'),
        });
      }
      const analysis = await analyzeDirectories(join(copy, 'base'), join(copy, 'head'), {
        adapter: createTypescriptAdapter({ plugins: [angular] }),
      });
      // `org` has no type: neither the removed nor the new member is seen.
      expect(rules(analysis)).toEqual([`warning orphan-added ${ORGANIZATION}.plan`]);
      expect(analysis.edges.filter((e) => e.to.startsWith('@'))).toEqual([]);
      expect(analysis.warnings).toEqual([]);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  it('links library components, directives, pipes and their members to their packages', async () => {
    const short = (text: string) => text.replaceAll(`${APP}/`, '');
    const edges = edgesFrom(await analyze('libraries'), ORG).map(short);
    const html = 'org.component.html';
    expect(edges).toEqual([
      // `(press)="onPress($event.count)"`: the output's type types `$event`.
      `reference @acme/ui#PressEvent.count [both] ${html}:6:87`,
      `call @acme/ui#UiAwaitPipe [both] ${html}:1:13`,
      `call @acme/ui#UiAwaitPipe.transform [both] ${html}:1:13`,
      `call @acme/ui#UiButton [both] ${html}:6:2`,
      `reference @acme/ui#UiButton.label [both] ${html}:6:12`,
      `reference @acme/ui#UiButton.press [both] ${html}:6:64`,
      // `kind="primary"`: an aliased input.
      `reference @acme/ui#UiButton.variant [both] ${html}:6:25`,
      // An input of the base class.
      `reference @acme/ui#UiButtonBase.disabled [both] ${html}:6:41`,
      `call @acme/ui#UiFormDirective [both] ${html}:7:7`,
      `reference @acme/ui#UiFormDirective.submitted [both] ${html}:7:27`,
      // `#f="uiForm"` … `f.valid`.
      `reference @acme/ui#UiFormDirective.valid [both] ${html}:8:14`,
      // Exported as `ɵUiInternal` only.
      `call @acme/ui#UiInternal [both] ${html}:12:8`,
      `reference @acme/ui#UiInternal.level [both] ${html}:12:8`,
      // Angular 9-11 typings after ngcc, from an entry point UiModule exports.
      `call @legacy/widgets#WidgetDirective [both] ${html}:10:7`,
      `reference @legacy/widgets#WidgetDirective.widgetValue [both] ${html}:10:7`,
      `call @legacy/widgets#WidgetUpperPipe [both] ${html}:10:34`,
      `call @legacy/widgets#WidgetUpperPipe.transform [both] ${html}:10:34`,
      // View Engine metadata.json, with an input inherited from an undecorated base.
      `reference @old/forms#OldControl.disabled [both] ${html}:11:42`,
      `call @old/forms#OldFormatPipe [both] ${html}:12:53`,
      `call @old/forms#OldFormatPipe.transform [both] ${html}:12:53`,
      `call @old/forms#OldModelDirective [both] ${html}:11:9`,
      `reference @old/forms#OldModelDirective.model [both] ${html}:11:9`,
      `reference @old/forms#OldModelDirective.update [both] ${html}:11:64`,
      `reference @old/forms#OldModelDirective.valid [both] ${html}:12:33`,
      `reference org.component.ts#OrgComponent.count [both] ${html}:6:52`,
      `call org.component.ts#OrgComponent.onPress [both] ${html}:6:72`,
      `call org.component.ts#OrgComponent.onSubmit [both] ${html}:7:38`,
      `reference org.component.ts#OrgComponent.org$ [both] ${html}:1:6`,
      `call org.component.ts#OrgComponent.rename [both] ${html}:11:81`,
      `reference org.component.ts#OrgComponent.title [both] ${html}:10:26`,
      `reference org.component.ts#OrgComponent.user$ [both] ${html}:5:8`,
      `reference org.ts#Organization.name [base] ${html}:2:14`,
      `reference org.ts#Organization.plan [head] ${html}:3:13`,
      // `(user$ | await)?.email`.
      `reference org.ts#User.email [both] ${html}:5:24`,
      // Nothing from `@acme/unused` (installed, not imported) or `UiHidden` (not exported).
    ]);
  });
});

describe('the angular plugin, in a repo with several projects', () => {
  // Two apps two folders down, nothing at the root: `legacy` on Angular 11 (`baseUrl` in
  // src/tsconfig.app.json, `team@example.com` in a template), `modern` on Angular 17 (`@app/*`,
  // `@if`, `@let`), each with its own version of `@acme/badge`.
  const LEGACY = 'apps/web/legacy/src/app';
  const MODERN = 'apps/web/modern/src/app';
  const LEGACY_HTML = `${LEGACY}/contact.component.html#(template)`;
  const MODERN_HTML = `${MODERN}/profile.component.html#(template)`;

  it('analyzes each app with its own Angular version', async () => {
    const analysis = await analyze('multi-project');
    expect(analysis.warnings).toEqual([]);
    expect(changed(analysis)).toEqual([
      // An HTML-only change.
      `modified ${LEGACY_HTML}`,
      `modified ${MODERN}/core/account.ts#Account`,
      `removed ${MODERN}/core/account.ts#Account.verified`,
      `modified ${MODERN_HTML}`,
    ]);
    expect(rules(analysis)).toEqual([
      `error removed-still-referenced ${MODERN}/core/account.ts#Account.verified`,
    ]);
    expect(analysis.findings[0]?.related).toEqual([MODERN_HTML]);
  });

  it('links templates to their own app: its classes and its installed libraries', async () => {
    const analysis = await analyze('multi-project');
    const legacy = 'apps/web/legacy/src/app/contact.component.html';
    expect(edgesFrom(analysis, LEGACY_HTML)).toEqual([
      `call @acme/badge#BadgeComponent [both] ${legacy}:2:2`,
      // Angular 11 typings after ngcc: `text`.
      `reference @acme/badge#BadgeComponent.text [both] ${legacy}:2:14`,
      `reference ${LEGACY}/contact.component.ts#ContactComponent.account [both] ${legacy}:2:21`,
      `call ${LEGACY}/contact.component.ts#ContactComponent.clear [head] ${legacy}:3:43`,
      // `Account` imported as `app/core/account`, through src/tsconfig.app.json's `baseUrl`.
      `reference ${LEGACY}/core/account.ts#Account.email [both] ${legacy}:2:29`,
      `reference ${LEGACY}/core/account.ts#Account.verified [head] ${legacy}:3:24`,
    ]);
    const modern = 'apps/web/modern/src/app/profile.component.html';
    expect(edgesFrom(analysis, MODERN_HTML)).toEqual([
      `call @acme/badge#BadgeComponent [both] ${modern}:3:4`,
      // Angular 17 typings: `label`.
      `reference @acme/badge#BadgeComponent.label [both] ${modern}:3:16`,
      `reference ${MODERN}/core/account.ts#Account.email [both] ${modern}:1:21`,
      `reference ${MODERN}/core/account.ts#Account.verified [base] ${modern}:2:14`,
      `reference ${MODERN}/profile.component.ts#ProfileComponent.account [both] ${modern}:1:13`,
    ]);
  });
});
