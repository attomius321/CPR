// Installs the `symbiote` command from this checkout, in one step: pnpm install, pnpm build, then a
// small script in ~/.local/bin (or $XDG_BIN_HOME) that runs packages/cli/dist/bin.js with the node
// on PATH. With --app, Symbiote's window too: Electron (pnpm app:setup) and `symbiote app install`.
// Usage: pnpm cli:install | pnpm app:install
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const withApp = process.argv.includes('--app');
const cli = join(root, 'packages', 'cli', 'dist', 'bin.js');
const bin = process.env.XDG_BIN_HOME ?? join(homedir(), '.local', 'bin');
const command = join(bin, 'symbiote');

/** Runs a step in Symbiote's folder; a quiet one shows its output only if it fails. */
function step(label, program, args, { quiet = false } = {}) {
  console.log(label);
  const run = spawnSync(program, args, { cwd: root, stdio: quiet ? 'pipe' : 'inherit' });
  if (run.status === 0) return;
  if (quiet) process.stderr.write(`${run.stdout ?? ''}${run.stderr ?? ''}`);
  process.stderr.write(`symbiote install: ${label.replace(/…$/, '')} failed\n`);
  process.exit(run.status ?? 1);
}

/** Whether Electron is downloaded: its package answers its binary's path, or throws. */
function hasElectron() {
  try {
    const electron = createRequire(join(root, 'packages', 'desktop', 'package.json'))('electron');
    return typeof electron === 'string' && existsSync(electron);
  } catch {
    return false;
  }
}

// A command of that name that does not run a Symbiote checkout is someone else's: left alone.
if (existsSync(command) && !readFileSync(command, 'utf8').includes('packages/cli/dist/bin.js')) {
  process.stderr.write(`symbiote install: ${command} is not Symbiote's; remove it first\n`);
  process.exit(1);
}

step('Installing dependencies (pnpm install)…', 'pnpm', ['install']);
step('Building Symbiote (pnpm build)…', 'pnpm', ['build'], { quiet: true });
if (withApp && !hasElectron()) {
  step("Fetching Electron for Symbiote's window (pnpm app:setup, ~100 MB)…", 'pnpm', ['app:setup']);
}

const quoted = `'${cli.replaceAll("'", `'\\''`)}'`;
mkdirSync(bin, { recursive: true });
writeFileSync(
  command,
  `#!/bin/sh\n# Symbiote's command, installed by pnpm cli:install from ${root}\nexec node ${quoted} "$@"\n`,
);
chmodSync(command, 0o755);
console.log(`Installed ${command} → ${cli}`);

const check = spawnSync(command, ['--version'], { encoding: 'utf8' });
if (check.status !== 0) {
  process.stderr.write(`symbiote install: ${command} --version failed:\n${check.stderr}`);
  process.exit(1);
}

if (withApp) step("Adding Symbiote's window to your desktop's apps…", command, ['app', 'install']);

if ((process.env.PATH ?? '').split(delimiter).includes(bin)) {
  console.log(`Done: ${check.stdout.trim()}. Run symbiote in any git repository.`);
} else {
  console.log(`Done, but ${bin} is not on your PATH. Add this line to your shell profile:`);
  console.log(`  export PATH="${bin}:$PATH"`);
}
