// SC1 (decisions 930–932) on a running server: an opened address's token traded for the page key,
// the nexus's open tokens by the bridge key, a fresh address asked for by a tab without one.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Diffs } from '../src/diffs.js';
import { Histories } from '../src/history.js';
import type { Merger } from '../src/merges.js';
import { serverKeys, type ServerKeys } from '../src/server-keys.js';
import { startViewServer, type ViewServer } from '../src/server.js';

const C = 'c'.repeat(40);
const viewer = mkdtempSync(join(tmpdir(), 'symbiote-session-'));

/** A page's write as the browser sends it: JSON, the custom header. */
const WRITE = { 'content-type': 'application/json', 'x-symbiote': '1' };

describe('the page key (SC1, decision 930)', () => {
  let server: ViewServer;
  let keys: ServerKeys;
  const queued: unknown[] = [];
  let again = 0;

  beforeAll(async () => {
    mkdirSync(join(viewer, 'assets'), { recursive: true });
    writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>');
    keys = serverKeys();
    const merges = {
      list: () => Promise.resolve({ merges: [] }),
      targets: () => Promise.resolve({ branches: ['main'], into: 'main', head: C }),
      enqueue: (request: unknown) => {
        queued.push(request);
        return Promise.resolve({});
      },
    } as unknown as Merger;
    server = await startViewServer({
      viewerDir: viewer,
      keys,
      openAgain: () => {
        again += 1;
      },
      repository: {
        history: new Histories({
          state: () => Promise.resolve({ branch: 'main', head: C, version: 'v1' }),
          stream: () => Promise.resolve(),
          details: () => Promise.resolve([]),
        }),
        status: () =>
          Promise.resolve({ version: 'v1', branch: 'main', head: C, changed: 0, operation: null }),
        refs: () => Promise.resolve({ branches: [], remotes: [], tags: [] }),
        checkout: () => Promise.reject(new Error('no')),
        isCommit: () => Promise.resolve(true),
        diffs: new Diffs(() => Promise.reject(new Error('no'))),
        readFile: () => Promise.resolve(''),
        merges,
      },
    });
  });
  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
  });
  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(new URL(path, server.url), { headers });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(new URL(path, server.url), {
      method: 'POST',
      headers: { ...WRITE, ...headers },
      body: JSON.stringify(body),
    });

  it('trades an opened address’s token once for the page key; a wrong one is refused', async () => {
    const token = keys.open();
    const traded = await post('/api/session', { k: token });
    expect(traded.status).toBe(200);
    expect(await traded.json()).toEqual({ key: keys.page });
    const twice = await post('/api/session', { k: token });
    expect(twice.status).toBe(403);
    expect(await twice.json()).toMatchObject({ refused: 'key' });
    expect((await post('/api/session', { k: 'made-up' })).status).toBe(403);
    expect((await post('/api/session', { nope: 1 })).status).toBe(400);
    // From another site's page, never: as every write.
    const other = keys.open();
    expect(
      (await post('/api/session', { k: other }, { origin: 'http://evil.example' })).status,
    ).toBe(403);
    expect((await post('/api/session', { k: other }, { 'x-symbiote': '' })).status).toBe(403);
  });

  it('says whether a request holds the page key, and nothing more', async () => {
    expect(await (await get('/api/session')).json()).toEqual({ page: false });
    expect(await (await get('/api/session', { 'x-symbiote-key': keys.page })).json()).toEqual({
      page: true,
    });
    expect(await (await get('/api/session', { 'x-symbiote-key': keys.bridge })).json()).toEqual({
      page: false,
    });
  });

  it('gives an open token for the bridge key alone (the nexus’s frames)', async () => {
    const opened = await post('/api/session/open', {}, { 'x-symbiote-key': keys.bridge });
    expect(opened.status).toBe(200);
    const { token } = (await opened.json()) as { token: string };
    expect(keys.trade(token)).toBe(keys.page);
    expect((await post('/api/session/open', {})).status).toBe(403);
    expect((await post('/api/session/open', {}, { 'x-symbiote-key': keys.page })).status).toBe(403);
    expect((await get('/api/session/open', { 'x-symbiote-key': keys.bridge })).status).toBe(405);
  });

  it('opens a fresh address when a tab without the key asks, once in a while', async () => {
    const asked = await post('/api/session/again', {});
    expect(asked.status).toBe(204);
    expect(again).toBe(1);
    expect((await post('/api/session/again', {})).status).toBe(429);
    expect(again).toBe(1);
    expect((await post('/api/session/again', {}, { origin: 'http://evil.example' })).status).toBe(
      403,
    );
  });
  it('refuses a write without the page key, saying so; takes it with the key (SC1b)', async () => {
    const target = { kind: 'branch', name: 'main' };
    const bare = await post('/api/checkout', target);
    expect(bare.status).toBe(403);
    expect(bare.headers.get('x-symbiote-refused')).toBe('key');
    expect(await bare.json()).toMatchObject({ refused: 'key' });
    expect((await post('/api/checkout', target, { 'x-symbiote-key': keys.bridge })).status).toBe(
      403,
    );
    // Another site's page is refused as before, whatever it sends.
    const evil = await post('/api/checkout', target, {
      'x-symbiote-key': keys.page,
      origin: 'http://evil.example',
    });
    expect(evil.status).toBe(403);
    expect(evil.headers.get('x-symbiote-refused')).toBeNull();
    const keyed = await post('/api/checkout', target, { 'x-symbiote-key': keys.page });
    expect(keyed.status).not.toBe(403);
  });

  it('answers the Confirm’s asks and takes its answer from the page alone (SC1b)', async () => {
    expect((await get('/api/mcp/asks')).status).toBe(403);
    expect((await get('/api/mcp/asks', { 'x-symbiote-key': keys.bridge })).status).toBe(403);
    expect((await get('/api/mcp/asks', { 'x-symbiote-key': keys.page })).status).toBe(200);
    const answer = { id: 'nope', yes: true };
    expect((await post('/api/mcp/answer', answer)).status).toBe(403);
    expect((await post('/api/mcp/answer', answer, { 'x-symbiote-key': keys.bridge })).status).toBe(
      403,
    );
    expect((await post('/api/mcp/answer', answer, { 'x-symbiote-key': keys.page })).status).toBe(
      404,
    );
  });

  it('takes an MCP call with the bridge key alone (SC1b)', async () => {
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    expect((await post('/api/mcp', ping)).status).toBe(403);
    expect((await post('/api/mcp', ping, { 'x-symbiote-key': keys.page })).status).toBe(403);
    expect((await post('/api/mcp', ping, { 'x-symbiote-key': keys.bridge })).status).toBe(200);
  });

  it('keeps a hook’s ping and a page’s errors open: an agent’s shell has no key (SC1b)', async () => {
    expect((await post('/api/events/ping', {})).status).toBe(204);
    expect((await post('/api/events/ping', {}, { origin: 'http://evil.example' })).status).toBe(
      403,
    );
    const error = { level: 'error', msg: 'boom', page: '/', err: { message: 'boom' } };
    expect((await post('/api/logs', error)).status).not.toBe(403);
  });
  it('says on the page’s stream only that the asks changed, never what they are (SC1b)', async () => {
    const controller = new AbortController();
    const res = await fetch(new URL('/api/events', server.url), { signal: controller.signal });
    const reader = res.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
    let text = '';
    // Its first state: the whole of it, as a page's stream gets it on connect.
    while (!/event: state\ndata: .*\n\n/.test(text) && reader) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    controller.abort();
    const data = /event: state\ndata: (.*)\n/.exec(text)?.[1] ?? '';
    expect((JSON.parse(data) as { parts: { asks: unknown } }).parts.asks).toEqual({ changes: 0 });
  });
  it('takes a call as Nucleus’s only with its key, not by the header alone (SC1c, decision 931)', async () => {
    const call = (id: number, headers: Record<string, string>) =>
      post(
        '/api/mcp',
        {
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: 'queue_merge', arguments: { branch: 'feature/csv' } },
        },
        { 'x-symbiote-key': keys.bridge, ...headers },
      );
    const asks = async () =>
      (
        (await (await get('/api/mcp/asks', { 'x-symbiote-key': keys.page })).json()) as {
          asks: { id: string; by: unknown }[];
        }
      ).asks;
    const by = async (headers: Record<string, string>) => {
      const answered = call(7, headers);
      await expect.poll(async () => (await asks()).length).toBe(1);
      const [ask] = await asks();
      await post('/api/mcp/answer', { id: ask?.id, yes: false }, { 'x-symbiote-key': keys.page });
      await answered;
      return ask?.by;
    };
    expect(await by({ 'x-symbiote-caller': 'nucleus' })).toMatchObject({ via: 'mcp' });
    expect(
      await by({ 'x-symbiote-caller': 'nucleus', 'x-symbiote-nucleus': keys.bridge }),
    ).toMatchObject({ via: 'mcp' });
    expect(
      await by({ 'x-symbiote-caller': 'nucleus', 'x-symbiote-nucleus': keys.nucleus }),
    ).toEqual({ via: 'nucleus' });
    // A bridge from before SC1 says `nucleus` and sends no key: an agent's call.
    expect(await by({ 'x-symbiote-caller': 'scout' })).toMatchObject({ via: 'mcp' });
  });
});
