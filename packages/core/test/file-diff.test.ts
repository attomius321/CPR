import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileDiff, listChangedFiles, openRepo, type ChangedFile } from '../src/index.js';
import { createRepo } from './helpers/git-repo.js';

/** The hunk headers and lines of a diff, without git's header lines (index, mode, ---/+++). */
function body(diff: string): string[] {
  const lines = diff.split('\n');
  const start = lines.findIndex((line) => line.startsWith('@@'));
  return start < 0 ? [] : lines.slice(start);
}

describe('fileDiff (V60)', () => {
  const repo = createRepo();
  afterAll(() => repo.cleanup());
  const long = (name: string) =>
    Array.from({ length: 12 }, (_, i) => `export const ${name}${i} = ${i};`).join('\n') + '\n';
  repo.write({
    'src/a.ts': long('a'),
    'src/old.ts': long('old'),
    'src/same.ts': long('same'),
    'src/gone.md': '# Gone\n\nText.\n',
    'run.sh': 'echo run\n',
    'crlf.txt': 'one\r\ntwo\r\n',
    'end.txt': 'one\ntwo\n',
  });
  writeFileSync(join(repo.root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  const base = repo.commit('Base');
  repo.git('mv', 'src/old.ts', 'src/new.ts');
  repo.git('mv', 'src/same.ts', 'src/moved.ts');
  repo.write({
    'src/a.ts': long('a').replace('export const a5 = 5;', 'export const a5 = 50;'),
    'src/new.ts': long('old').replace('export const old11 = 11;', 'export const old11 = 110;'),
    'docs/added.md': '# Added\n',
    'crlf.txt': 'one\r\nTWO\r\n',
    'end.txt': 'one\ntwo',
  });
  repo.git('rm', '--quiet', 'src/gone.md');
  chmodSync(join(repo.root, 'run.sh'), 0o755);
  writeFileSync(join(repo.root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02]));
  const head = repo.commit('Head');

  const diffOf = async (path: string) => {
    const git = await openRepo(repo.root);
    const files = await listChangedFiles(git, base, head);
    const file = files.find((f) => f.path === path);
    if (!file) throw new Error(`${path} not changed`);
    return fileDiff(git, base, head, file);
  };

  it('gives a modified file as one hunk of the whole file', async () => {
    const lines = body(await diffOf('src/a.ts'));
    expect(lines[0]).toBe('@@ -1,12 +1,12 @@');
    expect(lines.filter((l) => l.startsWith('@@'))).toHaveLength(1);
    expect(lines).toContain('-export const a5 = 5;');
    expect(lines).toContain('+export const a5 = 50;');
    expect(lines).toContain(' export const a0 = 0;');
    expect(lines).toContain(' export const a11 = 11;');
  });

  it('gives an added and a deleted file whole, against nothing', async () => {
    expect(body(await diffOf('docs/added.md'))).toEqual(['@@ -0,0 +1 @@', '+# Added', '']);
    expect(body(await diffOf('src/gone.md'))).toEqual([
      '@@ -1,3 +0,0 @@',
      '-# Gone',
      '-',
      '-Text.',
      '',
    ]);
  });

  it('gives a renamed file from its old path, with its edits', async () => {
    const diff = await diffOf('src/new.ts');
    expect(diff).toContain('rename from src/old.ts\nrename to src/new.ts');
    expect(body(diff)).toContain('+export const old11 = 110;');
    // A rename without edits has no hunk at all.
    const moved = await diffOf('src/moved.ts');
    expect(moved).toContain('similarity index 100%');
    expect(body(moved)).toEqual([]);
  });

  it("says a binary file differs, and gives a mode change's header only", async () => {
    expect(await diffOf('logo.png')).toContain('Binary files a/logo.png and b/logo.png differ');
    const mode = await diffOf('run.sh');
    expect(mode).toContain('old mode 100644\nnew mode 100755');
    expect(body(mode)).toEqual([]);
  });

  it("keeps a line's carriage return and says when the file ends without a newline", async () => {
    expect(body(await diffOf('crlf.txt'))).toEqual([
      '@@ -1,2 +1,2 @@',
      ' one\r',
      '-two\r',
      '+TWO\r',
      '',
    ]);
    expect(body(await diffOf('end.txt'))).toEqual([
      '@@ -1,2 +1,2 @@',
      ' one',
      '-two',
      '+two',
      '\\ No newline at end of file',
      '',
    ]);
  });

  it('gives nothing for a file the two commits do not differ in', async () => {
    const git = await openRepo(repo.root);
    const same: ChangedFile = { status: 'modified', path: 'end.txt' };
    expect(await fileDiff(git, head, head, same)).toBe('');
  });
});
