import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openRepo } from '@symbiote/core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import {
  findVsCode,
  invocation,
  diffArgs,
  openArgs,
  runVsCode,
  vsCodeFolder,
  vsCodeOpener,
  type Host,
} from '../src/editor.js';

/** A machine with these files (contents) and environment. */
function host(
  platform: NodeJS.Platform,
  env: Record<string, string>,
  files: Record<string, string> = {},
): Host {
  return {
    platform,
    env,
    home:
      platform === 'win32' ? 'C:\\Users\\ada' : platform === 'darwin' ? '/Users/ada' : '/home/ada',
    isFile: (path) => Promise.resolve(path in files),
    readFile: (path) =>
      path in files ? Promise.resolve(files[path] as string) : Promise.reject(new Error('ENOENT')),
  };
}

// VS Code 1.141's bin\code.cmd: Code.exe and the cli.js of a folder named for the build.
const CODE_CMD_1_141 = [
  '@echo off',
  'setlocal',
  'set VSCODE_DEV=',
  'set ELECTRON_RUN_AS_NODE=1',
  '"%~dp0..\\Code.exe" "%~dp0..\\2a59476c9b\\resources\\app\\out\\cli.js" %*',
  'IF %ERRORLEVEL% NEQ 0 EXIT /b %ERRORLEVEL%',
  'endlocal',
].join('\r\n');
const CODE_CMD_OLD = CODE_CMD_1_141.replace('2a59476c9b\\', '');
const WIN_PATH = 'C:\\Windows\\system32;D:\\Microsoft VS Code\\bin';
const PATHEXT = '.COM;.EXE;.BAT;.CMD';

describe('findVsCode', () => {
  it('takes code from PATH (Linux, WSL, Remote SSH, containers: the terminal’s VS Code)', async () => {
    const machine = host('linux', { PATH: '/usr/bin:/opt/vs/bin' }, { '/opt/vs/bin/code': '' });
    expect(await findVsCode(machine)).toEqual({ command: '/opt/vs/bin/code', args: [] });
  });

  it('looks in the usual install places when PATH has none', async () => {
    const bundle = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
    expect(await findVsCode(host('darwin', { PATH: '/usr/bin' }, { [bundle]: '' }))).toEqual({
      command: bundle,
      args: [],
    });
    const mine = '/Users/ada/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
    expect(await findVsCode(host('darwin', { PATH: '' }, { [mine]: '' }))).toMatchObject({
      command: mine,
    });
    expect(
      await findVsCode(host('linux', { PATH: '/usr/bin' }, { '/snap/bin/code': '' })),
    ).toMatchObject({ command: '/snap/bin/code' });
  });

  it('runs what code.cmd runs on Windows: Code.exe with its cli.js, no shell', async () => {
    const files = {
      'D:\\Microsoft VS Code\\bin\\code': '#!/usr/bin/env sh',
      'D:\\Microsoft VS Code\\bin\\code.cmd': CODE_CMD_1_141,
    };
    expect(await findVsCode(host('win32', { Path: WIN_PATH, PATHEXT }, files))).toEqual({
      command: 'D:\\Microsoft VS Code\\Code.exe',
      args: ['D:\\Microsoft VS Code\\2a59476c9b\\resources\\app\\out\\cli.js'],
      env: { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: null },
    });
    const old = {
      'C:\\Users\\ada\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd': CODE_CMD_OLD,
    };
    const local = 'C:\\Users\\ada\\AppData\\Local';
    expect(
      await findVsCode(host('win32', { PATH: 'C:\\Windows', PATHEXT, LOCALAPPDATA: local }, old)),
    ).toMatchObject({
      command: 'C:\\Users\\ada\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      args: [
        'C:\\Users\\ada\\AppData\\Local\\Programs\\Microsoft VS Code\\resources\\app\\out\\cli.js',
      ],
    });
  });

  it('falls back to cmd.exe for a code.cmd of another shape', async () => {
    const files = { 'D:\\Microsoft VS Code\\bin\\code.cmd': '@echo off\r\ncall "%VSCODE%" %*' };
    expect(await findVsCode(host('win32', { PATH: WIN_PATH, PATHEXT }, files))).toEqual({
      command: 'D:\\Microsoft VS Code\\bin\\code.cmd',
      args: [],
      cmd: true,
    });
  });

  it('takes SYMBIOTE_CODE first: a path, or a command on PATH (Insiders, VSCodium, Cursor)', async () => {
    const files = { '/usr/bin/code': '', '/usr/bin/cursor': '', '/opt/code-oss': '' };
    expect(
      await findVsCode(host('linux', { PATH: '/usr/bin', SYMBIOTE_CODE: '/opt/code-oss' }, files)),
    ).toMatchObject({ command: '/opt/code-oss' });
    expect(
      await findVsCode(host('linux', { PATH: '/usr/bin', SYMBIOTE_CODE: 'cursor' }, files)),
    ).toMatchObject({ command: '/usr/bin/cursor' });
    expect(
      await findVsCode(host('linux', { PATH: '/usr/bin', SYMBIOTE_CODE: 'codium' }, files)),
    ).toBe(null);
  });

  it('finds nothing when VS Code is not installed', async () => {
    expect(await findVsCode(host('linux', { PATH: '/usr/bin:/bin' }))).toBe(null);
    expect(await findVsCode(host('win32', { PATH: 'C:\\Windows', PATHEXT }))).toBe(null);
  });
});

describe('invocation', () => {
  const args = openArgs('D:\\work\\R&D 100%', 'src/a.ts', 12, 3);

  it('opens the folder and goes to the file’s line and column', () => {
    expect(openArgs('/home/ada/repo', 'src/app/a.ts', 12, 3)).toEqual([
      '/home/ada/repo',
      '--goto',
      '/home/ada/repo/src/app/a.ts:12:3',
    ]);
  });

  it('opens the folder and two files side by side in it (V43)', () => {
    expect(diffArgs('/home/ada/repo', '/cache/a.ts', '/home/ada/repo/src/a.ts')).toEqual([
      '/home/ada/repo',
      '--diff',
      '/cache/a.ts',
      '/home/ada/repo/src/a.ts',
    ]);
  });

  it('passes paths to Code.exe as they are, with its environment', () => {
    const code = {
      command: 'D:\\VS\\Code.exe',
      args: ['D:\\VS\\cli.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
    expect(invocation(code, args, {})).toEqual({
      command: 'D:\\VS\\Code.exe',
      args: ['D:\\VS\\cli.js', ...args],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      verbatim: false,
    });
  });

  it('quotes every argument for cmd.exe, and refuses what cmd.exe would expand', () => {
    const code = { command: 'D:\\VS\\bin\\code.cmd', args: [], cmd: true };
    expect(
      invocation(code, ['D:\\R&D', '--goto', 'D:\\R&D\\a b.ts:1:1'], { ComSpec: 'C:\\cmd.exe' }),
    ).toEqual({
      command: 'C:\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        '""D:\\VS\\bin\\code.cmd" "D:\\R&D" "--goto" "D:\\R&D\\a b.ts:1:1""',
      ],
      env: {},
      verbatim: true,
    });
    expect(() => invocation(code, args, {})).toThrow(/%/);
  });
});

describe('runVsCode', () => {
  const dir = tempDir();
  const log = join(dir, 'args.json');
  /** A stand-in for `code`: writes its arguments, fails when asked to. */
  const fake = join(dir, 'code');
  beforeAll(() => {
    writeFileSync(
      fake,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify(process.argv.slice(2)));',
        'if (process.env.FAKE_FAIL) { console.error(process.env.FAKE_FAIL); process.exit(1); }',
        'if (process.env.FAKE_HANG) setTimeout(() => {}, 60000);',
      ].join('\n'),
    );
    chmodSync(fake, 0o755);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (env: Record<string, string>, timeoutMs?: number) =>
    runVsCode(
      { command: fake, args: ['first'], env: { FAKE_LOG: log, ...env }, verbatim: false },
      { ...(timeoutMs ? { timeoutMs } : {}) },
    );

  it('runs the command with its arguments and returns once it exits', async () => {
    await run({});
    expect(JSON.parse(readFileSync(log, 'utf8'))).toEqual(['first']);
  });

  it('reports what the command wrote when it fails', async () => {
    await expect(run({ FAKE_FAIL: 'Unable to connect to VS Code server' })).rejects.toThrow(
      'Unable to connect to VS Code server',
    );
  });

  it('does not wait for a command that keeps running (VS Code starting)', async () => {
    const started = Date.now();
    await run({ FAKE_HANG: '1' }, 300);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('says when the command does not exist', async () => {
    await expect(
      runVsCode({ command: join(dir, 'missing'), args: [], env: {}, verbatim: false }),
    ).rejects.toThrow(/not found/);
  });
});

describe('vsCodeOpener', () => {
  let repo: TestRepo;
  const dir = tempDir();
  const log = join(dir, 'args.json');
  const fake = join(dir, 'code');
  beforeAll(() => {
    writeFileSync(
      fake,
      "#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.FAKE_LOG, JSON.stringify(process.argv.slice(2)));\n",
    );
    chmodSync(fake, 0o755);
  });
  afterEach(() => repo.cleanup());
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const ten = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

  it('opens the repository folder at the line where the code is in the working copy', async () => {
    repo = createRepo();
    repo.write({ 'src/a.ts': ten });
    const sha = repo.commit('ten lines');
    repo.write({ 'src/a.ts': `// one\n// two\n${ten}` });
    process.env.FAKE_LOG = log;
    const open = vsCodeOpener(await openRepo(repo.root), { SYMBIOTE_CODE: fake, PATH: '' });

    expect(await open({ sha, file: 'src/a.ts', line: 4, column: 2 })).toEqual({
      opened: true,
      line: 6,
      how: 'exact',
      moved: true,
    });
    expect(JSON.parse(readFileSync(log, 'utf8'))).toEqual([
      repo.root,
      '--goto',
      `${repo.root}/src/a.ts:6:2`,
    ]);
  });

  it('opens nothing for a file the working copy lacks, or without VS Code', async () => {
    repo = createRepo();
    repo.write({ 'src/a.ts': ten });
    const sha = repo.commit('ten lines');
    repo.git('rm', '--quiet', 'src/a.ts');
    const git = await openRepo(repo.root);

    expect(
      await vsCodeOpener(git, { SYMBIOTE_CODE: fake })({
        sha,
        file: 'src/a.ts',
        line: 1,
        column: 1,
      }),
    ).toEqual({
      opened: false,
      reason: 'missing',
      message: 'src/a.ts is not in your working copy',
    });
    repo.git('checkout', 'HEAD', '--', 'src/a.ts');
    const nowhere = vsCodeOpener(git, { PATH: '' }, host('linux', { PATH: '' }));
    const result = await nowhere({ sha, file: 'src/a.ts', line: 1, column: 1 });
    expect(result).toMatchObject({ opened: false, reason: 'editor' });
    expect(!result.opened && result.message).toMatch(/not found.*SYMBIOTE_CODE/);
  });

  it("opens a branch checked out in a workspace's worktree there, at its line there (V18b)", async () => {
    repo = createRepo();
    repo.write({ 'src/a.ts': ten });
    const sha = repo.commit('ten lines');
    const worktree = join(tempDir(), 'feature');
    repo.git('worktree', 'add', '--quiet', '-b', 'feature', worktree, sha);
    // Two lines added above in the worktree only; the checkout's copy is as committed.
    writeFileSync(join(worktree, 'src/a.ts'), `// one\n// two\n${ten}`);
    process.env.FAKE_LOG = log;
    const open = vsCodeOpener(await openRepo(repo.root), { SYMBIOTE_CODE: fake, PATH: '' });
    expect(await open({ sha, file: 'src/a.ts', line: 4, column: 1 }, worktree)).toMatchObject({
      opened: true,
      line: 6,
    });
    expect(JSON.parse(readFileSync(log, 'utf8'))).toEqual([
      worktree,
      '--goto',
      `${worktree}/src/a.ts:6:1`,
    ]);
    rmSync(dirname(worktree), { recursive: true, force: true });
  });
});

describe('vsCodeFolder', () => {
  const dir = tempDir();
  const log = join(dir, 'args.json');
  const fake = join(dir, 'code');
  beforeAll(() => {
    writeFileSync(
      fake,
      "#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.FAKE_LOG, JSON.stringify(process.argv.slice(2)));\n",
    );
    chmodSync(fake, 0o755);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("opens a workspace's worktree folder in VS Code; says why it cannot", async () => {
    process.env.FAKE_LOG = log;
    expect(await vsCodeFolder({ SYMBIOTE_CODE: fake, PATH: '' })('/work/app.worktrees/x')).toEqual({
      opened: true,
    });
    expect(JSON.parse(readFileSync(log, 'utf8'))).toEqual(['/work/app.worktrees/x']);
    // A file in it, at a line (V29d): the folder's window, at the line.
    const at = { file: 'src/a b.ts', line: 12 };
    await vsCodeFolder({ SYMBIOTE_CODE: fake, PATH: '' })('/work/app.worktrees/x', at);
    expect(JSON.parse(readFileSync(log, 'utf8'))).toEqual([
      '/work/app.worktrees/x',
      '--goto',
      '/work/app.worktrees/x/src/a b.ts:12:1',
    ]);
    // Two files side by side (V43): a diff, in the folder's window.
    const sides = {
      left: '/cache/revisions/abc/src/a b.ts',
      right: '/work/app.worktrees/x/src/a b.ts',
    };
    await vsCodeFolder({ SYMBIOTE_CODE: fake, PATH: '' })('/work/app.worktrees/x', sides);
    expect(JSON.parse(readFileSync(log, 'utf8'))).toEqual([
      '/work/app.worktrees/x',
      '--diff',
      '/cache/revisions/abc/src/a b.ts',
      '/work/app.worktrees/x/src/a b.ts',
    ]);
    // One file as it is (a new one: nothing to compare), in the folder's window.
    const path = { path: '/cache/revisions/abc/src/new.ts' };
    await vsCodeFolder({ SYMBIOTE_CODE: fake, PATH: '' })('/work/app.worktrees/x', path);
    expect(JSON.parse(readFileSync(log, 'utf8'))).toEqual([
      '/work/app.worktrees/x',
      '/cache/revisions/abc/src/new.ts',
    ]);
    const nowhere = await vsCodeFolder({ PATH: '' }, host('linux', { PATH: '' }))('/w');
    expect(nowhere).toMatchObject({ opened: false });
    expect(!nowhere.opened && nowhere.message).toMatch(/not found.*SYMBIOTE_CODE/);
  });
});
