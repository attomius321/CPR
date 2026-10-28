import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';

// `./install.sh` (IN1): the repository's own script and its steps, run on a checkout of fakes (a
// pnpm, corepack and npx that write down how they ran; a CLI that answers `--version`) and a home
// of its own. Only `sh`, `dirname` and `node` come from the machine.
const repo = fileURLToPath(new URL('../../..', import.meta.url));

let dir: string;
let root: string;
let home: string;
let tools: string;
let log: string;

/** A program in the tools' folder: a shell script that writes how it ran into the log. */
function tool(name: string, body: string): void {
  const path = join(tools, name);
  writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
  chmodSync(path, 0o755);
}

/** A pnpm 12, as `pnpm --version` says; `build` fails with FAIL_BUILD set. */
function pnpm(name = 'pnpm'): void {
  tool(
    name,
    `[ "$1" = "--version" ] && { echo 12.8.1; exit 0; }
[ "$1" = "build" ] && [ -n "$FAIL_BUILD" ] && { echo "build broke: src/x.ts(1,1)"; exit 2; }
exit 0`,
  );
}

beforeEach(() => {
  dir = tempDir();
  root = join(dir, 'Symbiote');
  home = join(dir, 'home');
  tools = join(dir, 'tools');
  log = join(dir, 'ran.log');
  for (const folder of [
    join(root, 'scripts'),
    join(root, 'packages/cli/dist'),
    join(root, 'packages/nexus/dist'),
    join(root, 'packages/desktop'),
    home,
    tools,
  ]) {
    mkdirSync(folder, { recursive: true });
  }
  copyFileSync(join(repo, 'install.sh'), join(root, 'install.sh'));
  copyFileSync(join(repo, 'scripts/install.mjs'), join(root, 'scripts/install.mjs'));
  writeFileSync(join(root, 'package.json'), '{ "packageManager": "pnpm@12.8.1" }\n');
  writeFileSync(join(root, 'packages/desktop/package.json'), '{ "name": "@symbiote/desktop" }\n');
  writeFileSync(
    join(root, 'packages/cli/dist/bin.js'),
    `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(log)}, 'symbiote ' + process.argv.slice(2).join(' ') + '\\n');
if (process.argv[2] === '--version') console.log('symbiote 0.0.0 (graph schema 9)');\n`,
  );
  writeFileSync(join(root, 'packages/nexus/dist/bin.js'), 'console.log("nexus");\n');
  symlinkSync(process.execPath, join(tools, 'node'));
  symlinkSync('/usr/bin/dirname', join(tools, 'dirname'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function install(args: string[] = [], env: Record<string, string> = {}) {
  const run = spawnSync('/bin/sh', [join(root, 'install.sh'), ...args], {
    env: { PATH: tools, HOME: home, ...env },
    encoding: 'utf8',
  });
  const ran = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  return { code: run.status, out: run.stdout, err: run.stderr, ran };
}

const command = (name: string) => join(home, '.local/bin', name);

describe('./install.sh', () => {
  it('installs in one command: dependencies, the build while Electron is fetched, the commands, the launcher', () => {
    pnpm();
    const { code, out, err, ran } = install();
    expect(err).toBe('');
    expect(code).toBe(0);
    const steps = ran.filter((line) => !line.endsWith('--version'));
    expect(steps[0]).toBe('pnpm install --frozen-lockfile');
    expect(steps.slice(1, 3).sort()).toEqual(['pnpm app:setup', 'pnpm build']);
    expect(steps[3]).toBe('symbiote app install');
    expect(ran).toContain('symbiote --version');

    for (const [name, target] of [
      ['symbiote', 'packages/cli/dist/bin.js'],
      ['symbiote-nexus', 'packages/nexus/dist/bin.js'],
    ] as const) {
      expect(statSync(command(name)).mode & 0o777).toBe(0o755);
      expect(readFileSync(command(name), 'utf8')).toBe(
        `#!/bin/sh\n# Symbiote's command, installed by ./install.sh from ${root}\n` +
          `exec node '${join(root, target)}' "$@"\n`,
      );
    }
    expect(
      spawnSync(command('symbiote-nexus'), [], { env: { PATH: tools } }).stdout.toString(),
    ).toBe('nexus\n');
    expect(out).toContain('symbiote 0.0.0 (graph schema 9)');
    // The fake checkout has no terminal package: said, with what it means.
    expect(out).toMatch(/Agents' terminals: off \(node-pty is not installed\)/);
    expect(out).toContain(`${join(home, '.local/bin')} is not on your PATH`);
    expect(out).toContain(`export PATH="${join(home, '.local/bin')}:$PATH"`);
  });

  it('with --no-app, fetches no Electron and adds no launcher', () => {
    pnpm();
    const { code, ran } = install(['--no-app']);
    expect(code).toBe(0);
    expect(ran.filter((line) => !line.endsWith('--version'))).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm build',
    ]);
    expect(existsSync(command('symbiote'))).toBe(true);
  });

  it("fetches Electron only when it is not there, and never by running Electron's code", () => {
    pnpm();
    // Electron 44's package downloads its binary when it is required without one.
    const electron = join(root, 'packages/desktop/node_modules/electron');
    mkdirSync(join(electron, 'dist'), { recursive: true });
    writeFileSync(join(electron, 'package.json'), '{ "name": "electron", "main": "index.js" }');
    writeFileSync(
      join(electron, 'index.js'),
      `require('fs').appendFileSync(${JSON.stringify(log)}, 'electron required\\n');`,
    );
    const steps = (ran: string[]) => ran.filter((line) => !line.endsWith('--version'));
    expect(steps(install().ran)).toContain('pnpm app:setup');
    writeFileSync(join(electron, 'path.txt'), 'electron');
    writeFileSync(join(electron, 'dist', 'electron'), '');
    rmSync(log);
    const again = steps(install().ran);
    expect(again).not.toContain('pnpm app:setup');
    expect(again).toContain('symbiote app install');
    expect(readFileSync(log, 'utf8')).not.toContain('electron required');
  });

  it('runs again as it ran: the same commands, the old ones taken back, nothing doubled', () => {
    pnpm();
    mkdirSync(join(home, '.local/bin'), { recursive: true });
    // As `pnpm cli:install` of chore/install-command wrote it: Symbiote's, so replaced.
    writeFileSync(
      command('symbiote'),
      "#!/bin/sh\n# Symbiote's command, installed by pnpm cli:install from /old\nexec node '/old/bin.js' \"$@\"\n",
    );
    expect(install(['--no-app']).code).toBe(0);
    const first = readFileSync(command('symbiote'), 'utf8');
    expect(first).toContain(root);
    expect(install(['--no-app']).code).toBe(0);
    expect(readFileSync(command('symbiote'), 'utf8')).toBe(first);
  });

  it("leaves a command that is not Symbiote's alone, and runs nothing", () => {
    pnpm();
    mkdirSync(join(home, '.local/bin'), { recursive: true });
    writeFileSync(command('symbiote-nexus'), '#!/bin/sh\necho mine\n');
    const { code, err, ran } = install();
    expect(code).toBe(1);
    expect(err).toContain(`${command('symbiote-nexus')} is not Symbiote's`);
    expect(ran).toEqual([]);
    expect(readFileSync(command('symbiote-nexus'), 'utf8')).toBe('#!/bin/sh\necho mine\n');
  });

  it('puts the commands in XDG_BIN_HOME, and says what to run when it is on PATH', () => {
    pnpm();
    const bin = join(dir, 'bin');
    const { code, out } = install(['--no-app'], { XDG_BIN_HOME: bin, PATH: `${tools}:${bin}` });
    expect(code).toBe(0);
    expect(existsSync(join(bin, 'symbiote'))).toBe(true);
    expect(out).not.toContain('is not on your PATH');
    expect(out).toContain('symbiote view');
  });

  it('without a pnpm 12 of yours, uses corepack, else npx', () => {
    tool('corepack', '[ "$1" = "--version" ] && echo 0.34.0; exit 0');
    expect(install(['--no-app']).ran.slice(0, 3)).toEqual([
      'corepack --version',
      'corepack pnpm install --frozen-lockfile',
      'corepack pnpm build',
    ]);
    rmSync(join(tools, 'corepack'));
    rmSync(log);
    tool('npx', 'exit 0');
    expect(install(['--no-app']).ran.slice(0, 2)).toEqual([
      'npx --yes pnpm@12.8.1 install --frozen-lockfile',
      'npx --yes pnpm@12.8.1 build',
    ]);
  });

  it('stops at a failing step with its output, and writes no command', () => {
    pnpm();
    const { code, err } = install([], { FAIL_BUILD: '1' });
    expect(code).toBe(1);
    expect(err).toContain('build broke: src/x.ts(1,1)');
    expect(err).toContain('symbiote install: Building Symbiote failed');
    expect(existsSync(command('symbiote'))).toBe(false);
  });

  it('says what Node it needs, when it is too old or missing', () => {
    rmSync(join(tools, 'node'));
    const missing = install();
    expect(missing.code).toBe(1);
    expect(missing.err).toContain(
      'Symbiote needs Node 22.12 or newer, and there is no node on PATH',
    );
    tool('node', 'echo 22.11.0');
    const old = install();
    expect(old.code).toBe(1);
    expect(old.err).toContain('Symbiote needs Node 22.12 or newer; this is 22.11.0');
  });

  it('says how to run it, and refuses what it does not know', () => {
    expect(install(['--help'])).toMatchObject({ code: 0, ran: [] });
    expect(install(['--help']).out).toContain('Usage: ./install.sh [--no-app]');
    const odd = install(['--app']);
    expect(odd.code).toBe(2);
    expect(odd.err).toContain("unknown option '--app'");
  });
});
