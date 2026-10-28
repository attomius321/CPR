// The nexus's e2e harness (NX1b): real `symbiote view` servers in throwaway repositories, and the
// nexus on the same cache folder, both from the built packages (`pnpm build` first). Like the
// viewer's harness (`packages/viewer/e2e/symbiote.ts`): never a real agent, usage, intro, log or
// config folder of the person's.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const cli = join(root, 'packages/cli/dist/bin.js');
const nexusBin = join(root, 'packages/nexus/dist/bin.js');

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Symbiote Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Symbiote Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  SYMBIOTE_CLAUDE: '/nonexistent/claude',
  SYMBIOTE_CODEX: '/nonexistent/codex',
  SYMBIOTE_HERMES: '/nonexistent/hermes',
  SYMBIOTE_USAGE: 'off',
  SYMBIOTE_INTRO: 'off',
  SYMBIOTE_APP: 'off',
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

/** A cache folder of the spec's own: where the servers' records and every line go. */
export function cacheFolder(): { dir: string; remove(): void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'symbiote-e2e-nexus-cache-')));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A repository named `name` with two commits on main: "first", then "second". */
export function repository(name: string): { dir: string; remove(): void } {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'symbiote-e2e-nexus-')));
  const dir = join(parent, name);
  mkdirSync(join(dir, 'src'), { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'src', 'a.ts'), 'export function a(): number {\n  return 1;\n}\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'first');
  writeFileSync(join(dir, 'src', 'a.ts'), 'export function a(): number {\n  return 2;\n}\n');
  git(dir, 'commit', '-qam', 'second');
  return { dir, remove: () => rmSync(parent, { recursive: true, force: true }) };
}

export interface Served {
  readonly url: string;
  /** Stops it as Ctrl+C does, once it has ended (its record removed). */
  stop(): Promise<void>;
}

/** Runs `command` until its line names its address. */
function serve(
  command: string[],
  cwd: string,
  extraEnv: Record<string, string>,
  line: RegExp,
): Promise<Served> {
  const child: ChildProcess = spawn(process.execPath, command, {
    cwd,
    env: {
      ...env,
      XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'symbiote-e2e-config-')),
      ...extraEnv,
    },
  });
  const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
      const url = line.exec(output)?.[1];
      if (url) {
        resolve({
          url,
          stop: () => {
            child.kill('SIGINT');
            return ended;
          },
        });
      }
    });
    child.stderr?.on('data', (data: Buffer) => (output += data.toString()));
    child.once('exit', (code) =>
      reject(new Error(`${command[1]} exited with ${code}:\n${output}`)),
    );
  });
}

/** `symbiote view` in `repo`, with the spec's cache. */
export function startView(repo: string, cache: string): Promise<Served> {
  return serve(
    [cli, 'view', '--no-open'],
    repo,
    { SYMBIOTE_CACHE_DIR: cache },
    /Symbiote viewer: (\S+)/,
  );
}

/** `symbiote-nexus --no-open` on the spec's cache. */
export function startNexus(cache: string): Promise<Served> {
  return serve(
    [nexusBin, '--no-open'],
    tmpdir(),
    { SYMBIOTE_CACHE_DIR: cache },
    /Symbiote nexus: (\S+)/,
  );
}
