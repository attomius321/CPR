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
