import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, normalize, posix, win32 } from 'node:path';
import { workingLine, type GitRepo } from '@cpr/core';

/** What finding VS Code reads from the machine; tests pass another one. */
export interface Host {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  isFile(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
}

/** VS Code's command line: a program, the arguments it needs before ours, its environment. */
export interface VsCode {
  command: string;
  /** Arguments before ours (on Windows, VS Code's `cli.js`). */
  args: string[];
  /** Variables set (a string) or removed (null) for the run. */
  env?: Record<string, string | null>;
  /** A `.cmd` of an unknown shape, run through `cmd.exe`. */
  cmd?: boolean;
}

/** A program to start, with its arguments as given. */
export interface Invocation {
  command: string;
  args: string[];
  env: Record<string, string | null>;
  /** Arguments already quoted for `cmd.exe` (`windowsVerbatimArguments`). */
  verbatim: boolean;
}

/** A line of one side's file to open, as the viewer asks for it. */
export interface OpenRequest {
  sha: string;
  /** Repo-relative POSIX path. */
  file: string;
  line: number;
  column: number;
}

export type OpenResult =
  | { opened: true; line: number; how: 'exact' | 'nearest'; moved: boolean }
  | { opened: false; reason: 'missing' | 'editor'; message: string };

/** The command failed or could not start; its message is meant for the reviewer. */
export class VsCodeError extends Error {
  override name = 'VsCodeError';
}

const NOT_FOUND =
  "VS Code's code command was not found: install it on PATH (in VS Code: Shell Command: " +
  "Install 'code' command in PATH), or set CPR_CODE to it";

/**
 * Finds VS Code's command line: `CPR_CODE` (a path, or a command on PATH), else `code` on
 * PATH, else the usual install places. On Windows, `code.cmd` is read and what it runs is
 * returned (`Code.exe` and its `cli.js`), since Node starts a `.cmd` only through a shell.
 */
export async function findVsCode(host: Host): Promise<VsCode | null> {
  const custom = host.env.CPR_CODE?.trim();
  if (custom) {
    const path = /[\\/]/.test(custom) ? custom : await onPath(host, custom);
    return path && (await host.isFile(path)) ? fromPath(host, path) : null;
  }
  const path = (await onPath(host, 'code')) ?? (await firstFile(host, installPlaces(host)));
  return path ? fromPath(host, path) : null;
}

/** A command's file on PATH; on Windows only with an extension from PATHEXT. */
export async function onPath(host: Host, name: string): Promise<string | null> {
  const windows = host.platform === 'win32';
  const path = windows ? win32 : posix;
  const dirs = (host.env.PATH ?? host.env.Path ?? '').split(windows ? ';' : ':');
  const extensions = windows
    ? (host.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => e !== '')
    : [''];
  const names =
    windows && extensions.some((e) => name.toUpperCase().endsWith(e.toUpperCase()))
      ? [name]
      : extensions.map((e) => name + e.toLowerCase());
  return firstFile(
    host,
    dirs.filter((dir) => dir !== '').flatMap((dir) => names.map((n) => path.join(dir, n))),
  );
}

function installPlaces(host: Host): string[] {
  const { env } = host;
  if (host.platform === 'darwin') {
    const app = 'Visual Studio Code.app/Contents/Resources/app/bin/code';
    return [`/Applications/${app}`, posix.join(host.home, 'Applications', app)];
  }
  if (host.platform === 'win32') {
    return [
      env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code'),
      env.ProgramFiles && win32.join(env.ProgramFiles, 'Microsoft VS Code'),
    ]
      .filter((dir) => dir !== undefined && dir !== '')
      .map((dir) => win32.join(dir as string, 'bin', 'code.cmd'));
  }
  return ['/usr/share/code/bin/code', '/snap/bin/code'];
}

async function firstFile(host: Host, paths: string[]): Promise<string | null> {
  for (const path of paths) if (await host.isFile(path)) return path;
  return null;
}

async function fromPath(host: Host, path: string): Promise<VsCode> {
  if (host.platform !== 'win32' || !/\.(cmd|bat)$/i.test(path)) return { command: path, args: [] };
  const script = await host.readFile(path).catch(() => '');
  // `"%~dp0..\Code.exe" "%~dp0..\<build>\resources\app\out\cli.js" %*`
  const line = /^\s*"([^"]+\.exe)"\s+"([^"]+\.js)"\s+%\*/im.exec(script);
  const dir = win32.dirname(path) + win32.sep;
  const expand = (text: string) => win32.normalize(text.replaceAll('%~dp0', dir));
  if (!line || [line[1], line[2]].some((part) => expand(part as string).includes('%'))) {
    return { command: path, args: [], cmd: true };
  }
  return {
    command: expand(line[1] as string),
    args: [expand(line[2] as string)],
    env: { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: null },
  };
}

/** `code <folder> --goto <file>:<line>:<column>`: the window with that folder, else a new one. */
export function openArgs(folder: string, file: string, line: number, column: number): string[] {
  return [folder, '--goto', `${join(folder, ...file.split('/'))}:${line}:${column}`];
}

/** How to start VS Code with `args`; a `.cmd` of an unknown shape goes through `cmd.exe`. */
export function invocation(
  code: VsCode,
  args: string[],
  env: Readonly<Record<string, string | undefined>>,
): Invocation {
  if (!code.cmd) {
    return {
      command: code.command,
      args: [...code.args, ...args],
      env: code.env ?? {},
      verbatim: false,
    };
  }
  const all = [code.command, ...code.args, ...args];
  // Inside quotes cmd.exe still expands %VAR% (and !VAR! with delayed expansion).
  const unsafe = all.find((arg) => /["%!\r\n]/.test(arg));
  if (unsafe !== undefined) throw new VsCodeError(`cannot pass ${unsafe} to ${code.command}`);
  return {
    command: env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${all.map((arg) => `"${arg}"`).join(' ')}"`],
    env: code.env ?? {},
    verbatim: true,
  };
}

/**
 * Runs VS Code's command line and resolves once it exits (it returns as soon as VS Code has the
 * request), or after `timeoutMs` while it is still going (VS Code starting). A non-zero exit
 * rejects with what it wrote.
 */
export function runVsCode(
  run: Invocation,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of Object.entries(run.env)) {
    if (value === null) delete env[name];
    else env[name] = value;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(run.command, run.args, {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: run.verbatim,
      // Off Windows, Ctrl+C on cpr must not reach a VS Code it started.
      detached: process.platform !== 'win32',
    });
    let stderr = '';
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stderr.destroy();
      child.unref();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => settle(), timeoutMs);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-2000)));
    child.on('error', (error: NodeJS.ErrnoException) =>
      settle(error.code === 'ENOENT' ? new VsCodeError(`${run.command} was not found`) : error),
    );
    // `exit`, not `close`: a VS Code it starts may hold the pipe open.
    child.on('exit', (code, signal) =>
      setImmediate(() =>
        settle(
          code === 0
            ? undefined
            : new VsCodeError(stderr.trim() || `${run.command} exited with ${code ?? signal}`),
        ),
      ),
    );
  });
}

/** The machine `cpr` runs on. */
export function localHost(env: Readonly<Record<string, string | undefined>>): Host {
  return {
    platform: process.platform,
    env,
    home: homedir(),
    isFile: (path) =>
      stat(path).then(
        (s) => s.isFile(),
        () => false,
      ),
    readFile: (path) => readFile(path, 'utf8'),
  };
}

/**
 * Opens a line of one side's file in VS Code, in the window that has the repository open (else
 * a new one with it), at the line where that code is in the working copy now.
 */
export function vsCodeOpener(
  repo: GitRepo,
  env: Readonly<Record<string, string | undefined>>,
  host: Host = localHost(env),
): (request: OpenRequest) => Promise<OpenResult> {
  let found: Promise<VsCode | null> | undefined;
  return async ({ sha, file, line, column }) => {
    const where = await workingLine(repo, sha, file, line);
    if (where.how === 'missing') {
      return { opened: false, reason: 'missing', message: `${file} is not in your working copy` };
    }
    found ??= findVsCode(host);
    const code = await found;
    if (!code) {
      found = undefined;
      const custom = env.CPR_CODE?.trim();
      return {
        opened: false,
        reason: 'editor',
        message: custom ? `CPR_CODE (${custom}) was not found` : NOT_FOUND,
      };
    }
    try {
      const folder = normalize(repo.root);
      await runVsCode(invocation(code, openArgs(folder, file, where.line, column), env));
    } catch (error) {
      found = undefined; // looked up again next time: VS Code may have moved or been installed
      return { opened: false, reason: 'editor', message: (error as Error).message };
    }
    return {
      opened: true,
      line: where.line,
      how: where.how,
      moved: where.how === 'exact' && where.line !== line,
    };
  };
}
