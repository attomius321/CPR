import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pino, type Logger } from 'pino';
import { dayOf, logsDir, nextDay } from './folder.js';

type Env = Readonly<Record<string, string | undefined>>;

/** A program's log. */
export interface Log {
  /** Writes a line, `log.error({ err, path }, 'request failed')`; nothing when the log is off. */
  log: Logger;
  /** The day's file written to; null when off, or when the folder could not be opened. */
  readonly file: string | null;
  /**
   * A logger for another program's lines, into the same file: the server writes the pages'
   * errors as `viewer`. (A child logger would repeat the `process` key.)
   */
  as(process: string): Logger;
}

export interface OpenLogOptions {
  /** Which Symbiote program writes (`view`, `analysis`, `app`…): `process` in every line. */
  process: string;
  /** `SYMBIOTE_LOG`, `SYMBIOTE_LOG_LEVEL`, `SYMBIOTE_LOG_DIR` and the cache folder's. */
  env: Env;
  platform?: NodeJS.Platform;
  home?: string;
  /** The clock, which says which day's file a line goes to. */
  now?: () => Date;
}

const LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

/** What is never written, whatever a caller passes (decision 356): tokens and credentials. */
const REDACT = ['token', '*.token', 'authorization', '*.authorization', '*.headers.authorization'];

/** A logger that writes nothing: `SYMBIOTE_LOG=off`, tests, a folder that cannot be opened. */
export function silentLog(): Log {
  const log = pino({ enabled: false });
  return { log, file: null, as: () => log };
}

/**
 * Opens a program's log (LG1, decisions 349 and 351): one JSON object a line, appended to the
 * local day's `<logs>/<YYYY-MM-DD>.jsonl`, which every Symbiote process shares; the time as ISO
 * text and the level as a word, so another app (Loki, lnav) and a person read it as it is.
 * Each line is written synchronously in one `write`: on disk when the call returns, so a crash
 * loses nothing, and whole however many processes append. Logging never stops a program: a
 * folder that cannot be opened, or a write that fails, writes nothing.
 */
export function openLog(options: OpenLogOptions): Log {
  const { env } = options;
  if (env.SYMBIOTE_LOG === 'off') return silentLog();
  const dir = logsDir(env, options.platform ?? process.platform, options.home ?? homedir());
  const now = options.now ?? (() => new Date());
  let day: { file: string; fd: number; until: number };
  try {
    mkdirSync(dir, { recursive: true });
    day = openDay(dir, now());
  } catch {
    return silentLog();
  }
  const destination = {
    write(line: string) {
      const at = now();
      if (at.getTime() >= day.until) {
        try {
          const next = openDay(dir, at);
          closeSync(day.fd);
          day = next;
        } catch {
          // The next day's file cannot be opened: this one is written on.
        }
      }
      try {
        writeSync(day.fd, line);
      } catch {
        // A full disk, a folder removed: the line is lost, the program goes on.
      }
    },
  };
  const level = LEVELS.has(env.SYMBIOTE_LOG_LEVEL ?? '') ? (env.SYMBIOTE_LOG_LEVEL ?? '') : 'info';
  const logger = (name: string) =>
    pino(
      {
        level,
        base: { pid: process.pid, process: name },
        timestamp: () => `,"time":"${now().toISOString()}"`,
        formatters: { level: (label) => ({ level: label }) },
        redact: { paths: REDACT, censor: '[redacted]' },
      },
      destination,
    );
  const others = new Map<string, Logger>();
  return {
    log: logger(options.process),
    get file() {
      return day.file;
    },
    as(name) {
      let other = others.get(name);
      if (!other) others.set(name, (other = logger(name)));
      return other;
    },
  };
}

function openDay(dir: string, at: Date) {
  const file = join(dir, `${dayOf(at)}.jsonl`);
  return { file, fd: openSync(file, 'a'), until: nextDay(at) };
}

/**
 * Records an uncaught exception or unhandled rejection as `fatal`, with its stack and origin
 * (decision 352). It only watches (`uncaughtExceptionMonitor`): Node still ends the process with
 * 1 and prints the stack, and Electron's main process still shows its dialog. The line is on disk
 * before that, since every line is written synchronously.
 */
export function watchUncaught({ log }: Log): void {
  process.on('uncaughtExceptionMonitor', (err, origin) => {
    const message = origin === 'unhandledRejection' ? 'unhandled rejection' : 'uncaught exception';
    log.fatal({ err, origin }, message);
  });
}
