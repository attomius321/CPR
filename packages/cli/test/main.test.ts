import { SCHEMA_VERSION } from '@cpr/core';
import { afterAll, describe, expect, it } from 'vitest';
import { createBranchedRepo } from '../../core/test/helpers/git-repo.js';
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
  afterAll(() => repo.cleanup());

  it('lists files changed since the merge-base', async () => {
    const { code, stdout } = await cpr(['diff', 'main', 'feature'], repo.root);
    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        `main (${shas.main.slice(0, 7)}) → feature (${shas.feature.slice(0, 7)}), merge-base ${shas.root.slice(0, 7)}`,
        '4 files changed',
        '  M  src/a.ts',
        '  A  src/added.ts',
        '  D  src/gone.ts',
        '  R  src/old.ts → src/new.ts',
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
    expect(stdout).toContain('  D  src/main-only.ts');
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
