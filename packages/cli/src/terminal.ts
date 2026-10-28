// Terminals for workspaces' agents (V21): `claude attach <id>` in a pseudo-terminal, its output
// streamed to the page and the person's keys written back. Claude Code keeps hosting the
// session; a terminal is only a client of it, and hanging one up leaves the session running.
// Images pasted or dropped into one are saved for its agent to attach (V36); files it prints are
// opened in the editor (V38). A workspace's shells are kept terminals (V45): a hang-up ends what
// they run.
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { defaultCacheDir } from '@symbiote/core';
import type { Logger } from '@symbiote/log';
import type { OpenFolder } from './editor.js';

/** A pseudo-terminal's process, as node-pty gives one; tests pass a fake. */
export interface Pty {
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  /** The program in its foreground, as node-pty names it (V45). */
  readonly process?: string | undefined;
}

export type SpawnPty = (
  file: string,
  args: string[],
  options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
) => Pty;

/**
 * node-pty's `spawn`, or why it cannot run here. It is an optional dependency, prebuilt for each
 * platform (`@lydell/node-pty`, IN1): not installed, or no binary for this one, the page keeps
 * Talk.
 */
export async function loadPty(
  load: () => Promise<unknown> = () => {
    // A name TypeScript does not resolve: the types must not need the optional package.
    const name = '@lydell/node-pty';
    return import(name);
  },
): Promise<{ spawn: SpawnPty } | { error: string }> {
  try {
    const module = (await load()) as { spawn?: unknown; default?: { spawn?: unknown } };
    const spawn = module.spawn ?? module.default?.spawn;
    if (typeof spawn !== 'function') return { error: 'node-pty has no spawn' };
    return { spawn: spawn as SpawnPty };
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    if (code === 'ERR_MODULE_NOT_FOUND' && /'@lydell\/node-pty'/.test(message ?? '')) {
      return { error: 'node-pty is not installed' };
    }
    return { error: `node-pty did not load: ${(message ?? String(error)).split('\n')[0]}` };
  }
}

/**
 * The shell a workspace's new terminal runs (V45): the person's (`$SHELL`), else `/bin/sh`. On
 * Windows `%COMSPEC%` (cmd.exe), whatever `SHELL` Git Bash set: node-pty runs Windows programs
 * there.
 */
export function shellOf(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    // Windows names it ComSpec; a copy of the environment keeps the name's case.
    const comspec = Object.entries(env).find(([name]) => name.toUpperCase() === 'COMSPEC')?.[1];
    return comspec || 'cmd.exe';
  }
  return env.SHELL || '/bin/sh';
}

/** Why a terminal was not opened; the server answers with `status`. */
export class TerminalRefused extends Error {
  constructor(
    message: string,
    readonly status: 409 = 409,
  ) {
    super(message);
  }
}

/** The kinds of image Claude Code and Codex attach from a pasted path (V36). */
export type ImageKind = 'png' | 'jpg' | 'gif' | 'webp';

/** Most an image for an agent may weigh (V36): screenshots weigh less; both agents shrink theirs. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** An image's kind by its first bytes, or null for anything else. */
export function imageKind(bytes: Uint8Array): ImageKind | null {
  const at = (offset: number, ...head: number[]) =>
    head.every((byte, i) => bytes[offset + i] === byte);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpg';
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (at(4, 0x37, 0x61) || at(4, 0x39, 0x61))) return 'gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  return null;
}

/**
 * A saved image's path as the text to paste (V36): as it is when it holds only safe characters,
 * else each other character backslash-escaped, which Claude Code and Codex both undo (Codex splits
 * a raw path at a space). On Windows, forward slashes: Claude Code takes a backslash as an escape.
 */
export function pastedPath(path: string, platform: NodeJS.Platform = process.platform): string {
  const slashed = platform === 'win32' ? path.replaceAll('\\', '/') : path;
  return slashed.replace(/[^\w./@:\-\u0080-\uffff]/g, '\\$&');
}

/** The names Symbiote gives the images it saves: only those are ever removed. */
const SAVED_IMAGE = /^[0-9a-f]{32}\.(?:png|jpg|gif|webp)$/;

/** Where a terminal opens a file it printed (V38): its line and column, 1 when not printed. */
export interface FileAt {
  path: string;
  line?: number;
  column?: number;
}

/** A file opened, or why not: no such terminal, not in its folder, not a file, the editor's words. */
export type OpenedFile =
  | { opened: true }
  | { opened: false; why: 'terminal' | 'outside' | 'missing' | 'editor'; message: string };

/**
 * A path an agent printed, as a file of the folder its terminal runs in (V38): relative to that
 * folder, `~/` from `home`, or absolute in it (through the folder's real path too: the agent may
 * print that one). Its path in the folder, POSIX; null for anything outside it, or the folder.
 */
export function inFolder(
  folders: readonly string[],
  path: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
): { folder: string; file: string } | null {
  const paths = platform === 'win32' ? win32 : posix;
  if (path === '') return null;
  const tilde = /^~(?=$|[\\/])/.test(path);
  for (const folder of folders) {
    const full = tilde ? paths.join(home, path.slice(1)) : paths.resolve(folder, path);
    const file = paths.relative(folder, full);
    if (
      file === '' ||
      paths.isAbsolute(file) ||
      file === '..' ||
      file.startsWith(`..${paths.sep}`)
    ) {
      continue;
    }
    return { folder, file: file.split(paths.sep).join('/') };
  }
  return null;
}

/** Who reads a terminal: its output (what was kept first), then its end. */
export interface TerminalListener {
  out(data: string): void;
  exit(code: number): void;
}

export interface Terminals {
  /** Whether terminals can run here, else why not. */
  available(): Promise<{ available: true } | { available: false; reason: string }>;
  /**
   * Runs `command args` in `cwd` in a new terminal; its ID. Rejects with `TerminalRefused`.
   * `kept` (a shell, V45): never hung up for having no reader nor to make room for another, and
   * not counted in the limit.
   */
  open(request: {
    command: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: Readonly<Record<string, string | undefined>>;
    kept?: boolean;
  }): Promise<string>;
  /**
   * Reads a terminal: what it printed so far, then what it prints, then its end. The way to stop
   * reading; undefined when there is no such terminal.
   */
  listen(id: string, listener: TerminalListener): (() => void) | undefined;
  /** Each false when there is no such terminal. */
  write(id: string, data: string): boolean;
  resize(id: string, cols: number, rows: number): boolean;
  /**
   * The program in its foreground when it is not the one the terminal started (V45): `node` in a
   * shell that runs a server, null at the shell's prompt or when unknown; undefined when there is
   * no such terminal.
   */
  running(id: string): string | null | undefined;
  /**
   * Saves an image for the terminal's agent to attach (V36): where, and the text to paste for it.
   * Undefined when there is no such terminal.
   */
  image(
    id: string,
    bytes: Uint8Array,
    kind: ImageKind,
  ): Promise<{ path: string; text: string } | undefined>;
  /**
   * Which of the paths its agent printed are files in its folder (V38), as given; undefined when
   * there is no such terminal.
   */
  files(id: string, paths: readonly string[]): Promise<string[] | undefined>;
  /** Opens a file of its folder in the editor, in the folder's window, at a line (V38). */
  openFile(id: string, at: FileAt): Promise<OpenedFile>;
  /** Hangs it up: the program it runs ends; Claude Code's session goes on. */
  close(id: string): boolean;
  /** Hangs every terminal up and ends its readers (`symbiote view` stops). */
  closeAll(): void;
}

interface Open {
  id: string;
  pty: Pty;
  /** The program it started, by name: what `running` does not count. */
  program: string;
  /** A shell's (V45): never hung up for having no reader, nor to make room. */
  kept: boolean;
  /** The folder it runs in: where the paths it prints are read from (V38). */
  cwd: string;
  opened: number;
  /** What it printed, the oldest dropped past `maxOutput`. */
  output: string[];
  size: number;
  listeners: Set<TerminalListener>;
  /** Hangs it up once nobody has read it for `graceMs`. */
  idle?: ReturnType<typeof setTimeout>;
}

/**
 * Terminals, at most `limit` at once (each `claude attach` is a Claude Code process, about 140
 * MB): a new one hangs up the oldest nobody reads, else is refused. One nobody reads for
 * `graceMs` is hung up (a reload reads it again within that). Kept terminals (shells, 9 MB, V45)
 * are outside both rules. Their images go in `images`, for
 * the person only, and are removed `keepImagesMs` later: Codex reads one when its message is
 * sent, not when it is pasted (V36 spike). Files they print open with `openFolder` (V38).
 */
export function terminals({
  pty = () => loadPty(),
  limit = 4,
  graceMs = 10_000,
  maxOutput = 1 << 20,
  platform = process.platform,
  images = join(defaultCacheDir(), 'images'),
  keepImagesMs = 24 * 60 * 60_000,
  now = Date.now,
  home = homedir(),
  openFolder,
  log,
}: {
  pty?: () => Promise<{ spawn: SpawnPty } | { error: string }>;
  limit?: number;
  graceMs?: number;
  maxOutput?: number;
  platform?: NodeJS.Platform;
  images?: string;
  keepImagesMs?: number;
  now?: () => number;
  /** What `~/` in a printed path stands for. */
  home?: string;
  openFolder?: OpenFolder;
  /** A line when a program starts and ends (LG1): its name, never what it runs or prints. */
  log?: Logger;
} = {}): Terminals {
  let loaded: Promise<{ spawn: SpawnPty } | { error: string }> | null = null;
  const load = () => (loaded ??= pty());
  const open = new Map<string, Open>();
  let count = 0;

  /** A program's name as node-pty gives it: `/bin/bash`, `-bash` (a login shell), `CMD.EXE`. */
  const nameOf = (path: string) => {
    const name = (platform === 'win32' ? win32 : posix).basename(path).replace(/^-/, '');
    return platform === 'win32' ? name.toLowerCase().replace(/\.exe$/, '') : name;
  };
  const watch = (terminal: Open) => {
    clearTimeout(terminal.idle);
    if (!terminal.kept && terminal.listeners.size === 0) {
      terminal.idle = setTimeout(() => hangUp(terminal), graceMs);
    }
  };
  const sweep = async () => {
    const names = await readdir(images).catch(() => []);
    const before = now() - keepImagesMs;
    await Promise.all(
      names
        .filter((name) => SAVED_IMAGE.test(name))
        .map(async (name) => {
          const file = join(images, name);
          const { mtimeMs } = await stat(file).catch(() => ({ mtimeMs: Infinity }));
          if (mtimeMs < before) await rm(file, { force: true });
        }),
    );
  };
  /** The terminal's folder as it has it, and its real path. */
  const foldersOf = async (terminal: Open) => [
    terminal.cwd,
    await realpath(terminal.cwd).catch(() => terminal.cwd),
  ];
  /** A printed path as a file of the terminal's folder, or why not. */
  const fileOf = async (
    terminal: Open,
    folders: string[],
    path: string,
  ): Promise<{ folder: string; file: string } | 'outside' | 'missing'> => {
    const found = inFolder(folders, path, home, platform);
    if (!found) return 'outside';
    const isFile = await stat(join(found.folder, ...found.file.split('/'))).then(
      (s) => s.isFile(),
      () => false,
    );
    // Opened in the window with the folder as the terminal has it.
    return isFile ? { folder: terminal.cwd, file: found.file } : 'missing';
  };

  const hangUp = (terminal: Open) => {
    clearTimeout(terminal.idle);
    // Windows' terminals take no signal; elsewhere a hang-up, as a closed terminal window.
    try {
      if (platform === 'win32') terminal.pty.kill();
      else terminal.pty.kill('SIGHUP');
    } catch {
      // Already gone.
    }
  };

  return {
    async available() {
      const result = await load();
      return 'error' in result ? { available: false, reason: result.error } : { available: true };
    },

    async open({ command, args, cwd, cols, rows, env, kept = false }) {
      const result = await load();
      if ('error' in result) throw new TerminalRefused(result.error);
      const counted = [...open.values()].filter((t) => !t.kept);
      if (!kept && counted.length >= limit) {
        const unread = counted
          .filter((t) => t.listeners.size === 0)
          .sort((a, b) => a.opened - b.opened)[0];
        if (!unread) {
          throw new TerminalRefused(`${limit} terminals are open: close one first`);
        }
        open.delete(unread.id);
        hangUp(unread);
      }
      const terminal: Open = {
        id: randomBytes(16).toString('hex'),
        pty: result.spawn(command, args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd,
          env: {
            ...Object.fromEntries(
              Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined),
            ),
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
          },
        }),
        program: nameOf(command),
        kept,
        cwd,
        opened: count++,
        output: [],
        size: 0,
        listeners: new Set(),
      };
      terminal.pty.onData((data) => {
        terminal.output.push(data);
        terminal.size += data.length;
        while (terminal.size > maxOutput && terminal.output.length > 1) {
          terminal.size -= terminal.output.shift()?.length ?? 0;
        }
        for (const listener of terminal.listeners) listener.out(data);
      });
      log?.info(
        { terminal: terminal.id.slice(0, 8), program: terminal.program, kept },
        'terminal opened',
      );
      terminal.pty.onExit(({ exitCode }) => {
        const ended = { terminal: terminal.id.slice(0, 8), program: terminal.program, exitCode };
        if (exitCode === 0) log?.info(ended, 'terminal ended');
        else log?.warn(ended, 'terminal ended');
        clearTimeout(terminal.idle);
        if (open.get(terminal.id) === terminal) open.delete(terminal.id);
        for (const listener of terminal.listeners) listener.exit(exitCode);
        terminal.listeners.clear();
      });
      open.set(terminal.id, terminal);
      watch(terminal);
      return terminal.id;
    },

    listen(id, listener) {
      const terminal = open.get(id);
      if (!terminal) return undefined;
      const kept = terminal.output.join('');
      if (kept) listener.out(kept);
      terminal.listeners.add(listener);
      watch(terminal);
      return () => {
        terminal.listeners.delete(listener);
        if (open.get(id) === terminal) watch(terminal);
      };
    },

    write(id, data) {
      const terminal = open.get(id);
      terminal?.pty.write(data);
      return terminal !== undefined;
    },

    resize(id, cols, rows) {
      const terminal = open.get(id);
      terminal?.pty.resize(cols, rows);
      return terminal !== undefined;
    },

    running(id) {
      const terminal = open.get(id);
      if (!terminal) return undefined;
      // A program that set its title is named by it on Linux (`npm exec vitest --watch a/b.ts`,
      // measured): its first word. Windows names the program alone, spaces and all.
      const now =
        platform === 'win32' ? terminal.pty.process : terminal.pty.process?.split(/\s/)[0];
      if (!now) return null;
      const name = nameOf(now);
      return name === terminal.program ? null : name;
    },

    async image(id, bytes, kind) {
      if (!open.has(id)) return undefined;
      await mkdir(images, { recursive: true, mode: 0o700 });
      await sweep();
      const path = join(images, `${randomBytes(16).toString('hex')}.${kind}`);
      await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
      return { path, text: pastedPath(path, platform) };
    },

    async files(id, paths) {
      const terminal = open.get(id);
      if (!terminal) return undefined;
      const folders = await foldersOf(terminal);
      const found = await Promise.all(paths.map((path) => fileOf(terminal, folders, path)));
      return paths.filter((_, i) => typeof found[i] === 'object');
    },

    async openFile(id, { path, line = 1, column = 1 }) {
      const terminal = open.get(id);
      if (!terminal) return { opened: false, why: 'terminal', message: 'no such terminal' };
      const found = await fileOf(terminal, await foldersOf(terminal), path);
      if (found === 'outside') {
        return { opened: false, why: 'outside', message: `${path} is not in ${terminal.cwd}` };
      }
      if (found === 'missing') {
        return { opened: false, why: 'missing', message: `${path} is not a file` };
      }
      if (!openFolder) {
        return { opened: false, why: 'editor', message: 'no editor to open it in' };
      }
      const result = await openFolder(found.folder, { file: found.file, line, column });
      return result.opened ? result : { opened: false, why: 'editor', message: result.message };
    },

    close(id) {
      const terminal = open.get(id);
      if (!terminal) return false;
      open.delete(id);
      hangUp(terminal);
      return true;
    },

    closeAll() {
      for (const terminal of open.values()) {
        hangUp(terminal);
        for (const listener of terminal.listeners) listener.exit(0);
        terminal.listeners.clear();
      }
      open.clear();
    },
  };
}
