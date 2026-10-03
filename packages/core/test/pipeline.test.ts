import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  analyzeDirectories,
  analyzeGit,
  buildGraph,
  isTestFile,
  listChangedFilesInDirectories,
  type SymbolChange,
} from '../src/index.js';
import { createRepo, tempDir } from './helpers/git-repo.js';

const fixture = (name: string, side: 'base' | 'head') =>
  fileURLToPath(new URL(`./fixtures/diff/${name}/${side}`, import.meta.url));

const describeChange = (c: SymbolChange) => {
  const flags = c.delta
    ? Object.entries(c.delta)
        .filter(([, on]) => on)
        .map(([name]) => name)
    : [];
  const moved = c.previousId ? ` ← ${c.previousId}` : '';
  return `${c.status.padEnd(9)} ${c.id}${moved}${flags.length ? ` [${flags.join(', ')}]` : ''}`;
};

describe('analyzeDirectories', () => {
  it('diffs symbols across changed files, with moves and renames', async () => {
    const analysis = await analyzeDirectories(
      fixture('service', 'base'),
      fixture('service', 'head'),
    );
    expect(analysis.files).toEqual([
      { status: 'modified', path: 'README.md' },
      { status: 'deleted', path: 'src/old-utils.ts' },
      { status: 'added', path: 'src/text/slug.ts' },
      { status: 'modified', path: 'src/user.ts' },
    ]);
    await expect(`${analysis.changes.map(describeChange).join('\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/pipeline-service.txt',
    );
  });
});

describe('edges and context', () => {
  it('connects changed symbols to callers and callees on both sides', async () => {
    const analysis = await analyzeDirectories(
      fixture('callers', 'base'),
      fixture('callers', 'head'),
    );
    expect(analysis.changes.filter((c) => c.status !== 'unchanged').map(describeChange)).toEqual([
      'modified  src/math.ts#add [signature, body]',
      'removed   src/math.ts#legacy',
      'added     src/math.ts#triple',
    ]);
    expect(analysis.edges.map((e) => `${e.from} -${e.kind}-> ${e.to} (${e.side})`)).toEqual([
      'src/app.ts#old -call-> src/math.ts#legacy (base)',
      'src/app.ts#total -call-> src/math.ts#add (both)',
      'src/math.ts#legacy -call-> src/math.ts#add (base)',
      'src/math.ts#triple -call-> src/math.ts#add (head)',
    ]);
    expect(analysis.context.map((c) => `${c.kind} ${c.id}`)).toEqual([
      'function src/app.ts#old',
      'function src/app.ts#total',
    ]);
    const total = analysis.edges.find((e) => e.from === 'src/app.ts#total');
    expect(total?.sites).toEqual({
      base: [{ file: 'src/app.ts', line: 4, col: 40 }],
      head: [{ file: 'src/app.ts', line: 4, col: 40 }],
    });
  });
});

describe('detectors', () => {
  it('flags removed-but-used, changed signatures and orphans', async () => {
    const analysis = await analyzeDirectories(
      fixture('detectors', 'base'),
      fixture('detectors', 'head'),
    );
    expect(analysis.findings.map((f) => `${f.id} ${f.severity} ${f.rule} ${f.symbol}`)).toEqual([
      'f1 error removed-still-referenced src/shapes.ts#Canvas.clear',
      'f2 warning orphan-added src/shapes.ts#perimeter',
      'f3 warning orphan-added src/shapes.ts#tools',
      'f4 info orphan-added src/shapes.ts#volume',
      // Only an optional member was added: compatible, so not a warning.
      'f5 info signature-changed src/shapes.ts#Shape',
    ]);

    const [removed, , , , signature] = analysis.findings;
    // legacy.js calls an untyped `canvas.clear()` it never resolved: not counted.
    expect(removed?.related).toEqual(['src/app.ts#render']);
    expect(removed?.data).toMatchObject({ certainty: 'resolved' });
    expect(signature?.data).toEqual({
      callers: 4,
      updated: 2,
      untouched: 2,
      untouchedElsewhere: 0,
      tests: 0,
      untouchedTests: 0,
      compatibility: 'compatible',
    });
    expect(signature?.related).toEqual([
      'src/shapes.ts#Canvas.draw',
      'src/shapes.ts#area',
      'src/shapes.ts#perimeter',
      'src/shapes.ts#volume',
    ]);
    // Pen.use overrides Tool.use: called through the base type, never an orphan.
    expect(analysis.findings.some((f) => f.symbol.includes('Pen'))).toBe(false);
  });

  it('reports removed exports still imported', async () => {
    const analysis = await analyzeDirectories(
      fixture('callers', 'base'),
      fixture('callers', 'head'),
    );
    const removed = analysis.findings.find((f) => f.rule === 'removed-still-referenced');
    expect(removed).toMatchObject({
      severity: 'error',
      symbol: 'src/math.ts#legacy',
      related: ['src/app.ts#old'],
    });
    expect(analysis.findings.map((f) => `${f.rule} ${f.symbol}`)).toEqual([
      'removed-still-referenced src/math.ts#legacy',
      'orphan-added src/math.ts#triple',
      'signature-changed src/math.ts#add',
    ]);
  });

  it('reports renamed or moved symbols still used by their old name or place', async () => {
    const root = tempDir();
    const body =
      '{\n  const total = items.reduce((sum, item) => sum + item.price * item.count, 0);\n' +
      '  return Math.round(total * 100) / 100;\n}\n';
    const signature = '(items: { price: number; count: number }[]): number ';
    const caller =
      "import { computeTotal } from './cart';\nexport const total = computeTotal([]);\n";
    const side = (name: string, files: Record<string, string>) => {
      mkdirSync(join(root, name, 'src'), { recursive: true });
      for (const [path, text] of Object.entries(files)) writeFileSync(join(root, name, path), text);
      return join(root, name);
    };
    try {
      const analysis = await analyzeDirectories(
        side('base', {
          'src/cart.ts': `export function computeTotal${signature}${body}`,
          'src/b.ts': caller,
        }),
        side('head', {
          'src/cart.ts': `export function sumPrices${signature}${body}`,
          'src/b.ts': caller,
        }),
      );
      expect(analysis.changes.map((c) => [c.id, c.previousId])).toEqual([
        ['src/cart.ts#sumPrices', 'src/cart.ts#computeTotal'],
      ]);
      expect(analysis.findings).toMatchObject([
        {
          rule: 'removed-still-referenced',
          severity: 'error',
          symbol: 'src/cart.ts#sumPrices',
          message:
            'computeTotal was renamed to sumPrices, but 1 symbol still uses the old name: total',
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('repositories with several projects', () => {
  // Two apps two folders down, nothing at the root, both mapping `@app/*` to their own sources.
  // `a` renames UserService.fullName; its callers (one through `@app/…`, one through `baseUrl`)
  // still use the old name. `b` has a class of the same name, loaded through a solution-style
  // tsconfig (`files: []` and references).
  const A = 'apps/web/a/src/app';
  const B = 'apps/web/b/src/app';

  it('resolves each file with the paths and baseUrl of its own project', async () => {
    const analysis = await analyzeDirectories(
      fixture('multi-project', 'base'),
      fixture('multi-project', 'head'),
    );
    expect(analysis.findings.map((f) => [f.severity, f.rule, f.symbol, f.related])).toEqual([
      [
        'error',
        'removed-still-referenced',
        `${A}/core/user.service.ts#UserService.displayName`,
        [`${A}/header.ts#title`, `${A}/profile.ts#greet`],
      ],
    ]);
    const edges = analysis.edges.map((e) => `${e.from} -${e.kind}-> ${e.to} (${e.side})`);
    // `b`'s alias reaches `b`'s class, never `a`'s.
    expect(edges).toContain(
      `${B}/menu.ts#label -call-> ${B}/core/user.service.ts#UserService.fullName (both)`,
    );
    expect(edges.filter((e) => e.startsWith(`${B}/`) && e.includes(`${A}/`))).toEqual([]);
    expect(analysis.warnings).toEqual([]);
  });
});

describe('public API and test users', () => {
  it('flags public API that breaks outside the repo, and sets stale tests apart', async () => {
    const analysis = await analyzeDirectories(
      fixture('public-api', 'base'),
      fixture('public-api', 'head'),
    );
    expect(
      analysis.findings.map((f) => `${f.severity} ${f.rule} ${f.symbol}: ${f.message}`),
    ).toEqual([
      "warning exported-api-changed src/legacy.ts#legacy: legacy was removed from the package's public API",
      'warning exported-api-changed src/parse.ts#parse: parse is public API and its new signature may break code outside the repo',
      // A private member is not public API, so removing Parser.cache is fine.
      "warning exported-api-changed src/parse.ts#Parser.reset: Parser.reset was removed from the package's public API",
      // main (production code) was not updated: still a warning.
      'warning signature-changed src/parse.ts#parse: parse changed its signature; 1 of 2 users not updated: main · 1 test user, 1 not updated',
      // Only a test is stale, and the test run will say so: information.
      'info signature-changed src/parse.ts#internalHelper: internalHelper changed its signature; its only user was updated · 1 test user, 1 not updated',
    ]);
  });

  it('leaves packages that are not published alone', async () => {
    const dirs = (['base', 'head'] as const).map((side) => {
      const dir = tempDir();
      cpSync(fixture('public-api', side), dir, { recursive: true });
      writeFileSync(
        join(dir, 'package.json'),
        '{ "name": "app", "private": true, "main": "src/index.ts" }',
      );
      return dir;
    });
    const analysis = await analyzeDirectories(dirs[0] as string, dirs[1] as string);
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    expect(analysis.findings.map((f) => f.rule)).toEqual([
      'signature-changed',
      'signature-changed',
    ]);
  });
});

describe('isTestFile', () => {
  it('knows test files by their path', () => {
    for (const path of [
      'src/a.test.ts',
      'src/a.spec.tsx',
      'src/a.test-d.ts',
      'src/__tests__/a.ts',
      'test/a.ts',
      'packages/x/tests/a.mjs',
      'e2e/flow.ts',
    ]) {
      expect(isTestFile(path), path).toBe(true);
    }
    for (const path of ['src/testing.ts', 'src/contest/a.ts', 'src/latest.ts', 'src/attest.ts']) {
      expect(isTestFile(path), path).toBe(false);
    }
  });
});

describe('listChangedFilesInDirectories', () => {
  it('reports nothing for identical folders', async () => {
    const base = fixture('service', 'base');
    expect(await listChangedFilesInDirectories(base, base)).toEqual([]);
  });

  it('detects renames of identical files', async () => {
    const base = tempDir();
    const head = tempDir();
    try {
      writeFileSync(join(base, 'a.ts'), 'export const a = 1;\n');
      writeFileSync(join(head, 'b.ts'), 'export const a = 1;\n');
      expect(await listChangedFilesInDirectories(base, head)).toEqual([
        { status: 'renamed', path: 'b.ts', previousPath: 'a.ts', similarity: 100 },
      ]);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(head, { recursive: true, force: true });
    }
  });
});

describe('analyzeGit', () => {
  const repo = createRepo();
  const cacheDir = tempDir();
  afterAll(() => {
    repo.cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('follows git file renames into symbol moves', async () => {
    const body = (n: number) =>
      `export function work(items: number[]) {\n  const total = items.reduce((a, b) => a + b, 0);\n  return total * ${n};\n}\n\nexport const LIMIT = 10;\n`;
    repo.write({ 'src/a.ts': body(1), 'notes.md': 'x\n' });
    repo.commit('base');
    repo.git('mv', 'src/a.ts', 'src/b.ts');
    repo.write({ 'src/b.ts': body(2) });
    repo.commit('head');

    const analysis = await analyzeGit({ cwd: repo.root, base: 'HEAD~1', head: 'HEAD', cacheDir });
    expect(analysis.files).toEqual([
      {
        status: 'renamed',
        path: 'src/b.ts',
        previousPath: 'src/a.ts',
        similarity: expect.any(Number) as number,
      },
    ]);
    expect(analysis.changes.map(describeChange)).toEqual([
      'modified  src/b.ts#work ← src/a.ts#work [body, moved]',
      'modified  src/b.ts#LIMIT ← src/a.ts#LIMIT [moved]',
    ]);
  });

  it('reads .cprignore from the working folder, not from the analyzed commits', async () => {
    const other = createRepo();
    try {
      // The commit's own .cprignore says something else; the working folder's is not committed.
      other.write({
        '.cprignore': 'service.ts\n',
        'apps/admin/src/service.ts': 'export const a = 1;\n',
        'apps/admin/src/interfaces/user.ts': 'export interface User { id: number }\n',
      });
      const base = other.commit('base');
      other.write({
        'apps/admin/src/service.ts': 'export const a = 2;\n',
        'apps/admin/src/interfaces/user.ts': 'export interface User { id: string }\n',
      });
      other.commit('head');
      other.write({ '.cprignore': '# local\ninterfaces/\n' });

      const analysis = await analyzeGit({ cwd: other.root, base, head: 'HEAD', cacheDir });
      expect(analysis.ignored).toEqual(['apps/admin/src/interfaces/user.ts']);
      expect(analysis.changes.map((c) => c.id)).toEqual(['apps/admin/src/service.ts#a']);
    } finally {
      other.cleanup();
    }
  });

  it('skips loading projects when no source file changed', async () => {
    repo.write({ 'notes.md': 'y\n' });
    repo.commit('docs only');
    const analysis = await analyzeGit({ cwd: repo.root, base: 'HEAD~1', head: 'HEAD', cacheDir });
    expect(analysis.files).toEqual([{ status: 'modified', path: 'notes.md' }]);
    expect(analysis.changes).toEqual([]);
  });
});

describe('analyzeGit with since', () => {
  const repo = createRepo();
  const cacheDir = tempDir();
  afterAll(() => {
    repo.cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  const fn = (name: string, body: string) =>
    `export function ${name}(x: number) {\n  return ${body};\n}\n`;

  it('marks symbols new, updated or the same as in the earlier version, across a rebase', async () => {
    repo.write({ 'src/a.ts': fn('f', 'x + 1') + fn('g', 'x * 2') + fn('h', 'x - 1') });
    repo.commit('base');
    // v1: f and h change, k is added.
    repo.git('switch', '--quiet', '--create', 'v1');
    repo.write({
      'src/a.ts': fn('f', 'x + 2') + fn('g', 'x * 2') + fn('h', 'x - 2') + fn('k', 'x'),
    });
    repo.commit('v1');
    // main moves on; v2 is rebuilt on it: f the same, g now changed, h left alone, k reworked.
    repo.git('switch', '--quiet', 'main');
    repo.write({ 'src/b.ts': fn('unrelated', 'x') });
    repo.commit('main moves on');
    repo.git('switch', '--quiet', '--create', 'v2');
    repo.write({
      'src/a.ts': fn('f', 'x + 2') + fn('g', 'x * 3') + fn('h', 'x - 1') + fn('k', '-x'),
    });
    repo.commit('v2');

    const analysis = await analyzeGit({
      cwd: repo.root,
      base: 'main',
      head: 'v2',
      since: 'v1',
      cacheDir,
    });
    expect(analysis.since).toMatchObject({
      ref: 'v1',
      symbols: { 'src/a.ts#f': 'same', 'src/a.ts#g': 'new', 'src/a.ts#k': 'updated' },
      dropped: ['src/a.ts#h'],
    });
    const graph = buildGraph(analysis, { generator: { name: 'cpr', version: 'test' } });
    expect(graph.since).toEqual({ ref: 'v1', sha: analysis.since?.sha, dropped: ['src/a.ts#h'] });
    expect(graph.nodes.find((n) => n.id === 'src/a.ts#g')?.since).toBe('new');
  });
});
