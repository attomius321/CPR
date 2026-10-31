// HV1's hidden acceptance tests for goal G2 (never shown to an agent): copied into a result's
// checkout as test/hidden-acceptance.test.ts, after `npm run build`.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as loc from '../src/index.js';

type Matcher = (path: string, isFolder: boolean) => boolean;
const ignoreMatcher = (loc as Record<string, unknown>).ignoreMatcher as (
  root: string,
) => Promise<Matcher>;
const scanFolder = (loc as Record<string, unknown>).scanFolder as (
  root: string,
  options?: { ignore?: boolean },
) => Promise<{ path: string }[]>;

/** A folder with these files (path → text). */
function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'loc-hidden-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const matcher = async (ignore: string) => ignoreMatcher(folder({ '.locignore': ignore }));

describe('ignoreMatcher', () => {
  it('is exported', () => {
    expect(typeof ignoreMatcher).toBe('function');
  });

  it('ignores nothing without a .locignore', async () => {
    const m = await ignoreMatcher(folder({ 'a.ts': '' }));
    expect(m('a.ts', false)).toBe(false);
    expect(m('x/y.log', false)).toBe(false);
  });

  it('skips blank lines and comments; trims trailing spaces', async () => {
    const m = await matcher('# *.ts\n\n*.log   \n');
    expect(m('a.ts', false)).toBe(false);
    expect(m('a.log', false)).toBe(true);
    expect(m('# *.ts', false)).toBe(false);
  });

  it('matches a name with no slash at any depth', async () => {
    const m = await matcher('*.log\nbuild\n');
    expect(m('a.log', false)).toBe(true);
    expect(m('x/y/a.log', false)).toBe(true);
    expect(m('build', true)).toBe(true);
    expect(m('src/build', true)).toBe(true);
    expect(m('src/build/a.ts', false)).toBe(true);
    expect(m('builder.ts', false)).toBe(false);
    expect(m('a.log.ts', false)).toBe(false);
  });

  it('* and ? stop at a slash', async () => {
    const m = await matcher('/src/*.ts\n/a?c\n');
    expect(m('src/a.ts', false)).toBe(true);
    expect(m('src/x/a.ts', false)).toBe(false);
    expect(m('abc', false)).toBe(true);
    expect(m('a/c', false)).toBe(false);
    expect(m('abbc', false)).toBe(false);
  });

  it('anchors a pattern with a leading or middle slash to the root', async () => {
    const m = await matcher('/dist\nsrc/gen\n');
    expect(m('dist', true)).toBe(true);
    expect(m('dist/a.js', false)).toBe(true);
    expect(m('x/dist', true)).toBe(false);
    expect(m('x/dist/a.js', false)).toBe(false);
    expect(m('src/gen/a.ts', false)).toBe(true);
    expect(m('lib/src/gen/a.ts', false)).toBe(false);
  });

  it('matches folders only with a trailing slash', async () => {
    const m = await matcher('out/\n');
    expect(m('out', true)).toBe(true);
    expect(m('out', false)).toBe(false);
    expect(m('a/out', true)).toBe(true);
    expect(m('a/out/x.ts', false)).toBe(true);
  });

  it('** matches across folders', async () => {
    const m = await matcher('**/fixtures\nlogs/**\na/**/b\n');
    expect(m('fixtures', true)).toBe(true);
    expect(m('x/y/fixtures', true)).toBe(true);
    expect(m('x/y/fixtures/f.ts', false)).toBe(true);
    expect(m('logs/a.txt', false)).toBe(true);
    expect(m('logs/x/a.txt', false)).toBe(true);
    expect(m('a/b', false)).toBe(true);
    expect(m('a/x/b', false)).toBe(true);
    expect(m('a/x/y/b', false)).toBe(true);
    expect(m('a/x/c', false)).toBe(false);
    expect(m('b', false)).toBe(false);
  });

  it('includes again with !, the last match winning', async () => {
    const m = await matcher('*.log\n!keep.log\n');
    expect(m('a.log', false)).toBe(true);
    expect(m('keep.log', false)).toBe(false);
    expect(m('x/keep.log', false)).toBe(false);
    const n = await matcher('!keep.log\n*.log\n');
    expect(n('keep.log', false)).toBe(true);
  });

  it('cannot include a file again when a folder it is in is ignored', async () => {
    const m = await matcher('vendor/\n!vendor/keep.ts\n');
    expect(m('vendor', true)).toBe(true);
    expect(m('vendor/keep.ts', false)).toBe(true);
  });
});

describe('scanFolder and the command', () => {
  const files = {
    '.locignore': '*.log\nvendor/\n/gen\n!keep.log\n',
    'a.ts': 'export const a = 1;\n',
    'b.log': 'x\n',
    'keep.log': 'y\n',
    'vendor/v.ts': 'export const v = 1;\n',
    'src/vendor/w.ts': 'export const w = 1;\n',
    'gen/g.ts': 'export const g = 1;\n',
    'src/gen/h.ts': 'export const h = 1;\n',
  };

  it('leaves out what .locignore ignores, the file itself counted', async () => {
    const got = (await scanFolder(folder(files))).map((f) => f.path);
    expect(got).toEqual(['.locignore', 'a.ts', 'keep.log', 'src/gen/h.ts']);
  });

  it('counts everything with ignore: false', async () => {
    const got = (await scanFolder(folder(files), { ignore: false })).map((f) => f.path);
    expect(got).toEqual(Object.keys(files).sort());
  });

  it('the command ignores by default and counts everything with --no-ignore', () => {
    const root = folder(files);
    const cli = (args: string[]) =>
      spawnSync(process.execPath, [join(process.cwd(), 'dist/cli.js'), root, '--json', ...args], {
        encoding: 'utf8',
      });
    const ignoring = cli([]);
    expect(ignoring.status).toBe(0);
    expect(JSON.parse(ignoring.stdout).total.files).toBe(4);
    const all = cli(['--no-ignore']);
    expect(all.status).toBe(0);
    expect(JSON.parse(all.stdout).total.files).toBe(8);
  });
});
