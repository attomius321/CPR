import { SCHEMA_VERSION } from '@cpr/core';
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBranchedRepo, tempDir } from '../../core/test/helpers/git-repo.js';
import { run } from '../src/main.js';

async function cpr(
  argv: string[],
  cwd = process.cwd(),
  whileRunning: (stdout: () => string) => Promise<void> = () => Promise.resolve(),
) {
  let stdout = '';
  let stderr = '';
  const opened: string[] = [];
  const code = await run(argv, {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    openUrl: (url) => opened.push(url),
    waitForExit: () => whileRunning(() => stdout),
    env: process.env,
  });
  return { code, stdout, stderr, opened };
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

  it('prints the graph JSON with --json and writes it with --out', async () => {
    const { code, stdout } = await cpr(
      ['diff', 'main', 'feature', '--json', '--out', 'graph.json'],
      repo.root,
    );
    expect(code).toBe(0);
    const graph = JSON.parse(stdout) as { schemaVersion: string; stats: { durationMs: number } };
    expect(graph.schemaVersion).toBe(SCHEMA_VERSION);
    expect(graph.stats.durationMs).toBeGreaterThan(0);
    expect(readFileSync(join(repo.root, 'graph.json'), 'utf8')).toBe(stdout);
    rmSync(join(repo.root, 'graph.json'));
  });

  it('fails with --fail-on when a finding is severe enough', async () => {
    // The branch adds an unused export: one orphan-added warning.
    expect((await cpr(['diff', 'main', 'feature', '--fail-on', 'error'], repo.root)).code).toBe(0);
    const warning = await cpr(['diff', 'main', 'feature', '--fail-on', 'warning'], repo.root);
    expect(warning.code).toBe(1);
    expect(warning.stderr).toContain("1 finding at or above 'warning'");
    expect((await cpr(['diff', 'main', 'feature', '--fail-on', 'loud'], repo.root)).code).toBe(2);
  });

  it('serves the graph and sources with cpr view', async () => {
    const viewer = tempDir();
    writeFileSync(join(viewer, 'index.html'), '<!doctype html><title>viewer</title>');
    process.env.CPR_VIEWER_DIR = viewer;
    try {
      const seen: Record<string, string> = {};
      const result = await cpr(['view', 'main', 'feature'], repo.root, async (stdout) => {
        const url = /CPR viewer: (\S+)/.exec(stdout())?.[1] ?? '';
        for (const path of [
          '',
          'api/graph',
          'api/source?side=head&file=src/a.ts',
          'api/source?side=base&file=src/a.ts',
        ]) {
          const response = await fetch(new URL(path, url));
          seen[path] = `${response.status} ${(await response.text()).slice(0, 40)}`;
        }
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('4 files · 3 symbols changed · 1 findings');
      expect(result.opened).toHaveLength(1);
      expect(seen['']).toBe('200 <!doctype html><title>viewer</title>');
      expect(seen['api/graph']).toMatch(/^200 \{"schemaVersion":"0\.1\.0"/);
      expect(seen['api/source?side=head&file=src/a.ts']).toBe('200 export const a = 2;\n');
      expect(seen['api/source?side=base&file=src/a.ts']).toBe('200 export const a = 1;\n');
    } finally {
      delete process.env.CPR_VIEWER_DIR;
      rmSync(viewer, { recursive: true, force: true });
    }
  });

  it('does not open the browser with --no-open', async () => {
    const viewer = tempDir();
    writeFileSync(join(viewer, 'index.html'), '');
    process.env.CPR_VIEWER_DIR = viewer;
    try {
      const result = await cpr(['view', 'main', 'feature', '--no-open'], repo.root);
      expect(result.opened).toEqual([]);
    } finally {
      delete process.env.CPR_VIEWER_DIR;
      rmSync(viewer, { recursive: true, force: true });
    }
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
