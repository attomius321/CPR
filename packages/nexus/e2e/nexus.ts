// The nexus's e2e harness (NX1b): real `symbiote view` servers in throwaway repositories, and the
// nexus on the same cache folder, both from the built packages (`pnpm build` first). Like the
// viewer's harness (`packages/viewer/e2e/symbiote.ts`): never a real agent, usage, intro, log or
// config folder of the person's.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

/** `symbiote-nexus --no-open` on the spec's cache; `home` is its Folders tab's home (NX2). */
export function startNexus(cache: string, home?: string): Promise<Served> {
  return serve(
    [nexusBin, '--no-open'],
    tmpdir(),
    { SYMBIOTE_CACHE_DIR: cache, ...(home ? { HOME: home } : {}) },
    /Symbiote nexus: (\S+)/,
  );
}

/** A home folder of the spec's own: `projects/` with `repositories` (two commits each) and `folders`. */
export function homeFolder(
  repositories: string[],
  folders: string[] = [],
): { dir: string; projects: string; remove(): void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'symbiote-e2e-nexus-home-')));
  const projects = join(dir, 'projects');
  for (const name of repositories) {
    const repo = join(projects, name);
    mkdirSync(join(repo, 'src'), { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'src', 'a.ts'), 'export function a(): number {\n  return 1;\n}\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'first');
    writeFileSync(join(repo, 'src', 'a.ts'), 'export function a(): number {\n  return 2;\n}\n');
    git(repo, 'commit', '-qam', 'second');
  }
  for (const name of folders) mkdirSync(join(projects, name), { recursive: true });
  return { dir, projects, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Stops the Symbiotes recorded in `cache` as Ctrl+C would: those the nexus started outlive it
 * (decision 541), so a spec stops them itself.
 */
export async function stopRecorded(cache: string): Promise<void> {
  let names: string[];
  try {
    names = readdirSync(join(cache, 'running'));
  } catch {
    return;
  }
  const pids = names.map((name) => Number(/^(\d+)\.json$/.exec(name)?.[1])).filter(Boolean);
  for (const pid of pids) signal(pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  for (const pid of pids.filter(alive)) signal(pid, 'SIGKILL');
}

/** The pids of the Symbiotes recorded in `cache`. */
export function recorded(cache: string): number[] {
  try {
    return readdirSync(join(cache, 'running'))
      .map((name) => Number(/^(\d+)\.json$/.exec(name)?.[1]))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // Ended already.
  }
}
