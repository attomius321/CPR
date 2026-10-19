// Terminals for workspaces' agents (V21): `claude attach <id>` in a pseudo-terminal, its output
// streamed to the page and the person's keys written back. Claude Code keeps hosting the
// session; a terminal is only a client of it, and hanging one up leaves the session running.
import { randomBytes } from 'node:crypto';

/** A pseudo-terminal's process, as node-pty gives one; tests pass a fake. */
export interface Pty {
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export type SpawnPty = (
  file: string,
  args: string[],
  options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
) => Pty;

/**
 * node-pty's `spawn`, or why it cannot run here. It is an optional dependency: not installed, or
 * its native part not built (Linux compiles it), the page keeps Talk.
 */
export async function loadPty(
  load: () => Promise<unknown> = () => {
    // A name TypeScript does not resolve: the types must not need the optional package.
    const name = 'node-pty';
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
    if (code === 'ERR_MODULE_NOT_FOUND' && /'node-pty'/.test(message ?? '')) {
      return { error: 'node-pty is not installed' };
    }
    return { error: `node-pty did not load: ${(message ?? String(error)).split('\n')[0]}` };
  }
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

/** Who reads a terminal: its output (what was kept first), then its end. */
export interface TerminalListener {
  out(data: string): void;
  exit(code: number): void;
}

export interface Terminals {
  /** Whether terminals can run here, else why not. */
  available(): Promise<{ available: true } | { available: false; reason: string }>;
  /** Runs `command args` in `cwd` in a new terminal; its ID. Rejects with `TerminalRefused`. */
  open(request: {
    command: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: Readonly<Record<string, string | undefined>>;
  }): Promise<string>;
  /**
   * Reads a terminal: what it printed so far, then what it prints, then its end. The way to stop
   * reading; undefined when there is no such terminal.
   */
  listen(id: string, listener: TerminalListener): (() => void) | undefined;
  /** Each false when there is no such terminal. */
  write(id: string, data: string): boolean;
  resize(id: string, cols: number, rows: number): boolean;
  /** Hangs it up: the program it runs ends; Claude Code's session goes on. */
  close(id: string): boolean;
  /** Hangs every terminal up and ends its readers (`cpr view` stops). */
  closeAll(): void;
}

interface Open {
  id: string;
  pty: Pty;
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
 * `graceMs` is hung up (a reload reads it again within that).
 */
export function terminals({
  pty = () => loadPty(),
  limit = 4,
  graceMs = 10_000,
  maxOutput = 1 << 20,
  platform = process.platform,
}: {
  pty?: () => Promise<{ spawn: SpawnPty } | { error: string }>;
  limit?: number;
  graceMs?: number;
  maxOutput?: number;
  platform?: NodeJS.Platform;
} = {}): Terminals {
  let loaded: Promise<{ spawn: SpawnPty } | { error: string }> | null = null;
  const load = () => (loaded ??= pty());
  const open = new Map<string, Open>();
  let count = 0;

  const watch = (terminal: Open) => {
    clearTimeout(terminal.idle);
    if (terminal.listeners.size === 0) {
      terminal.idle = setTimeout(() => hangUp(terminal), graceMs);
    }
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

    async open({ command, args, cwd, cols, rows, env }) {
      const result = await load();
      if ('error' in result) throw new TerminalRefused(result.error);
      if (open.size >= limit) {
        const unread = [...open.values()]
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
      terminal.pty.onExit(({ exitCode }) => {
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
