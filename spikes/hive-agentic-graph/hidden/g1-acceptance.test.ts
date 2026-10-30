// HV1's hidden acceptance tests for goal G1 (never shown to an agent): copied into a result's
// checkout as test/hidden-acceptance.test.ts, after `npm run build`.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as loc from '../src/index.js';

const { countLines, languageOf } = loc;
const scanFolder = (loc as Record<string, unknown>).scanFolder as (
  root: string,
) => Promise<Record<string, unknown>[]>;
const summarize = (loc as Record<string, unknown>).summarize as (
  files: Record<string, unknown>[],
) => Record<string, unknown>;

const FILES: Record<string, string> = {
  'a.ts': '// a\nexport const a = 1;\n\n/* b\n c */\nexport const b = 2; // c\n',
  'b.py': '# one\ndef f():\n    """doc"""\n    return 1\n',
  'nested/c.ts': 'export const c = 3;\n',
  'nested/deeper/d.md': '# Title\n\n<!-- note -->\ntext\n',
  'notes.unknownext': 'hello\n\nworld\n',
  'empty.ts': '',
  'Z.ts': 'export const z = 0;\n',
};

let root: string;
const cli = (args: string[], cwd = process.cwd()) =>
  spawnSync(process.execPath, [join(process.cwd(), 'dist/cli.js'), ...args], {
    cwd,
    encoding: 'utf8',
  });

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'loc-hidden-'));
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, '.git', 'HEAD.ts'), 'export const no = 1;\n');
  mkdirSync(join(root, 'node_modules', 'm'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'm', 'index.js'), 'module.exports = 1;\n');
  mkdirSync(join(root, 'src', 'node_modules'), { recursive: true });
  writeFileSync(join(root, 'src', 'node_modules', 'x.ts'), 'export const no = 1;\n');
  writeFileSync(join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x00, 0x47, 0x0a]));
  writeFileSync(join(root, 'late-nul.ts'), 'x'.repeat(9000) + '\u0000\n');
  symlinkSync(join(root, 'a.ts'), join(root, 'link.ts'));
  symlinkSync(join(root, 'nested'), join(root, 'linked-dir'));
});

const expected = (path: string, text: string) => {
  const language = languageOf(path);
  return { path, language: language?.name ?? 'Text', ...countLines(text, language?.syntax) };
};

describe('scanFolder', () => {
  it('is exported', () => {
    expect(typeof scanFolder).toBe('function');
  });

  it('lists every text file, counted, sorted by path; skips .git, node_modules, binaries and links', async () => {
    const files = { ...FILES, 'late-nul.ts': 'x'.repeat(9000) + '\u0000\n' };
    const want = Object.keys(files)
      .sort()
      .map((path) => expected(path, files[path]!));
    const got = await scanFolder(root);
    expect(got.map((f) => ({ ...f }))).toEqual(want);
  });
});

describe('summarize', () => {
  it('is exported', () => {
    expect(typeof summarize).toBe('function');
  });

  it('totals by language, most code first, then by name', () => {
    const f = (path: string, language: string, code: number, comments = 0, blank = 0) => ({
      path,
      language,
      lines: code + comments + blank,
      code,
      comments,
      blank,
    });
    const got = summarize([
      f('a.ts', 'TypeScript', 5, 2, 1),
      f('b.py', 'Python', 7),
      f('c.ts', 'TypeScript', 1, 0, 3),
      f('d.css', 'CSS', 6, 1),
      f('e.md', 'Markdown', 6),
      f('f.txt', 'Text', 0, 0, 2),
    ]);
    expect(got).toEqual({
      languages: [
        { language: 'Python', files: 1, lines: 7, code: 7, comments: 0, blank: 0 },
        { language: 'CSS', files: 1, lines: 7, code: 6, comments: 1, blank: 0 },
        { language: 'Markdown', files: 1, lines: 6, code: 6, comments: 0, blank: 0 },
        { language: 'TypeScript', files: 2, lines: 12, code: 6, comments: 2, blank: 4 },
        { language: 'Text', files: 1, lines: 2, code: 0, comments: 0, blank: 2 },
      ],
      total: { files: 6, lines: 34, code: 25, comments: 3, blank: 6 },
    });
  });

  it('gives empty totals for no files', () => {
    expect(summarize([])).toEqual({
      languages: [],
      total: { files: 0, lines: 0, code: 0, comments: 0, blank: 0 },
    });
  });
});

describe('the command', () => {
  it('prints the summary as JSON with --json', async () => {
    const run = cli([root, '--json']);
    expect(run.status).toBe(0);
    const want = summarize(await scanFolder(root));
    expect(run.stdout).toBe(`${JSON.stringify(want, null, 2)}\n`);
  });

  it('reads the current directory without a folder', async () => {
    const run = cli(['--json'], root);
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(summarize(await scanFolder(root)));
  });

  it('prints a table: the header, a row per language in order, Total last', async () => {
    const run = cli([root]);
    expect(run.status).toBe(0);
    const rows = run.stdout.split('\n').filter((row) => row.trim() !== '');
    const summary = summarize(await scanFolder(root)) as {
      languages: { language: string; files: number; lines: number; code: number }[];
      total: { files: number; lines: number; code: number; comments: number; blank: number };
    };
    const header = rows.find((row) => /Language/.test(row))!;
    expect(header).toMatch(/Language.*Files.*Lines.*Code.*Comments.*Blank/);
    const body = rows.slice(rows.indexOf(header) + 1).filter((row) => !/^[\s\-=+|]+$/.test(row));
    expect(body.length).toBe(summary.languages.length + 1);
    summary.languages.forEach((language, i) => {
      expect(body[i]!.trim().startsWith(language.language)).toBe(true);
    });
    const total = body.at(-1)!;
    expect(total.trim().startsWith('Total')).toBe(true);
    const numbers = total.match(/\d+/g)!.map(Number);
    const t = summary.total;
    expect(numbers).toEqual([t.files, t.lines, t.code, t.comments, t.blank]);
  });

  it('right-aligns the numbers', () => {
    const rows = cli([root])
      .stdout.split('\n')
      .filter((row) => /\d/.test(row) && !/^[\s\-=+|]+$/.test(row));
    const ends = new Set(rows.map((row) => row.trimEnd().length));
    expect(ends.size).toBe(1);
  });

  it('refuses a folder that does not exist, or a file', () => {
    for (const target of [join(root, 'nope'), join(root, 'a.ts')]) {
      const run = cli([target]);
      expect(run.status).toBe(2);
      expect(run.stderr.startsWith('loc: ')).toBe(true);
    }
  });

  it('refuses an unknown option', () => {
    const run = cli([root, '--nope']);
    expect(run.status).toBe(2);
    expect(run.stderr.startsWith('loc: ')).toBe(true);
  });
});
