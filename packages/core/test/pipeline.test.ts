import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  analyzeDirectories,
  analyzeGit,
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
      'f4 warning signature-changed src/shapes.ts#Shape',
      'f5 info orphan-added src/shapes.ts#volume',
    ]);

    const [removed, , , signature] = analysis.findings;
    // legacy.js calls an untyped `canvas.clear()` it never resolved: not counted.
    expect(removed?.related).toEqual(['src/app.ts#render']);
    expect(removed?.data).toMatchObject({ certainty: 'resolved' });
    expect(signature?.data).toEqual({ callers: 4, updated: 2, untouched: 2 });
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

  it('skips loading projects when no source file changed', async () => {
    repo.write({ 'notes.md': 'y\n' });
    repo.commit('docs only');
    const analysis = await analyzeGit({ cwd: repo.root, base: 'HEAD~1', head: 'HEAD', cacheDir });
    expect(analysis.files).toEqual([{ status: 'modified', path: 'notes.md' }]);
    expect(analysis.changes).toEqual([]);
  });
});
