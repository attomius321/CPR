import { SCHEMA_VERSION } from '@cpr/core';
import { afterAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { createBranchedRepo, tempDir } from '../../core/test/helpers/git-repo.js';
import { run } from '../src/main.js';

async function cpr(argv: string[], cwd = process.cwd()) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr };
}

describe('cpr', () => {
  it('prints help with no arguments', async () => {
    const { code, stdout } = await cpr([]);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: cpr');
  });

  it('prints the version and schema version', async () => {
    const { code, stdout } = await cpr(['--version']);
    expect(code).toBe(0);
    expect(stdout).toMatch(
      new RegExp(`^cpr \\d+\\.\\d+\\.\\d+ \\(graph schema ${SCHEMA_VERSION}\\)\\n$`),
    );
  });

  it('rejects unknown commands with a usage error', async () => {
    const { code, stderr } = await cpr(['nope']);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown command 'nope'");
  });
});

describe('cpr diff', () => {
  const { repo, shas } = createBranchedRepo();
  // Keep worktree slots out of the real cache.
  const cacheDir = tempDir();
  const previousCacheDir = process.env.CPR_CACHE_DIR;
  process.env.CPR_CACHE_DIR = cacheDir;
  afterAll(() => {
    repo.cleanup();
    rmSync(cacheDir, { recursive: true, force: true });
    if (previousCacheDir === undefined) delete process.env.CPR_CACHE_DIR;
    else process.env.CPR_CACHE_DIR = previousCacheDir;
  });

  it('lists symbols changed since the merge-base, by file', async () => {
    const { code, stdout } = await cpr(['diff', 'main', 'feature'], repo.root);
    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        `main (${shas.main.slice(0, 7)}) → feature (${shas.feature.slice(0, 7)}), merge-base ${shas.root.slice(0, 7)}`,
        '4 files changed · 3 symbols changed: 1 added, 2 modified',
        '',
        'Findings',
        '  ⚠ orphan-added  src/added.ts#added',
        '      added is new and nothing references it',
        '',
        'M  src/a.ts',
        '     ~ variable    a  (body)',
        'A  src/added.ts',
        '     + variable    added',
        'D  src/gone.ts',
        'R  src/old.ts → src/new.ts',
        '     → function    old  (moved from src/old.ts#old)',
        '',
      ].join('\n'),
    );
  });

  it('defaults head to HEAD', async () => {
    const { code, stdout } = await cpr(['diff', 'feature'], repo.root);
    expect(code).toBe(0);
    expect(stdout).toContain('feature (');
    expect(stdout).toContain('→ HEAD (');
  });

  it('can skip the merge-base', async () => {
    const { stdout } = await cpr(['diff', 'main', 'feature', '--no-merge-base'], repo.root);
    expect(stdout).not.toContain('merge-base');
    expect(stdout).toContain('\nD  src/main-only.ts\n');
  });

  it('fails on unknown revisions', async () => {
    const { code, stderr } = await cpr(['diff', 'main', 'nope'], repo.root);
    expect(code).toBe(1);
    expect(stderr).toBe("cpr: unknown revision 'nope'\n");
  });

  it('reports usage errors', async () => {
    expect((await cpr(['diff'], repo.root)).code).toBe(2);
    expect((await cpr(['diff', '--bogus', 'main'], repo.root)).code).toBe(2);
    expect((await cpr(['diff', 'a', 'b', 'c'], repo.root)).stderr).toContain(
      "unexpected argument 'c'",
    );
  });
});
