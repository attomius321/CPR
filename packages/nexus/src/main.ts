import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Log } from '@symbiote/log';
import { findApp, openAppWindow, openUrl, type AppWindow } from './app-window.js';
import { folders, repositoryRoot, windowsDrives } from './folders.js';
import { cacheDir, isRunning, readRecords } from './registry.js';
import { configDir, hiveOn } from './hive.js';
import { pins, PINS_FILE } from './pins.js';
import { startNexusServer } from './server.js';
import { starter } from './start.js';
import { liveSymbiotes, readStatus, type Probe } from './symbiotes.js';

type Env = Readonly<Record<string, string | undefined>>;

/** What `symbiote-nexus` reaches of its process: tests give their own. */
export interface NexusContext {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Env;
  /** Opens a URL in the person's browser (best effort). */
  openUrl: (url: string) => void;
  /**
   * Opens Symbiote's window on the nexus: the window once it shows the page, why it did not
   * open, or null when the desktop app is not set up.
   */
  openApp?: (url: string, title: string) => Promise<AppWindow | { error: string } | null>;
  /** Resolves when the nexus should stop: Ctrl+C. */
  waitForExit: () => Promise<void>;
  /** Symbiote's logs (LG1); without it, nothing is written. */
  log?: Log;
}

const HELP = `Usage: symbiote-nexus [options]

Every symbiote view running on this machine, as tabs in one window: Symbiote's
window when the desktop app is set up, else the browser. Pick a tab to work in
that Symbiote; the ones opened stay loaded. Folders shows this PC's folders:
open a Symbiote in any repository there. Symbiotes started so run on after the
nexus ends; stop one from its row.

Options:
  --browser      Open a browser tab, not Symbiote's window
  --no-open      Print the address only
  --port <n>     The port to serve on (default: any free one)
  -h, --help     Show this help
`;

const OPTIONS = {
  browser: { type: 'boolean', default: false },
  'no-open': { type: 'boolean', default: false },
  port: { type: 'string', default: '0' },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

/** The window's title and the taskbar's. */
const TITLE = 'Symbiote nexus';

/** The page's own files, beside `dist` (or `src`, in the tests). */
const PAGE_DIR = fileURLToPath(new URL('../page/', import.meta.url));
/** The page's scripts, compiled beside this module. */
const SCRIPTS_DIR = fileURLToPath(new URL('./page/', import.meta.url));
/** This checkout's CLI, beside the nexus's own build: what Open Symbiote runs (decision 541). */
const CLI_SCRIPT = fileURLToPath(new URL('../../cli/dist/bin.js', import.meta.url));

/** `symbiote-nexus`: serves the page until Ctrl+C, or until its window closes. */
export async function run(argv: string[], ctx: NexusContext): Promise<number> {
  let values: { browser: boolean; 'no-open': boolean; port: string; help: boolean };
  try {
    ({ values } = parseArgs({ args: argv, options: OPTIONS, strict: true }));
  } catch (error) {
    return usage(ctx, (error as Error).message);
  }
  if (values.help) {
    ctx.stdout(HELP);
    return 0;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return usage(ctx, `--port must be a port number, got '${values.port}'`);
  }
  const log = ctx.log?.log;
  const home = homedir();
  const cache = cacheDir(ctx.env, process.platform, home);
  const probe: Probe = { alive: isRunning, status: (url) => readStatus(url) };
  const live = () => liveSymbiotes(readRecords(cache), probe);
  const drives = windowsDrives();
  const config = configDir(ctx.env, process.platform, home);
  let server;
  try {
    server = await startNexusServer({
      port,
      symbiotes: live,
      folders: async (path) => {
        const newest = (await live()).sort((a, b) => b.started.localeCompare(a.started));
        return folders(path, { home, roots: newest.map((symbiote) => symbiote.root), drives });
      },
      starter: starter({
        cache,
        node: process.execPath,
        script: CLI_SCRIPT,
        env: ctx.env,
        probe,
        repositoryOf: repositoryRoot,
        ...(log ? { log } : {}),
      }),
      pins: pins({ file: join(config, PINS_FILE), home }),
      pageDir: PAGE_DIR,
      scriptsDir: SCRIPTS_DIR,
      viewerDir: viewerDir(ctx.env),
      hive: () => hiveOn(config),
      ...(log ? { log } : {}),
    });
  } catch (error) {
    ctx.stderr(`symbiote-nexus: ${(error as Error).message}\n`);
    return 1;
  }
  // Written before the address is printed: what waits for that line finds it written.
  log?.info({ url: server.url, cache, node: process.version }, 'nexus started');
  ctx.stdout(`Symbiote nexus: ${server.url}  (Ctrl+C to stop)\n`);
  try {
    await showUntilExit(server.url, values, ctx);
  } finally {
    await server.close();
    log?.info('nexus stopped');
  }
  return 0;
}

/** Shows the page as `symbiote view` shows its own: the app's window, else the browser. */
async function showUntilExit(
  url: string,
  args: { browser: boolean; 'no-open': boolean },
  ctx: NexusContext,
): Promise<void> {
  if (args['no-open']) return ctx.waitForExit();
  const shown = args.browser ? null : await ctx.openApp?.(url, TITLE);
  if (shown && 'closed' in shown) {
    ctx.stdout(`${TITLE}'s window is open: close it, or Ctrl+C, to stop\n`);
    await Promise.race([ctx.waitForExit(), shown.closed]);
    shown.close();
    return;
  }
  if (shown) {
    ctx.stderr(
      `symbiote-nexus: Symbiote's window did not open (${shown.error}); opening the browser\n`,
    );
  }
  ctx.openUrl(url);
  return ctx.waitForExit();
}

function usage(ctx: NexusContext, message: string): number {
  ctx.stderr(`symbiote-nexus: ${message}\n\n${HELP}`);
  return 2;
}

/** The viewer's build, for its stylesheet: `SYMBIOTE_VIEWER_DIR`, as `symbiote view` reads it. */
function viewerDir(env: Env): string {
  if (env.SYMBIOTE_VIEWER_DIR) return env.SYMBIOTE_VIEWER_DIR;
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('@symbiote/viewer/package.json')), 'dist');
}

/** The process's own context: its output, the browser, the app, Ctrl+C. */
export function processContext(): NexusContext {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    openUrl,
    openApp: (url, title) => {
      const app = findApp(process.env);
      return app ? openAppWindow(app, url, title, process.env) : Promise.resolve(null);
    },
    waitForExit: () =>
      new Promise((resolve) => {
        process.once('SIGINT', () => resolve());
        process.once('SIGTERM', () => resolve());
      }),
  };
}
