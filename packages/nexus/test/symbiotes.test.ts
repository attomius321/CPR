import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { Running } from '../src/registry.js';
import { liveSymbiotes, readStatus, type Status } from '../src/symbiotes.js';

const record = (over: Partial<Running> = {}): Running => ({
  url: 'http://127.0.0.1:4100/',
  pid: 100,
  root: '/home/me/ky',
  name: 'ky',
  started: '2026-10-28T10:00:00.000Z',
  ...over,
});

const status = (over: Partial<Status> = {}): Status => ({
  branch: 'main',
  head: 'a1b2c3d',
  changed: 0,
  ...over,
});

describe('liveSymbiotes', () => {
  it('lists the records whose process lives and whose server answers, by name', async () => {
    const records = [
      record({ name: 'zod', root: '/home/me/zod', url: 'http://127.0.0.1:4200/', pid: 200 }),
      record(),
      record({ name: 'gone', root: '/home/me/gone', url: 'http://127.0.0.1:4300/', pid: 300 }),
      record({ name: 'mute', root: '/home/me/mute', url: 'http://127.0.0.1:4400/', pid: 400 }),
    ];
    const live = await liveSymbiotes(records, {
      alive: (pid) => pid !== 300,
      status: (url) =>
        Promise.resolve(
          url.includes('4400') ? null : status({ changed: url.includes('4200') ? 3 : 0 }),
        ),
    });
    expect(live).toEqual([
      { ...record(), branch: 'main', head: 'a1b2c3d', changed: 0 },
      {
        ...record({ name: 'zod', root: '/home/me/zod', url: 'http://127.0.0.1:4200/', pid: 200 }),
        branch: 'main',
        head: 'a1b2c3d',
        changed: 3,
      },
    ]);
  });

  it('asks no server whose process is gone', async () => {
    const asked: string[] = [];
    await liveSymbiotes([record()], {
      alive: () => false,
      status: (url) => {
        asked.push(url);
        return Promise.resolve(status());
      },
    });
    expect(asked).toEqual([]);
  });

  it('keeps the newest of two live servers of one folder: one tab per folder', async () => {
    const older = record({ pid: 101, url: 'http://127.0.0.1:4101/' });
    const newer = record({
      pid: 102,
      url: 'http://127.0.0.1:4102/',
      started: '2026-10-28T11:00:00Z',
    });
    const live = await liveSymbiotes([newer, older], {
      alive: () => true,
      status: () => Promise.resolve(status()),
    });
    expect(live.map((s) => s.url)).toEqual(['http://127.0.0.1:4102/']);
  });

  it('names a detached HEAD by null, as the server does', async () => {
    const [live] = await liveSymbiotes([record()], {
      alive: () => true,
      status: () => Promise.resolve(status({ branch: null })),
    });
    expect(live?.branch).toBeNull();
  });
});

describe('readStatus', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.closeAllConnections();
    if (server?.listening) server.close();
  });

  async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
    server = createServer(handler);
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
  }

  it("reads a Symbiote's branch, head and uncommitted count from its /api/status", async () => {
    let asked = '';
    const url = await serve((req, res) => {
      asked = `${req.url} ${req.headers.host}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"branch":"main","head":"2e30fa9","version":"7a0","changed":2,"operation":null}');
    });
    expect(await readStatus(url)).toEqual({ branch: 'main', head: '2e30fa9', changed: 2 });
    expect(asked).toBe(`/api/status ${new URL(url).host}`);
  });

  it('is null for what is not a Symbiote: another answer, another shape, no server', async () => {
    const notFound = await serve((_req, res) => res.writeHead(404).end('no'));
    expect(await readStatus(notFound)).toBeNull();
    server?.close();
    const other = await serve((_req, res) => res.writeHead(200).end('{"hello":"world"}'));
    expect(await readStatus(other)).toBeNull();
    server?.close();
    const html = await serve((_req, res) => res.writeHead(200).end('<!doctype html>'));
    expect(await readStatus(html)).toBeNull();
    server?.close();
    expect(await readStatus(notFound)).toBeNull();
  });

  it('is null for a server that does not answer in time', async () => {
    const url = await serve(() => undefined);
    const started = performance.now();
    expect(await readStatus(url, 100)).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
