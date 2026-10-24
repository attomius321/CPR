import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import {
  analyzeDirectories,
  directorySource,
  stylesheetAdapter,
  type SymbolChange,
  type SymbolDecl,
} from '../src/index.js';
import { tempDir } from './helpers/git-repo.js';

const fixture = (name: string, side: 'base' | 'head') =>
  fileURLToPath(new URL(`./fixtures/diff/${name}/${side}`, import.meta.url));

/** Writes stylesheets to a temp folder and extracts them: symbols by ID, and the warnings. */
async function extractStyles(files: Record<string, string>) {
  const root = tempDir();
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const revision = await stylesheetAdapter.load(directorySource(root), {
      files: Object.keys(files),
    });
    const symbols = stylesheetAdapter.extract(revision, Object.keys(files));
    return {
      symbols: new Map(symbols.map((s) => [s.id, s])),
      warnings: stylesheetAdapter.warnings(revision),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const brief = (s: SymbolDecl) => `${s.kind} ${s.id}${s.container ? ` ⊂ ${s.container}` : ''}`;

const TOKENS = `:root {
  --accent: #3b82f6;
  --text: #111;
}
:root[data-theme='light'] {
  --accent: #2563eb;
}
.button {
  color: var(--accent);
  padding: 0 8px;
}
.button:hover,
.button:focus-visible {
  color: red;
}
@media (max-width: 900px) {
  .sidenav {
    display: none;
  }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.row { color: red; }
.row { color: blue; }
@font-face {
  font-family: Geist;
  src: url(a.woff2);
}
`;

describe('stylesheet symbols', () => {
  it('are rules, custom properties and keyframes, named as CSS writes them', async () => {
    const { symbols } = await extractStyles({ 'src/a.css': TOKENS });
    expect([...symbols.values()].map(brief)).toEqual([
      'rule src/a.css#:root',
      'variable src/a.css#:root › --accent ⊂ src/a.css#:root',
      'variable src/a.css#:root › --text ⊂ src/a.css#:root',
      'rule src/a.css#:root[data-theme="light"]',
      'variable src/a.css#:root[data-theme="light"] › --accent ⊂ src/a.css#:root[data-theme="light"]',
      'rule src/a.css#.button',
      'rule src/a.css#.button:hover, .button:focus-visible',
      'rule src/a.css#@media (max-width: 900px) › .sidenav',
      'keyframes src/a.css#@keyframes spin',
      'rule src/a.css#.row',
      'rule src/a.css#.row (2)',
      'rule src/a.css#@font-face',
    ]);
    const button = symbols.get('src/a.css#.button');
    expect(button).toMatchObject({
      name: '.button',
      file: 'src/a.css',
      exported: true,
      language: 'css',
      range: { start: { line: 8, col: 1 }, end: { line: 11, col: 2 } },
      signature: '{ color: var(--accent); padding: 0 8px }',
    });
    expect(symbols.get('src/a.css#:root › --accent')).toMatchObject({
      name: '--accent',
      signature: '--accent: #3b82f6',
      range: { start: { line: 2, col: 3 }, end: { line: 2, col: 21 } },
    });
    expect(symbols.get('src/a.css#@keyframes spin')?.signature).toBe('@keyframes spin');
  });

  it('nests rules: a nested selector resolves against its parent, which contains it', async () => {
    const { symbols } = await extractStyles({
      'src/card.css': `.card {
  color: red;
  & .title { font-weight: 600; }
  &:hover { color: blue; }
  .body { padding: 8px; }
  > .icon { width: 16px; }
  @media (width < 600px) { color: green; }
}
.a, .b { .c { margin: 0; } }
`,
    });
    expect([...symbols.values()].map(brief)).toEqual([
      'rule src/card.css#.card',
      'rule src/card.css#.card .title ⊂ src/card.css#.card',
      'rule src/card.css#.card:hover ⊂ src/card.css#.card',
      'rule src/card.css#.card .body ⊂ src/card.css#.card',
      'rule src/card.css#.card > .icon ⊂ src/card.css#.card',
      'rule src/card.css#@media (width < 600px) › .card ⊂ src/card.css#.card',
      'rule src/card.css#.a, .b',
      'rule src/card.css#.a .c, .b .c ⊂ src/card.css#.a, .b',
    ]);
    // A nested rule is its own symbol, not part of its parent's body.
    expect(symbols.get('src/card.css#.card')?.signature).toBe('{ color: red }');
  });

  it('skips minified stylesheets and reports one that cannot be read', async () => {
    expect(stylesheetAdapter.matches('dist/app.min.css')).toBe(false);
    expect(stylesheetAdapter.matches('src/app.scss')).toBe(true);
    const { symbols, warnings } = await extractStyles({
      'src/ok.css': '.ok { color: red; }',
      'src/broken.css': '.broken { color: red;',
    });
    expect([...symbols.keys()]).toEqual(['src/ok.css#.ok']);
    expect(warnings).toEqual([
      expect.stringMatching(/^could not read src\/broken\.css: .*Unclosed block.* \(1:1\)$/),
    ]);
  });
});

describe('stylesheet hashes', () => {
  async function hashes(css: string, file = 'src/a.css') {
    const { symbols } = await extractStyles({ [file]: css });
    return Object.fromEntries(
      [...symbols.values()].map((s) => [s.id, `${s.hashes.signature}.${s.hashes.body}`]),
    );
  }

  const MESSY = `A>B+C~D,E   F{COLOR:#FFF;margin:.5PX 0 0 0;background:URL( "x.png" );font-family:"Geist",sans-serif}
[data-theme='light']  .x:nth-child( 2n+1 ){--accent:#3B82F6;transition:all .2S ease-in-out , color 1s}
@media (max-width:900px) and (min-width : 10px){.y{width:calc(100% - 10px);transform:translate( -50% ,-50% )}}
/* a comment */ .z{margin:-0.50em;line-height:1.50;content:'\\201C';grid-template-areas:"a b" "c d" /* inside */}
`;

  it.each([
    ['single quotes', { singleQuote: true }],
    ['double quotes', { singleQuote: false }],
  ])("ignore what Prettier's formatting changes (%s)", async (_name, options) => {
    const formatted = await format(MESSY, { parser: 'css', ...options });
    expect(formatted).not.toBe(MESSY);
    const before = await hashes(MESSY);
    expect(Object.keys(before)).toHaveLength(5);
    expect(await hashes(formatted)).toEqual(before);
  });

  it("ignore quote style inside a url() that holds an expression (Bitwarden's icon font)", async () => {
    expect(
      await hashes('@font-face { src: url($path + "a.svg") format("svg"); }', 'a.scss'),
    ).toEqual(await hashes("@font-face { src: url($path + 'a.svg') format('svg'); }", 'a.scss'));
  });

  it('change with a declaration, its order, a value or a selector', async () => {
    const base = await hashes('.a { color: red; margin: 0; }');
    expect(await hashes('.a { color: red; margin: 0 }')).toEqual(base);
    expect(await hashes('.a { margin: 0; color: red; }')).not.toEqual(base);
    expect(await hashes('.a { color: blue; margin: 0; }')).not.toEqual(base);
    expect(await hashes('.a { color: red; margin: 0 !important; }')).not.toEqual(base);
  });

  it("keep a custom property's value out of its rule's body", async () => {
    const base = await hashes(':root { --a: 1px; color: red; }');
    const head = await hashes(':root { --a: 2px; color: red; }');
    expect(head['src/a.css#:root']).toBe(base['src/a.css#:root']);
    expect(head['src/a.css#:root › --a']).not.toBe(base['src/a.css#:root › --a']);
  });
});

describe('stylesheet exposure', () => {
  it('keeps rules, custom properties, variables and keyframes from being orphans', async () => {
    const { symbols } = await extractStyles({
      'src/a.scss': `$primary: blue;
:root { --accent: red; }
.button { color: var(--accent); }
%base { margin: 0; }
@keyframes spin { to { opacity: 1; } }
@mixin themify { color: red; }
@function rem($px) { @return $px / 16px * 1rem; }
`,
    });
    const revision = await stylesheetAdapter.load(directorySource('.'));
    expect(
      Object.fromEntries(
        [...symbols.values()].map((s) => [s.id, stylesheetAdapter.exposure(revision, s) ?? null]),
      ),
    ).toEqual({
      'src/a.scss#$primary': 'framework',
      'src/a.scss#:root': 'framework',
      'src/a.scss#:root › --accent': 'framework',
      'src/a.scss#.button': 'framework',
      'src/a.scss#%base': null,
      'src/a.scss#@keyframes spin': 'framework',
      'src/a.scss#@mixin themify': null,
      'src/a.scss#@function rem': null,
    });
  });
});

describe('stylesheet changes', () => {
  const describeChange = (c: SymbolChange) => {
    const flags = c.delta
      ? Object.entries(c.delta)
          .filter(([, on]) => on)
          .map(([name]) => name)
      : [];
    const moved = c.previousId ? ` ← ${c.previousId}` : '';
    return `${c.status} ${c.id}${moved}${flags.length ? ` [${flags.join(', ')}]` : ''}`;
  };

  it('are diffed like any symbol: edits, moves, renames, and reformats that are no change', async () => {
    const analysis = await analyzeDirectories(fixture('css', 'base'), fixture('css', 'head'));
    expect(analysis.changes.filter((c) => c.status !== 'unchanged').map(describeChange)).toEqual([
      'modified src/ui/badge.css#.badge ← src/ui/controls.css#.badge [moved]',
      'modified src/ui/controls.css#.button [body]',
      'modified src/ui/controls.css#.chip ← src/ui/controls.css#.chip-old [signature, moved]',
      'removed src/ui/controls.css#.legacy',
      'added src/ui/controls.css#.new-thing',
      'modified src/ui/tokens.css#:root › --accent [body]',
      'removed src/ui/tokens.css#:root › --old',
      'added src/ui/tokens.css#:root › --new',
    ]);
    expect(analysis.warnings).toEqual([]);
  });
});
