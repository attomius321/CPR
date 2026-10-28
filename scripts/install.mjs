// Symbiote's install from a checkout (IN1, decisions 533–537), run by ./install.sh once it has
// checked Node: the dependencies, the build while Electron is fetched for the window, the
// `symbiote` and `symbiote-nexus` commands in ~/.local/bin, the window's launcher. Run again, it
// updates. Node's modules only: nothing is installed when it starts.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: ./install.sh [--no-app]

Installs Symbiote from this checkout: its dependencies, its build, Symbiote's window
(Electron, about 100 MB) and the symbiote and symbiote-nexus commands, in
$XDG_BIN_HOME or ~/.local/bin. Run it again after git pull to update.

  --no-app   Without Symbiote's window: the commands open your browser
  -h, --help Show this help
`;

/** The line that makes a command Symbiote's: one without it is never replaced. */
const MARK = "# Symbiote's command";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const started = performance.now();

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(USAGE);
  process.exit(0);
}
const unknown = args.find((arg) => arg !== '--no-app');
if (unknown !== undefined) fail(`unknown option '${unknown}'\n\n${USAGE}`, 2);
const withApp = !args.includes('--no-app');

const bin = process.env.XDG_BIN_HOME || join(homedir(), '.local', 'bin');
const commands = [
  { name: 'symbiote', target: join(root, 'packages', 'cli', 'dist', 'bin.js') },
  { name: 'symbiote-nexus', target: join(root, 'packages', 'nexus', 'dist', 'bin.js') },
].map((command) => ({ ...command, path: join(bin, command.name) }));

function fail(message, code = 1) {
  process.stderr.write(`symbiote install: ${message}\n`);
  process.exit(code);
}

const seconds = (since) => `${((performance.now() - since) / 1000).toFixed(1)} s`;

// 1. The commands' places, before anything runs: a file there that is not Symbiote's stays.
for (const { path } of commands) {
  if (existsSync(path) && !readFileSync(path, 'utf8').includes(MARK)) {
    fail(`${path} is not Symbiote's: remove it, or set XDG_BIN_HOME to another folder`);
  }
}

console.log(`Installing Symbiote from ${root}`);

// 2. pnpm, the version the checkout names: the person's, else corepack's, else npx's.
const wanted = /^pnpm@(\d[\w.-]*)/.exec(readPackage().packageManager ?? '')?.[1] ?? '12';
const pnpm = findPnpm();

/** Runs pnpm with `args`; its output shown as it comes. */
function pnpmShown(label, pnpmArgs) {
  console.log(`${label}…`);
  const since = performance.now();
  const [command, ...pre] = pnpm;
  const run = spawnSync(command, [...pre, ...pnpmArgs], { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) fail(`${label} failed`);
  console.log(`  done in ${seconds(since)}`);
}

/** Runs pnpm with `args`, quiet: resolves with its time, or its output if it fails. */
function pnpmQuiet(pnpmArgs) {
  const since = performance.now();
  const [command, ...pre] = pnpm;
  return new Promise((resolve) => {
    const child = spawn(command, [...pre, ...pnpmArgs], { cwd: root });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    child.once('error', (error) => resolve({ ok: false, output: error.message }));
    child.once('close', (code) =>
      resolve(code === 0 ? { ok: true, time: seconds(since) } : { ok: false, output }),
    );
  });
}

// 3. The dependencies, from the lockfile as it is.
pnpmShown('Installing dependencies (pnpm install)', ['install', '--frozen-lockfile']);

// 4. The build, and Electron's download beside it (decision 536); an Electron already fetched stays.
const steps = [{ label: 'Building Symbiote', run: pnpmQuiet(['build']) }];
if (withApp && !hasElectron()) {
  steps.push({ label: "Fetching Electron for Symbiote's window", run: pnpmQuiet(['app:setup']) });
}
console.log(
  steps.length > 1
    ? 'Building Symbiote, and fetching Electron for its window (about 100 MB)…'
    : 'Building Symbiote…',
);
let failed = false;
for (const { label, run } of steps) {
  const result = await run;
  if (result.ok) {
    console.log(`  ${label}: done in ${result.time}`);
  } else {
    process.stderr.write(result.output);
    process.stderr.write(`symbiote install: ${label} failed\n`);
    failed = true;
  }
}
if (failed) process.exit(1);

// 5. The commands: the node on PATH, this checkout's build (decision 535).
mkdirSync(bin, { recursive: true });
for (const { path, target } of commands) {
  const quoted = `'${target.replaceAll("'", `'\\''`)}'`;
  writeFileSync(
    path,
    `#!/bin/sh\n${MARK}, installed by ./install.sh from ${root}\nexec node ${quoted} "$@"\n`,
  );
  chmodSync(path, 0o755);
}
console.log(`Wrote ${commands.map(({ path }) => path).join(' and ')}`);
const symbiote = commands[0].path;
const version = spawnSync(symbiote, ['--version'], { encoding: 'utf8' });
if (version.status !== 0) fail(`${symbiote} --version failed:\n${version.stderr}`);
console.log(`  ${version.stdout.trim()}`);

// 6. The window's launcher: the desktop's app list, and what the app needs to start servers.
if (withApp) {
  const added = spawnSync(symbiote, ['app', 'install'], { encoding: 'utf8' });
  if (added.status !== 0) fail(`symbiote app install failed:\n${added.stderr}${added.stdout}`);
  console.log("Added Symbiote's window to your desktop's apps");
}

// 7. What it did, and what is left to the person.
const terminal = terminalState();
console.log(
  terminal === null
    ? "Agents' terminals: ready"
    : `Agents' terminals: off (${terminal}): you answer agents in a text box`,
);
for (const profile of ['.bashrc', '.zshrc']) {
  const file = join(homedir(), profile);
  if (existsSync(file) && /^\s*alias symbiote=/m.test(readFileSync(file, 'utf8'))) {
    console.log(`~/${profile} has an alias for symbiote: it is not needed any more, remove it`);
  }
}
if ((process.env.PATH ?? '').split(delimiter).includes(bin)) {
  console.log(
    `Done in ${seconds(started)}. Run symbiote view in a git repository, and symbiote-nexus for every one running.`,
  );
} else {
  console.log(`Done in ${seconds(started)}, but ${bin} is not on your PATH.`);
  console.log("Add this line to ~/.bashrc (or your shell's profile), then open a new terminal:");
  console.log(`  export PATH="${bin}:$PATH"`);
}

function readPackage() {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** How to run the pnpm the checkout names, with nothing installed globally. */
function findPnpm() {
  const major = wanted.split('.')[0];
  const own = spawnSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8' });
  if (own.status === 0 && own.stdout.trim().split('.')[0] === major) {
    console.log(`pnpm ${own.stdout.trim()}: yours`);
    return ['pnpm'];
  }
  if (spawnSync('corepack', ['--version'], { cwd: root }).status === 0) {
    console.log(`pnpm ${wanted}: through corepack`);
    return ['corepack', 'pnpm'];
  }
  console.log(`pnpm ${wanted}: through npx`);
  return ['npx', '--yes', `pnpm@${wanted}`];
}

/**
 * Whether `pnpm app:setup` fetched Electron's binary: read from its package's `path.txt`, never by
 * requiring the package, which downloads the binary (about 100 MB) when it is missing.
 */
function hasElectron() {
  for (let folder = join(root, 'packages', 'desktop'); ; folder = dirname(folder)) {
    const electron = join(folder, 'node_modules', 'electron');
    if (existsSync(join(electron, 'package.json'))) {
      try {
        const name = readFileSync(join(electron, 'path.txt'), 'utf8').trim();
        return name !== '' && existsSync(join(electron, 'dist', name));
      } catch {
        return false;
      }
    }
    if (dirname(folder) === folder) return false;
  }
}

/** Why the agents' terminal cannot load here, in `loadPty`'s words; null when it loads. */
function terminalState() {
  const check = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('@lydell/node-pty').then(() => console.log('ok'), (e) => console.log(e.code === 'ERR_MODULE_NOT_FOUND' ? 'node-pty is not installed' : `node-pty did not load: ${String(e.message).split('\\n')[0]}`))",
    ],
    { cwd: join(root, 'packages', 'cli'), encoding: 'utf8' },
  );
  const said = check.stdout.trim();
  return said === 'ok' ? null : said || 'node-pty did not load';
}
