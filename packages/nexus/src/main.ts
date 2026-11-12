import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Log } from '@symbiote/log';
import { findApp, openAppWindow, openUrl, type AppWindow } from './app-window.js';
import { checkoutsOf } from './checkouts.js';
import { folders, repositoryRoot, windowsDrives } from './folders.js';
import { opener } from './init.js';
import { history } from './opened.js';
import { cacheDir, isRunning, readRecords } from './registry.js';
import { configDir } from './config-dir.js';
import { pins, PINS_FILE } from './pins.js';
import { knownRepositories, scanSummary, scanTree } from './repositories.js';
import { scanner } from './scan.js';
import { startNexusServer } from './server.js';
import { frameAddress } from './frame-address.js';
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
  /** The person's home, scanned (decision 925): the process's own by default. */
  home?: string;
}

const HELP = `Usage: symbiote-nexus [options]

Every symbiote view running on this machine, as tabs in one window: Symbiote's
window when the desktop app is set up, else the browser. Pick a tab to work in
that Symbiote; the ones opened stay loaded. Home's folders are listed as a
tree, scanned at the start and on the list's scan button: open a Symbiote in a
repository, or make a folder one (git init, after a question). Symbiotes
started so run on after the nexus ends; stop one from its card. A second
symbiote-nexus on the same port opens the one running.

Options:
  --browser      Open a browser tab, not Symbiote's window
  --no-open      Print the address only
  --port <n>     The port to serve on (default: 7347; 0: any free one)
  -h, --help     Show this help
`;

/**
 * The nexus's port (decision 923): one address to come back to, below every system's range of
 * ports handed out at random (Linux 32768–60999, Windows and macOS 49152–65535), so no Symbiote's
 * random port takes it. Tests pass `--port 0`.
 */
export const DEFAULT_PORT = 7347;

const OPTIONS = {
  browser: { type: 'boolean', default: false },
  'no-open': { type: 'boolean', default: false },
  port: { type: 'string', default: String(DEFAULT_PORT) },
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
  const home = ctx.home ?? homedir();
  const cache = cacheDir(ctx.env, process.platform, home);
  const probe: Probe = { alive: isRunning, status: (url) => readStatus(url) };
  // What the nexus remembers (NX5, decision 912) and the scan of home (NX6, decision 925), in its
  // cache folder; Symbiote's cache (its worktrees) is never scanned.
  const opened = history({ file: join(cache, 'nexus', 'opened.json') });
  const live = async () => {
    const running = await liveSymbiotes(readRecords(cache), probe);
    opened.note(running).catch((error: unknown) => {
      log?.warn({ err: error }, 'the Symbiotes seen could not be written');
    });
    return running;
  };
  const drives = windowsDrives();
  const config = configDir(ctx.env, process.platform, home);
  const kept = pins({ file: join(config, PINS_FILE), home });
  const scans = scanner({
    folder: home,
    file: join(cache, 'nexus', 'scan.json'),
    options: { leaveOut: [cache, config] },
  });
  const scanned = async () => {
    const result = await scans.scan();
    if (result) {
      const { folder, folders, ms, short } = result;
      log?.info(
        { folder, folders, ms, short, repositories: result.repositories.length },
        'scanned',
      );
    }
    return scanSummary(result);
  };
  const starting = starter({
    cache,
    node: process.execPath,
    script: CLI_SCRIPT,
    env: ctx.env,
    probe,
    repositoryOf: repositoryRoot,
    ...(log ? { log } : {}),
  });
  let server;
  try {
    server = await startNexusServer({
      port,
      symbiotes: live,
      folders: async (path) => {
        const newest = (await live()).sort((a, b) => b.started.localeCompare(a.started));
        return folders(path, { home, roots: newest.map((symbiote) => symbiote.root), drives });
      },
      starter: starting,
      open: opener({
        home,
        cache,
        config,
        drives: drives.map((drive) => drive.path),
        repositoryOf: repositoryRoot,
        start: (folder) => starting.start(folder),
      }),
      pins: kept,
      repositories: async () => {
        const [seen, scan, pinned] = await Promise.all([
          opened.read(),
          scans.current(),
          kept.read(),
        ]);
        return {
          home,
          drives: drives.map((drive) => drive.path),
          repositories: await knownRepositories({ opened: seen, scan }),
          pins: pinned,
          scan: scanSummary(scan),
        };
      },
      checkouts: (path) => checkoutsOf(path, { leaveOut: [cache] }),
      // A frame's address (SC1): only a live Symbiote's, with a token its record lets the nexus ask.
      frameAddress: async (url) => {
        const symbiote = (await live()).find((running) => running.url === url);
        return symbiote ? frameAddress(cache, symbiote) : null;
      },
      // Home is scanned at the start and on the button, never on a read (decision 925).
      scanning: { again: scanned, tree: async () => scanTree(await scans.current()) },
      pageDir: PAGE_DIR,
      scriptsDir: SCRIPTS_DIR,
      viewerDir: viewerDir(ctx.env),
      ...(log ? { log } : {}),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      return alreadyServed(port, values, ctx);
    }
    ctx.stderr(`symbiote-nexus: ${(error as Error).message}\n`);
    return 1;
  }
  // Written before the address is printed: what waits for that line finds it written.
  log?.info({ url: server.url, cache, node: process.version }, 'nexus started');
  // Home scanned at each start; the last scan answers meanwhile.
  void scanned().catch((error: unknown) => log?.warn({ err: error }, 'the scan failed'));
  ctx.stdout(`Symbiote nexus: ${server.url}  (Ctrl+C to stop)\n`);
  try {
    await showUntilExit(server.url, values, ctx);
  } finally {
    await server.close();
    log?.info('nexus stopped');
  }
  return 0;
}

/**
 * The port is taken (decision 924): a nexus serving there is shown, as a start would show it, and
 * left running; anything else is named, with the option that chooses another port.
 */
async function alreadyServed(
  port: number,
  args: { browser: boolean; 'no-open': boolean },
  ctx: NexusContext,
): Promise<number> {
  const url = `http://127.0.0.1:${port}/`;
  if (!(await isNexus(url))) {
    ctx.stderr(
      `symbiote-nexus: port ${port} is in use by another program: choose another with --port <n>\n`,
    );
    return 1;
  }
  ctx.stdout(`Symbiote nexus already runs at ${url}\n`);
  if (args['no-open']) return 0;
  const shown = args.browser ? null : await ctx.openApp?.(url, TITLE);
  if (shown && 'closed' in shown) {
    await shown.closed;
    return 0;
  }
  if (shown) {
    ctx.stderr(
      `symbiote-nexus: Symbiote's window did not open (${shown.error}); opening the browser\n`,
    );
  }
  ctx.openUrl(url);
  return 0;
}

/** Whether a nexus answers at `url`: its `GET /api/nexus`, within a second. */
async function isNexus(url: string): Promise<boolean> {
  try {
    const res = await fetch(new URL('api/nexus', url), { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { nexus?: unknown };
    return body.nexus === true;
  } catch {
    return false;
  }
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
