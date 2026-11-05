import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import type { AppWindow } from '../src/app-window.js';
import { DEFAULT_PORT, run, type NexusContext } from '../src/main.js';
import { announce } from '../src/registry.js';

const dir = tempDir();
const cache = join(dir, 'cache');
/** The home scanned (decision 925): the test's own, never the person's. */
const home = join(dir, 'home');
const viewer = join(dir, 'viewer');
let symbiote: Server;
let symbioteUrl = '';

beforeAll(async () => {
  mkdirSync(join(home, 'projects', 'zod', '.git'), { recursive: true });
  mkdirSync(join(home, 'notes'), { recursive: true });
  mkdirSync(join(viewer, 'assets'), { recursive: true });
  writeFileSync(join(viewer, 'index.html'), '<link rel="stylesheet" href="./assets/index-a.css">');
  writeFileSync(join(viewer, 'assets', 'index-a.css'), '');
  // A running Symbiote: its status, and its record as `symbiote view` leaves it.
  symbiote = createServer((_req, res) =>
    res.end('{"branch":"main","head":"a1b2c3d","version":"v","changed":0,"operation":null}'),
  );
  await new Promise<void>((resolve) => symbiote.listen(0, '127.0.0.1', resolve));
  const address = symbiote.address();
  symbioteUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
  await announce(cache, {
    url: symbioteUrl,
    pid: process.pid,
    root: '/home/me/ky',
    name: 'ky',
    started: '2026-10-28T10:00:00.000Z',
  });
});

afterAll(() => {
  symbiote.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Runs `symbiote-nexus` with `argv`; `during` runs once it serves (its address read from its
 * line), then the run is stopped as Ctrl+C would.
 */
async function nexus(
  argv: string[],
  {
    during,
    openApp,
    env = {},
  }: {
    during?: (url: string) => Promise<void>;
    openApp?: NexusContext['openApp'];
    env?: NexusContext['env'];
  } = {},
) {
  let out = '';
  let err = '';
  const opened: string[] = [];
  const asked: [string, string][] = [];
  let stop = () => undefined as void;
  const stopped = new Promise<void>((resolve) => (stop = resolve));
  const ctx: NexusContext = {
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
    env: { SYMBIOTE_CACHE_DIR: cache, SYMBIOTE_VIEWER_DIR: viewer, ...env },
    openUrl: (url) => opened.push(url),
    ...(openApp
      ? {
          openApp: (url: string, title: string) => {
            asked.push([url, title]);
            return openApp(url, title);
          },
        }
      : {}),
    home,
    waitForExit: async () => {
      const url = /Symbiote nexus: (\S+)/.exec(out)?.[1] ?? '';
      await during?.(url);
      stop();
      return stopped;
    },
  };
  // Never the default port: other workspaces run these tests at once, and the person's nexus may
  // serve there (decision 923).
  const code = await run(argv.includes('--port') ? argv : ['--port', '0', ...argv], ctx);
  return { code, out, err, opened, asked };
}

describe('symbiote-nexus', () => {
  it('says how to run it', async () => {
    const { code, out } = await nexus(['--help']);
    expect(code).toBe(0);
    expect(out).toContain('Usage: symbiote-nexus [options]');
    expect(out).toContain('--browser');
    expect(out).toContain('--port <n>     The port to serve on (default: 7347; 0: any free one)');
    expect(DEFAULT_PORT).toBe(7347);
  });

  it('refuses what it does not know, with its usage', async () => {
    const port = await nexus(['--port', 'eighty']);
    expect(port.code).toBe(2);
    expect(port.err).toContain("symbiote-nexus: --port must be a port number, got 'eighty'");
    expect(port.err).toContain('Usage: symbiote-nexus');
    const other = await nexus(['--repo', 'ky']);
    expect(other.code).toBe(2);
    expect(other.err).toContain("Unknown option '--repo'");
    expect((await nexus(['ky'])).code).toBe(2);
  });

  it('with --no-open, serves the running Symbiotes at its address, and opens nothing', async () => {
    let listed: unknown;
    const result = await nexus(['--no-open'], {
      during: async (url) => {
        listed = await (await fetch(new URL('api/symbiotes', url))).json();
      },
      openApp: () => Promise.resolve(null),
    });
    expect(result.code).toBe(0);
    expect(result.out).toMatch(
      /^Symbiote nexus: http:\/\/127\.0\.0\.1:\d+\/ {2}\(Ctrl\+C to stop\)\n$/,
    );
    expect(listed).toEqual({
      symbiotes: [
        {
          url: symbioteUrl,
          pid: process.pid,
          root: '/home/me/ky',
          name: 'ky',
          started: '2026-10-28T10:00:00.000Z',
          branch: 'main',
          head: 'a1b2c3d',
          changed: 0,
        },
      ],
    });
    expect(result.opened).toEqual([]);
    expect(result.asked).toEqual([]);
  });

  it("never takes Hive mode's look: each tab shows its own Symbiote's (fix/hive-per-symbiote)", async () => {
    // V82's record in the settings folder, on: the nexus read it for its own page.
    const config = join(dir, 'config');
    mkdirSync(join(config, 'symbiote'), { recursive: true });
    writeFileSync(join(config, 'symbiote', 'hive.json'), '{"on":true}');
    let page = '';
    const result = await nexus(['--no-open'], {
      during: async (url) => {
        page = await (await fetch(url)).text();
      },
      openApp: () => Promise.resolve(null),
      env: { XDG_CONFIG_HOME: config, APPDATA: config },
    });
    expect(result.code).toBe(0);
    expect(page).toContain('<html');
    expect(page).not.toContain('data-hive');
  });

  it("lists this PC's folders, and starts a Symbiote only in one (NX2)", async () => {
    mkdirSync(join(dir, 'projects', 'ky', '.git'), { recursive: true });
    let listed: { path: string; folders: unknown[]; places: { name: string }[] } | undefined;
    let started: { status: number; body: unknown } | undefined;
    await nexus(['--no-open'], {
      during: async (url) => {
        const path = encodeURIComponent(join(dir, 'projects'));
        listed = (await (await fetch(new URL(`api/folders?path=${path}`, url))).json()) as never;
        const res = await fetch(new URL('api/symbiotes', url), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
          body: JSON.stringify({ folder: join(dir, 'missing') }),
        });
        started = { status: res.status, body: await res.json() };
      },
    });
    expect(listed?.path).toBe(join(dir, 'projects'));
    expect(listed?.folders).toEqual([
      { name: 'ky', path: join(dir, 'projects', 'ky'), repository: true },
    ]);
    expect(listed?.places.map((place) => place.name)).toEqual(
      expect.arrayContaining(['Home', '/']),
    );
    expect(started).toEqual({
      status: 422,
      body: { error: `No such folder: ${join(dir, 'missing')}` },
    });
  });

  it("opens Symbiote's window when the app is set up, and ends when it closes", async () => {
    let close = () => undefined as void;
    const closed = new Promise<void>((resolve) => (close = resolve));
    let closedByNexus = false;
    const window: AppWindow = { closed, close: () => (closedByNexus = true) };
    const result = await nexus([], {
      // The person closes the window; Ctrl+C never comes.
      during: () => new Promise(() => setTimeout(close, 20)),
      openApp: () => Promise.resolve(window),
    });
    expect(result.code).toBe(0);
    const url = /Symbiote nexus: (\S+)/.exec(result.out)?.[1];
    expect(result.asked).toEqual([[url, 'Symbiote nexus']]);
    expect(result.out).toContain("Symbiote nexus's window is open: close it, or Ctrl+C, to stop\n");
    expect(result.opened).toEqual([]);
    expect(closedByNexus).toBe(true);
  });

  it('opens the browser when the window does not open, and says why', async () => {
    const result = await nexus([], {
      openApp: () => Promise.resolve({ error: 'it exited with 1' }),
    });
    const url = /Symbiote nexus: (\S+)/.exec(result.out)?.[1];
    expect(result.err).toBe(
      "symbiote-nexus: Symbiote's window did not open (it exited with 1); opening the browser\n",
    );
    expect(result.opened).toEqual([url]);
  });

  it('opens the browser without the app, and with --browser', async () => {
    const without = await nexus([], { openApp: () => Promise.resolve(null) });
    expect(without.opened).toHaveLength(1);
    const browser = await nexus(['--browser'], { openApp: () => Promise.resolve(null) });
    expect(browser.opened).toHaveLength(1);
    expect(browser.asked).toEqual([]);
  });

  it('opens the nexus already serving on its port, and serves no second one (decision 924)', async () => {
    let second: Awaited<ReturnType<typeof nexus>> | undefined;
    let firstUrl = '';
    await nexus(['--no-open'], {
      during: async (url) => {
        firstUrl = url;
        const port = new URL(url).port;
        second = await nexus(['--port', port], { openApp: () => Promise.resolve(null) });
      },
    });
    expect(second?.code).toBe(0);
    expect(second?.out).toBe(`Symbiote nexus already runs at ${firstUrl}\n`);
    expect(second?.opened).toEqual([firstUrl]);
  });

  it("opens Symbiote's window on the nexus already serving, until it closes", async () => {
    let second: Awaited<ReturnType<typeof nexus>> | undefined;
    let firstUrl = '';
    await nexus(['--no-open'], {
      during: async (url) => {
        firstUrl = url;
        second = await nexus(['--port', new URL(url).port], {
          openApp: () => Promise.resolve({ closed: Promise.resolve(), close: () => undefined }),
        });
      },
    });
    expect(second?.code).toBe(0);
    expect(second?.asked).toEqual([[firstUrl, 'Symbiote nexus']]);
    expect(second?.opened).toEqual([]);
  });

  it('says another program holds the port, naming --port (decision 924)', async () => {
    const other = createServer((_req, res) => res.end('not a nexus'));
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    const address = other.address();
    const port = String(typeof address === 'object' && address ? address.port : 0);
    try {
      const result = await nexus(['--port', port], { openApp: () => Promise.resolve(null) });
      expect(result.code).toBe(1);
      expect(result.err).toBe(
        `symbiote-nexus: port ${port} is in use by another program: choose another with --port <n>\n`,
      );
      expect(result.opened).toEqual([]);
    } finally {
      other.close();
    }
  });

  it('scans home at its start and on the button only, never on a read (decision 925)', async () => {
    const at: string[] = [];
    let tree = null as { tree: string[] } | null;
    await nexus(['--no-open'], {
      during: async (url) => {
        const scanAt = async () => {
          const known = (await (await fetch(new URL('api/repositories', url))).json()) as {
            scan: { at: string; folder: string } | null;
          };
          return known.scan;
        };
        let scan = await scanAt();
        while (scan === null) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          scan = await scanAt();
        }
        expect(scan.folder).toBe(home);
        at.push(scan.at);
        // The page's reads, every 2 s: none scans.
        for (let i = 0; i < 5; i++) {
          await fetch(new URL('api/symbiotes', url));
          at.push((await scanAt())?.at ?? '');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const answer = (await (await fetch(new URL('api/tree', url))).json()) as {
          tree: { tree: string[] };
        };
        tree = answer.tree;
        const again = await fetch(new URL('api/scan', url), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
          body: '{}',
        });
        at.push(((await again.json()) as { scan: { at: string } }).scan.at);
      },
      // A cache of its own: no scan kept from another test answers before the start's.
      env: { SYMBIOTE_CACHE_DIR: join(dir, 'scan-cache') },
    });
    expect(new Set(at.slice(0, 6)).size).toBe(1);
    expect(at[6]).not.toBe(at[0]);
    expect(tree?.tree).toEqual([
      join(home, 'notes'),
      join(home, 'projects'),
      join(home, 'projects', 'zod'),
    ]);
  });
});
