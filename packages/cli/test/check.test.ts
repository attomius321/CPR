import { openRepo } from '@symbiote/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { guessCheck, treeAt, type Tree } from '../src/check.js';

/** A commit's root files as `guessCheck` reads them: names, and the text of each. */
const tree = (files: Record<string, string>): Tree => ({
  names: new Set(Object.keys(files)),
  read: (path) => Promise.resolve(files[path] ?? null),
});
const pkg = (value: object) => JSON.stringify(value);
const guess = (files: Record<string, string>) => guessCheck(tree(files));

describe('guessCheck (V24b)', () => {
  it("runs package.json's check script, else its test script, with the package manager", async () => {
    const scripts = { check: 'pnpm lint && vitest run', test: 'vitest run' };
    expect(
      await guess({ 'package.json': pkg({ packageManager: 'pnpm@12.8.1', scripts }) }),
    ).toEqual({ command: 'pnpm run check', source: 'package.json (scripts.check)' });
    expect(
      await guess({ 'package.json': pkg({ scripts: { test: 'ava' } }), 'yarn.lock': '' }),
    ).toEqual({ command: 'yarn run test', source: 'package.json (scripts.test)' });
  });

  it('takes the package manager from packageManager, else the lockfile, else npm', async () => {
    const run = async (files: Record<string, string>) => (await guess(files))?.command;
    const test = { scripts: { test: 't' } };
    // The field's name as given: zod's is nub.
    expect(await run({ 'package.json': pkg({ ...test, packageManager: 'nub@0.8.3' }) })).toBe(
      'nub run test',
    );
    expect(await run({ 'package.json': pkg({ ...test, packageManager: 'yarn@1.22.22' }) })).toBe(
      'yarn run test',
    );
    expect(await run({ 'package.json': pkg(test), 'pnpm-lock.yaml': '' })).toBe('pnpm run test');
    expect(await run({ 'package.json': pkg(test), 'bun.lock': '' })).toBe('bun run test');
    expect(await run({ 'package.json': pkg(test), 'bun.lockb': '' })).toBe('bun run test');
    expect(await run({ 'package.json': pkg(test), 'package-lock.json': '' })).toBe('npm run test');
    expect(await run({ 'package.json': pkg(test) })).toBe('npm run test');
    // A field that is not a name is not run.
    expect(
      await run({ 'package.json': pkg({ ...test, packageManager: 'rm -rf /' }), 'yarn.lock': '' }),
    ).toBe('yarn run test');
  });

  it("skips npm's placeholder test and a package.json that is not JSON, for the next rule", async () => {
    const placeholder = pkg({ scripts: { test: 'echo "Error: no test specified" && exit 1' } });
    expect(await guess({ 'package.json': placeholder })).toBeNull();
    expect(await guess({ 'package.json': placeholder, 'go.mod': 'module x' })).toEqual({
      command: 'go test ./...',
      source: 'go.mod',
    });
    expect(await guess({ 'package.json': '{ nope', 'go.mod': 'module x' })).toMatchObject({
      command: 'go test ./...',
    });
  });

  it("runs a Makefile's check target, else its test target, before any language's tool", async () => {
    const make = 'all: fmt test\n\nfmt:\n\tgofmt -l .\n\ntest:\n\tgo test ./...\n';
    expect(await guess({ Makefile: make, 'go.mod': 'module x' })).toEqual({
      command: 'make test',
      source: 'Makefile (test target)',
    });
    expect(await guess({ Makefile: `check: test\n${make}`, 'Cargo.toml': '' })).toEqual({
      command: 'make check',
      source: 'Makefile (check target)',
    });
    // No such target: the next rule. A target's name must start its line; `:=` sets a variable.
    expect(
      await guess({ Makefile: 'test := go\nbuild:\n\t@echo test: no\n', 'go.mod': 'module x' }),
    ).toEqual({
      command: 'go test ./...',
      source: 'go.mod',
    });
  });

  it('runs scripts/test.sh, then cargo, go and pytest by their manifests', async () => {
    expect(await guess({ 'scripts/test.sh': '', 'pyproject.toml': '' })).toEqual({
      command: 'bash scripts/test.sh',
      source: 'scripts/test.sh',
    });
    expect(
      await guess({ 'Cargo.toml': '[package]\nname = "rg"\n\n[workspace]\nmembers = []\n' }),
    ).toEqual({ command: 'cargo test --workspace', source: 'Cargo.toml ([workspace])' });
    expect(await guess({ 'Cargo.toml': '[package]\nname = "x"\n' })).toEqual({
      command: 'cargo test',
      source: 'Cargo.toml',
    });
    expect(await guess({ 'go.mod': 'module x' })).toEqual({
      command: 'go test ./...',
      source: 'go.mod',
    });
    expect(await guess({ 'pyproject.toml': '', 'uv.lock': '' })).toEqual({
      command: 'uv run pytest',
      source: 'pyproject.toml, uv.lock',
    });
    for (const file of ['pyproject.toml', 'setup.py', 'tox.ini', 'pytest.ini']) {
      expect(await guess({ [file]: '' })).toEqual({ command: 'python -m pytest', source: file });
    }
  });

  it('guesses nothing from other files', async () => {
    expect(await guess({})).toBeNull();
    expect(await guess({ 'README.md': 'npm test', 'AGENTS.md': 'pnpm check' })).toBeNull();
  });
});

describe('treeAt (V24b)', () => {
  const repos: TestRepo[] = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.cleanup();
  });

  it("reads a commit's root files, not the working copy's", async () => {
    const repo = createRepo();
    repos.push(repo);
    repo.write({
      'package.json': pkg({ scripts: { test: 'vitest run' } }),
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      'scripts/test.sh': 'exit 0\n',
      'src/a.ts': 'export const a = 1;\n',
    });
    const A = repo.commit('A');
    // Changed after the commit, not committed: not what a worktree at A gets.
    repo.write({ 'package.json': pkg({ scripts: { check: 'x' } }) });
    const at = await treeAt(await openRepo(repo.root), A);
    expect([...at.names].sort()).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'scripts',
      'scripts/test.sh',
      'src',
    ]);
    expect(await at.read('package.json')).toBe(pkg({ scripts: { test: 'vitest run' } }));
    expect(await at.read('missing.json')).toBeNull();
    expect(await guessCheck(at)).toEqual({
      command: 'pnpm run test',
      source: 'package.json (scripts.test)',
    });
  });
});
