import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import type { AppWindow } from '../src/app-window.js';
import { run, type NexusContext } from '../src/main.js';
import { announce } from '../src/registry.js';

const dir = tempDir();
const cache = join(dir, 'cache');
const viewer = join(dir, 'viewer');
let symbiote: Server;
let symbioteUrl = '';

beforeAll(async () => {
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
  }: {
    during?: (url: string) => Promise<void>;
    openApp?: NexusContext['openApp'];
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
    env: { SYMBIOTE_CACHE_DIR: cache, SYMBIOTE_VIEWER_DIR: viewer },
    openUrl: (url) => opened.push(url),
    ...(openApp
      ? {
          openApp: (url: string, title: string) => {
            asked.push([url, title]);
            return openApp(url, title);
          },
        }
      : {}),
    waitForExit: async () => {
      const url = /Symbiote nexus: (\S+)/.exec(out)?.[1] ?? '';
      await during?.(url);
      stop();
      return stopped;
    },
  };
  const code = await run(argv, ctx);
  return { code, out, err, opened, asked };
}

describe('symbiote-nexus', () => {
  it('says how to run it', async () => {
    const { code, out } = await nexus(['--help']);
    expect(code).toBe(0);
    expect(out).toContain('Usage: symbiote-nexus [options]');
    expect(out).toContain('--browser');
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
});
