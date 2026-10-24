import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeDirectories, typescriptAdapter, type Analysis } from '../src/index.js';
import { selectorClasses } from '../src/lang/css/classes.js';

const fixture = (name: string, side: 'base' | 'head') =>
  fileURLToPath(new URL(`./fixtures/diff/${name}/${side}`, import.meta.url));

const edgesOf = (analysis: Analysis) =>
  analysis.edges
    .map((e) => `${e.from} -${e.kind}-> ${e.to} [${e.side}${e.possible ? ', possible' : ''}]`)
    .sort();

const findingsOf = (analysis: Analysis) =>
  analysis.findings.map((f) => `${f.severity} ${f.rule} ${f.symbol} — ${f.message}`);

describe('markup that uses stylesheets', () => {
  it('links rendered classes and script tokens to the rules and properties they reach', async () => {
    const analysis = await analyzeDirectories(fixture('markup', 'base'), fixture('markup', 'head'));
    expect(edgesOf(analysis)).toEqual(
      [
        'src/Other.tsx#Other -reference-> src/ui/controls.css#.list .row:hover [both]',
        'src/Other.tsx#Other -reference-> src/ui/controls.css#.row [both]',
        'src/Row.tsx#Row -reference-> src/Card.module.css#.title [both]',
        'src/Row.tsx#Row -reference-> src/ui/controls.css#.badge-new [base]',
        'src/Row.tsx#Row -reference-> src/ui/controls.css#.row [both]',
        'src/Row.tsx#Row -reference-> src/ui/controls.css#.selected .icon [both]',
        'src/Row.tsx#Row -reference-> src/ui/tokens.css#:root › --accent [both]',
        'src/Row.tsx#highlight -reference-> src/ui/controls.css#.selected .icon [both, possible]',
        'src/ui/controls.css#.list .row:hover -reference-> src/ui/tokens.css#:root › --hover [base]',
        'src/ui/controls.css#.selected .icon -reference-> src/ui/tokens.css#:root › --accent [both]',
      ].sort(),
    );
    const row = analysis.edges.find(
      (e) => e.from === 'src/Row.tsx#Row' && e.to === 'src/ui/controls.css#.row',
    );
    expect(row?.sites.head).toEqual([{ file: 'src/Row.tsx', line: 5, col: 22 }]);
  });

  it('warns when a removed rule leaves its class in markup, not when a script sets a token', async () => {
    const analysis = await analyzeDirectories(fixture('markup', 'base'), fixture('markup', 'head'));
    expect(findingsOf(analysis)).toEqual([
      'warning removed-still-referenced src/ui/controls.css#.badge-new — .badge-new was removed but is still used by 1 symbol: Row',
      'warning removed-still-referenced src/ui/tokens.css#:root › --hover — :root › --hover was removed but is still used by 1 symbol: .list .row:hover',
    ]);
  });

  it('changes nothing for TypeScript alone', async () => {
    const analysis = await analyzeDirectories(
      fixture('markup', 'base'),
      fixture('markup', 'head'),
      {
        adapter: typescriptAdapter,
      },
    );
    expect(edgesOf(analysis)).toEqual([]);
    expect(analysis.changes.filter((c) => c.status !== 'unchanged').map((c) => c.id)).toEqual([
      'src/Other.tsx#Other',
    ]);
  });
});

describe('selectorClasses', () => {
  it.each([
    ['.row', ['row subject']],
    ['.list .row:hover', ['list', 'row subject']],
    ['.a.b > .c, .b', ['a', 'b subject', 'c subject']],
    ['.card:not(.disabled)', ['card subject']],
    ['.card:has(.icon)', ['card subject', 'icon']],
    [':is(.a, .b) .c', ['a', 'b', 'c subject']],
    ['.md\\:flex', ['md:flex subject']],
    ['[data-x=".y"] .z', ['z subject']],
    ['.icon-#{$name}', []],
  ])('%s', (selector, expected) => {
    expect(selectorClasses(selector).map((c) => `${c.name}${c.subject ? ' subject' : ''}`)).toEqual(
      expected,
    );
  });
});
