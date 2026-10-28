// Symbiote's window for the nexus (decision 524): the desktop app in the `--url` mode `symbiote
// view` starts it in, found and started as `packages/cli/src/app.ts` does. A copy, not an import:
// the CLI's modules load the engine (decision 527); `test/app-window.test.ts` runs the CLI's cases.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

type Env = Readonly<Record<string, string | undefined>>;

/** How to start Symbiote's desktop app (N1). */
export interface AppCommand {
  command: string;
  args: string[];
}

/** The app's window on the nexus, once it shows it. */
export interface AppWindow {
  /** Resolves when the window closes (the app ends). */
  closed: Promise<void>;
  close(): void;
}

/**
 * Symbiote's desktop app, when it is set up: Electron's binary (`pnpm app:setup` fetches it) and
 * the built app. `SYMBIOTE_APP=off` never opens it; `SYMBIOTE_APP=<command>` runs that command
 * instead.
 */
export function findApp(env: Env): AppCommand | null {
  const chosen = env.SYMBIOTE_APP;
  if (chosen === 'off') return null;
  if (chosen) return existsSync(chosen) ? { command: chosen, args: [] } : null;
  try {
    const require = createRequire(import.meta.url);
    const desktop = dirname(require.resolve('@symbiote/desktop/package.json'));
    // Electron's package answers its binary's path, and throws while it is not downloaded.
    const electron: unknown = createRequire(join(desktop, 'package.json'))('electron');
    if (typeof electron !== 'string' || !existsSync(electron)) return null;
    if (!existsSync(join(desktop, 'dist', 'main.js'))) return null;
    return { command: electron, args: [desktop] };
  } catch {
    return null;
  }
}

/** Chromium's words when the system refuses its sandbox (Ubuntu 23.10 and later: AppArmor). */
const SANDBOX_REFUSED = /No usable sandbox|SUID sandbox helper binary/;
const SANDBOX =
  "Chromium's sandbox is not allowed here (AppArmor): see Symbiote's window in the README";

/**
 * Opens the app's window on `url`. Resolves once the app says it shows the page (its
 * `Symbiote window:` line), or with why it ended first: its own `symbiote app:` words, else its
 * exit.
 */
export function openAppWindow(
  app: AppCommand,
  url: string,
  title: string,
  env: Env,
): Promise<AppWindow | { error: string }> {
  // Set where Electron runs as Node (VS Code's processes): the app would not open a window.
  const appEnv = { ...env };
  delete appEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(app.command, [...app.args, '--url', url, '--title', title], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: appEnv,
  });
  const closed = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
  return new Promise((resolve) => {
    let out = '';
    let said = '';
    child.stdout.on('data', (data: Buffer) => {
      out = (out + data.toString()).slice(-4096);
      if (/^Symbiote window: /m.test(out)) resolve({ closed, close: () => child.kill('SIGTERM') });
    });
    // Chromium writes much to stderr; only the app's own line says what went wrong.
    let err = '';
    child.stderr.on('data', (data: Buffer) => {
      err += data.toString();
      for (const line of err.split('\n').slice(0, -1)) {
        if (line.startsWith('symbiote app: ')) said = line.slice('symbiote app: '.length);
        else if (SANDBOX_REFUSED.test(line)) said = SANDBOX;
      }
      err = err.slice(err.lastIndexOf('\n') + 1);
    });
    child.once('error', (error) => resolve({ error: error.message }));
    // After its output is read: its last words come before the end.
    child.once('close', (code, signal) =>
      resolve({ error: said || `it exited with ${code ?? signal ?? 'nothing'}` }),
    );
  });
}

/** Opens `url` in the person's browser, best effort: the address is printed anyway. */
export function openUrl(url: string): void {
  const [command, ...args] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // No browser to open.
  }
}
