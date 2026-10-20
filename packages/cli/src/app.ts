import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CprError } from '@cpr/core';

type Env = Readonly<Record<string, string | undefined>>;

/** How to start CPR's desktop app (N1). */
export interface AppCommand {
  command: string;
  args: string[];
}

/** The app's window on a viewer, once it shows it. */
export interface AppWindow {
  /** Resolves when the window closes (the app ends). */
  closed: Promise<void>;
  close(): void;
}

/**
 * CPR's desktop app, when it is set up: Electron's binary (`pnpm app:setup` fetches it) and the
 * built app. `CPR_APP=off` never opens it; `CPR_APP=<command>` runs that command instead.
 */
export function findApp(env: Env): AppCommand | null {
  const chosen = env.CPR_APP;
  if (chosen === 'off') return null;
  if (chosen) return existsSync(chosen) ? { command: chosen, args: [] } : null;
  try {
    const require = createRequire(import.meta.url);
    const desktop = dirname(require.resolve('@cpr/desktop/package.json'));
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
const SANDBOX = "Chromium's sandbox is not allowed here (AppArmor): see CPR's window in the README";

/**
 * Opens the app's window on `url`. Resolves once the app says it shows the page (its
 * `CPR window:` line), or with why it ended first: its own `cpr app:` words, else its exit.
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
      if (/^CPR window: /m.test(out)) resolve({ closed, close: () => child.kill('SIGTERM') });
    });
    // Chromium writes much to stderr; only the app's own line says what went wrong.
    let err = '';
    child.stderr.on('data', (data: Buffer) => {
      err += data.toString();
      for (const line of err.split('\n').slice(0, -1)) {
        if (line.startsWith('cpr app: ')) said = line.slice('cpr app: '.length);
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

/**
 * The launcher entry (a Desktop Entry file) that starts the app from the desktop's menus. Each
 * argument of Exec is quoted as the spec asks, then the file's own escape of backslashes.
 */
export function desktopEntry(app: AppCommand, icon: string): string {
  const exec = [app.command, ...app.args].map(quoteExec).join(' ');
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=CPR',
    'GenericName=Code review',
    'Comment=Review changes as a graph of symbols, with your agents’ workspaces',
    `Exec=${escapeValue(exec)}`,
    `Icon=${escapeValue(icon)}`,
    'Terminal=false',
    'Categories=Development;',
    // Electron names its windows' class after the app: the desktop matches them to this entry.
    'StartupWMClass=CPR',
    '',
  ].join('\n');
}

const quoteExec = (arg: string) =>
  `"${arg.replace(/["`$\\]/g, (char) => `\\${char}`).replaceAll('%', '%%')}"`;
const escapeValue = (value: string) => value.replaceAll('\\', '\\\\');

interface Where {
  env: Env;
  platform: NodeJS.Platform;
}

/** Where `cpr app install` writes, by the XDG base directories. */
function places({ env }: Where) {
  const home = env.HOME ?? homedir();
  const data = env.XDG_DATA_HOME ?? join(home, '.local', 'share');
  const config = join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'cpr');
  return {
    entry: join(data, 'applications', 'cpr.desktop'),
    icon: join(data, 'icons', 'hicolor', '512x512', 'apps', 'cpr.png'),
    // Read by the app (packages/desktop, `readRecorded`).
    recorded: join(config, 'app.json'),
  };
}

function record(file: string, node: string, cli: string, env: Env): void {
  mkdirSync(dirname(file), { recursive: true });
  const recorded = { node, cli, ...(env.PATH === undefined ? {} : { path: env.PATH }) };
  writeFileSync(file, `${JSON.stringify(recorded, null, 2)}\n`);
}

/**
 * Adds CPR to the desktop's apps, for this user (N1b): the launcher entry, its icon, and what
 * the app needs to start `cpr view` without a shell — this node, this CLI and `PATH`. Linux only.
 */
export function installApp(
  where: Where & { app: AppCommand; icon: string; node: string; cli: string },
): string {
  if (where.platform !== 'linux') {
    throw new CprError(`cpr app install is not supported on ${where.platform} yet`);
  }
  const { entry, icon, recorded } = places(where);
  mkdirSync(dirname(icon), { recursive: true });
  copyFileSync(where.icon, icon);
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, desktopEntry(where.app, icon));
  record(recorded, where.node, where.cli, where.env);
  return [
    `CPR is in your desktop's apps: ${entry}`,
    `It starts cpr view with ${where.node} and ${where.cli}, on the PATH of this shell`,
    `(recorded in ${recorded}, and again by each cpr view that opens CPR's window).`,
    '',
  ].join('\n');
}

/** Removes what `installApp` added. The windows' remembered state stays. */
export function uninstallApp(where: Where): string {
  const { entry, icon, recorded } = places(where);
  for (const file of [entry, icon, recorded]) rmSync(file, { force: true });
  return `CPR is no longer in your desktop's apps (${entry} removed).\n`;
}

/** Once installed, records this node, CLI and `PATH` again: the latest shell's are kept. */
export function recordAgain(where: Where & { node: string; cli: string }): void {
  const { recorded } = places(where);
  if (existsSync(recorded)) record(recorded, where.node, where.cli, where.env);
}
