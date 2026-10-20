import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { RECENT } from './state.js';

/** The server's address in `cpr view`'s line, `CPR viewer: <url>  (Ctrl+C to stop)`. */
export function readyUrl(output: string): string | null {
  const match = /^CPR viewer: (http:\/\/127\.0\.0\.1:\d+\/\S*)[^\S\n]*.*\n/m.exec(output);
  return match?.[1] ?? null;
}

/** The recent repositories with `repo` first: each once, ten at most. */
export function withRecent(recent: readonly string[], repo: string): string[] {
  return [repo, ...recent.filter((other) => other !== repo)].slice(0, RECENT);
}

/**
 * What `cpr app install` recorded (`<config>/app.json`), to start `cpr view` from a launcher,
 * which reads no shell profile: node, the CLI, and the shell's `PATH`.
 */
export interface Recorded {
  node: string;
  cli: string;
  path?: string;
}

export function readRecorded(file: string): Recorded | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { node, cli, path } = value as Record<string, unknown>;
  const absolute = (text: unknown): text is string =>
    typeof text === 'string' && text.startsWith('/');
  if (!absolute(node) || !absolute(cli)) return null;
  return { node, cli, ...(typeof path === 'string' ? { path } : {}) };
}

/** Why `cpr view` ended before serving: its last `cpr:` line, else how it ended. */
export function serverError(stderr: string, code: number | null): string {
  const lines = stderr.split('\n').filter((line) => line.trim() !== '');
  const said = lines.findLast((line) => line.startsWith('cpr: '));
  if (said) return said.slice('cpr: '.length);
  if (lines[0]) return `cpr view ended: ${lines[0]}`;
  return `cpr view exited with ${code ?? 'a signal'}`;
}

/**
 * Starts `cpr view` in `repo` with what `cpr app install` recorded: its address once it serves,
 * or why it did not. It reads its stdin: when the app ends, even killed, the pipe closes and the
 * server stops (`CPR_STDIN_STOPS`).
 */
export function startServer(
  repo: string,
  recorded: Recorded,
  env: NodeJS.ProcessEnv,
): Promise<{ url: string; child: ChildProcess } | { error: string }> {
  if (!existsSync(repo)) return Promise.resolve({ error: `no such folder: ${repo}` });
  const child = spawn(recorded.node, [recorded.cli, 'view', '--no-open'], {
    cwd: repo,
    env: {
      ...env,
      ...(recorded.path === undefined ? {} : { PATH: recorded.path }),
      CPR_STDIN_STOPS: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new Promise((resolve) => {
    // Read to the end: a pipe nobody reads would stop the server when it fills.
    let out = '';
    let err = '';
    child.stdout.on('data', (data: Buffer) => {
      out = (out + data.toString()).slice(-4096);
      const url = readyUrl(out);
      if (url) resolve({ url, child });
    });
    child.stderr.on('data', (data: Buffer) => (err = (err + data.toString()).slice(-8192)));
    child.once('error', (error) => resolve({ error: error.message }));
    child.once('close', (code) => resolve({ error: serverError(err, code) }));
  });
}
