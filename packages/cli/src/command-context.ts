// The context a command runs in (CliContext): its folder, output, environment, browser, window and
// Ctrl+C; this process's own, and Symbiote's version.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import type { AnalysisPhase } from '@symbiote/core';
import type { Log } from '@symbiote/log';
import { findApp, openAppWindow, recordAgain, type AppWindow } from './app.js';
import type { PhaseMessage } from './runner.js';

const require = createRequire(import.meta.url);
export const { version } = require('../package.json') as { version: string };

export interface CliContext {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Opens a URL in the user's browser (best effort). */
  openUrl: (url: string) => void;
  /**
   * Opens the viewer in Symbiote's own window (N1): the window once it shows the page, why it did
   * not open, or null when the desktop app is not set up.
   */
  openApp?: (url: string, title: string) => Promise<AppWindow | { error: string } | null>;
  /** Resolves when a long-running command (`view`) should stop: Ctrl+C. */
  waitForExit: () => Promise<void>;
  /** Environment: tokens, API URLs, `SYMBIOTE_*` settings. */
  env: Readonly<Record<string, string | undefined>>;
  /** Told each phase of an analysis as it starts: set when `symbiote view` runs this CLI. */
  onPhase?: (phase: AnalysisPhase) => void;
  /** The process's own input and output, where `symbiote mcp` speaks MCP (MC1). */
  stdio?: { input: Readable; output: Writable };
  /** Symbiote's logs (LG1); without it, nothing is written. */
  log?: Log;
}

/** This CLI's script, which `symbiote view` runs to analyze a pair of commits. */
export const CLI_SCRIPT = fileURLToPath(new URL('./bin.js', import.meta.url));

/** This process's context: its folder, output, environment and Ctrl+C. */
export const processContext = (): CliContext => ({
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  openUrl,
  openApp: (url, title) => {
    const app = findApp(process.env);
    if (!app) return Promise.resolve(null);
    // The launcher's app starts symbiote view with what this shell has (decision 197).
    const where = { env: process.env, platform: process.platform };
    recordAgain({ ...where, node: process.execPath, cli: CLI_SCRIPT });
    return openAppWindow(app, url, title, process.env);
  },
  env: process.env,
  stdio: { input: process.stdin, output: process.stdout },
  // Started by `symbiote view` with an IPC channel: phases go back to it.
  ...(process.send ? { onPhase: (phase) => process.send?.({ phase } satisfies PhaseMessage) } : {}),
  waitForExit: () =>
    new Promise((resolve) => {
      process.once('SIGINT', () => resolve());
      process.once('SIGTERM', () => resolve());
      // Started by Symbiote's app from the desktop (N1b): it stops with the app, even one that
      // died.
      if (process.env.SYMBIOTE_STDIN_STOPS === '1') {
        process.stdin.once('end', () => resolve());
        process.stdin.resume();
      }
    }),
});

function openUrl(url: string): void {
  const [command, ...args] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined); // no browser available: the URL is printed anyway
    child.unref();
  } catch {
    // ignore
  }
}
