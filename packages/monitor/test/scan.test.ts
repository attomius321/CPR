import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { codeMaps, scanCodebase } from '../src/scan.js';

const repos: TestRepo[] = [];
const repo = () => {
  const made = createRepo();
  repos.push(made);
  return made;
};
afterEach(() => {
  for (const made of repos.splice(0)) made.cleanup();
});

describe('scanCodebase', () => {
  it("reads every file of HEAD's commit, with its kind, language and lines", async () => {
    const r = repo();
    r.write({
      'src/a.ts': '// a\nexport const a = 1;\n\nexport const b = 2;\n',
      'src/deep/nested/b.css': '.b { color: red; }\n',
      'src/a.test.ts': "it('works', () => {});\n",
      'README.md': '# Title\n\nText.\n',
      'package.json': '{ "name": "x" }\n',
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    });
    const sha = r.commit('first');
    const map = await scanCodebase(r.root);
    expect(map).toMatchObject({ version: 1, commit: sha, branch: 'main' });
    expect(map.files).toEqual([
      {
        path: 'README.md',
        kind: 'docs',
        language: 'Markdown',
        lines: 3,
        code: 2,
        comments: 0,
        blank: 1,
      },
      {
        path: 'package.json',
        kind: 'data',
        language: 'JSON',
        lines: 1,
        code: 1,
        comments: 0,
        blank: 0,
      },
      {
        path: 'pnpm-lock.yaml',
        kind: 'aside',
        aside: 'lockfile',
        language: 'YAML',
        lines: 1,
        code: 1,
        comments: 0,
        blank: 0,
      },
      {
        path: 'src/a.test.ts',
        kind: 'test',
        language: 'TypeScript',
        lines: 1,
        code: 1,
        comments: 0,
        blank: 0,
      },
      {
        path: 'src/a.ts',
        kind: 'source',
        language: 'TypeScript',
        lines: 4,
        code: 2,
        comments: 1,
        blank: 1,
      },
      {
        path: 'src/deep/nested/b.css',
        kind: 'source',
        language: 'CSS',
        lines: 1,
        code: 1,
        comments: 0,
        blank: 0,
      },
    ]);
  });

  it('reads the commit, not the working tree', async () => {
    const r = repo();
    r.write({ 'a.ts': 'export const a = 1;\n' });
    const sha = r.commit('first');
    r.write({ 'a.ts': 'export const a = 1;\nexport const b = 2;\n', 'new.ts': 'x;\n' });
    const map = await scanCodebase(r.root);
    expect(map.commit).toBe(sha);
    expect(map.files.map((f) => [f.path, f.code])).toEqual([['a.ts', 1]]);
  });

  it('leaves out symlinks and submodules; sets aside binary files', async () => {
    const inner = repo();
    inner.write({ 'x.ts': 'x;\n' });
    inner.commit('inner');
    const r = repo();
    r.write({ 'a.ts': 'a;\n', 'img.ts': 'GIF89a\0\0\0' });
    symlinkSync('a.ts', join(r.root, 'link.ts'));
    r.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', inner.root, 'sub');
    r.commit('first');
    const map = await scanCodebase(r.root);
    expect(map.files.map((f) => f.path)).toEqual(['.gitmodules', 'a.ts', 'img.ts']);
    expect(map.files.find((f) => f.path === 'img.ts')).toMatchObject({
      kind: 'aside',
      aside: 'binary',
      lines: 0,
      code: 0,
    });
  });

  it('honours .gitattributes and .symbioteignore', async () => {
    const r = repo();
    r.write({
      '.gitattributes': 'api/** linguist-generated\nlib/parser.js linguist-vendored=true\n',
      '.symbioteignore': 'scratch/\n',
      'api/client.ts': 'x;\n',
      'lib/parser.js': 'x;\n',
      'scratch/try.ts': 'x;\n',
      'test/fixtures/case/a.ts': 'x;\n',
      'src/a.ts': 'x;\n',
    });
    r.commit('first');
    const kinds = Object.fromEntries(
      (await scanCodebase(r.root)).files.map((f) => [f.path, f.aside ?? f.kind]),
    );
    expect(kinds).toMatchObject({
      'api/client.ts': 'generated',
      'lib/parser.js': 'vendored',
      'scratch/try.ts': 'ignored',
      'test/fixtures/case/a.ts': 'ignored',
      'src/a.ts': 'source',
    });
  });

  it('counts text that is not UTF-8 by its newlines', async () => {
    const r = repo();
    // "café", a blank line, "x": é in Latin-1.
    writeFileSync(
      join(r.root, 'latin1.txt'),
      Buffer.from([0x63, 0x61, 0x66, 0xe9, 10, 10, 0x78, 10]),
    );
    r.commit('first');
    const [file] = (await scanCodebase(r.root)).files;
    expect(file).toMatchObject({ path: 'latin1.txt', lines: 3, code: 2, blank: 1 });
  });

  it('has no branch on a detached HEAD', async () => {
    const r = repo();
    r.write({ 'a.ts': 'a;\n' });
    const sha = r.commit('first');
    r.git('checkout', '--quiet', '--detach', sha);
    const map = await scanCodebase(r.root);
    expect(map.branch).toBeUndefined();
    expect(map.commit).toBe(sha);
  });
});

describe('codeMaps', () => {
  it('reads a commit once, and again only after HEAD moves', async () => {
    const r = repo();
    r.write({ 'a.ts': 'a;\n' });
    r.commit('first');
    const maps = codeMaps(r.root);
    const first = await maps.map();
    expect(await maps.map()).toBe(first);
    r.write({ 'b.ts': 'b;\n' });
    const second = r.commit('second');
    const moved = await maps.map();
    expect(moved.commit).toBe(second);
    expect(moved.files).toHaveLength(2);
  });
});
