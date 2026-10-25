import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import {
  readViewRecord,
  removeViewRecord,
  runBridge,
  viewFile,
  writeViewRecord,
} from '../src/mcp-bridge.js';

interface Seen {
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

/** A fake `symbiote view`: `/api/mcp` answers a request with its method, a notification 202. */
async function fakeView(hold?: (closed: () => void) => void) {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let text = '';
    req.on('data', (chunk: Buffer) => (text += chunk.toString()));
    req.on('end', () => {
      const body = JSON.parse(text) as { id?: unknown; method?: string };
      seen.push({ path: req.url ?? '', headers: req.headers, body });
      if (body.id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }
      if (body.method === 'slow' && hold) {
        res.on('close', () => hold(() => undefined));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { method: body.method } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    seen,
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A bridge on a view file: write lines to it, read its answers. */
function bridge(view: string, as?: 'scout') {
  const input = new PassThrough();
  const output = new PassThrough();
  let out = '';
  output.on('data', (chunk: Buffer) => (out += chunk.toString()));
  const done = runBridge({ view, input, output, folder: '/home/p/trial', ...(as ? { as } : {}) });
  return {
    send: (message: unknown) =>
      input.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`),
    end: () => input.end(),
    done,
    answers: () =>
      out
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe("Symbiote's MCP bridge (MC1, decision 358)", () => {
  it("forwards each message to symbiote view's /api/mcp and writes its answer; notifications get none", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const view = await fakeView();
    const file = join(dir, 'view.json');
    await writeViewRecord(file, {
      url: view.url,
      pid: process.pid,
      root: '/home/p/trial',
      started: 'now',
    });
    const b = bridge(file, 'scout');
    b.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'claude-code' } },
    });
    b.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    b.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    b.end();
    await b.done;
    expect(b.answers()).toEqual([
      { jsonrpc: '2.0', id: 1, result: { method: 'initialize' } },
      { jsonrpc: '2.0', id: 2, result: { method: 'tools/list' } },
    ]);
    expect(view.seen.map((s) => s.path)).toEqual(['/api/mcp', '/api/mcp', '/api/mcp']);
    expect(view.seen[2]?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-symbiote': '1',
      'x-symbiote-caller': 'scout',
    });
    await view.close();
  });

  it('says who calls through symbiote mcp: the client it introduced, and its folder', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const view = await fakeView();
    const file = join(dir, 'view.json');
    await writeViewRecord(file, { url: view.url, pid: process.pid, root: '/r', started: 'now' });
    const b = bridge(file);
    b.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'codex-mcp-client' } },
    });
    b.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    b.end();
    await b.done;
    expect(view.seen[1]?.headers).toMatchObject({
      'x-symbiote-caller': 'mcp',
      'x-symbiote-client': 'codex-mcp-client',
      'x-symbiote-folder': encodeURIComponent('/home/p/trial'),
    });
    await view.close();
  });

  it('reads the address on every message: a restarted symbiote view is found by the next one', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const first = await fakeView();
    const second = await fakeView();
    const file = join(dir, 'view.json');
    await writeViewRecord(file, { url: first.url, pid: process.pid, root: '/r', started: 'one' });
    const b = bridge(file);
    b.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    await expect.poll(() => b.answers().length).toBe(1);
    await first.close();
    b.send({ jsonrpc: '2.0', id: 2, method: 'ping' });
    await expect.poll(() => b.answers().length).toBe(2);
    await writeViewRecord(file, { url: second.url, pid: process.pid, root: '/r', started: 'two' });
    b.send({ jsonrpc: '2.0', id: 3, method: 'ping' });
    b.end();
    await b.done;
    const [one, down, three] = b.answers();
    expect(one).toMatchObject({ id: 1, result: { method: 'ping' } });
    expect(down).toMatchObject({
      id: 2,
      error: {
        code: -32000,
        message: expect.stringContaining('Symbiote is not running for /r') as unknown,
      },
    });
    expect(three).toMatchObject({ id: 3, result: { method: 'ping' } });
    await second.close();
  });

  it('says Symbiote is not running when there is no record; a line that is not JSON is a parse error', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const b = bridge(join(dir, 'none.json'));
    b.send({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    b.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    b.send('{not json');
    b.end();
    await b.done;
    expect(b.answers()).toEqual([
      {
        jsonrpc: '2.0',
        id: 7,
        error: {
          code: -32000,
          message: 'Symbiote is not running for /home/p/trial: open it with `symbiote view`',
        },
      },
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } },
    ]);
  });

  it('drops a call the client cancels: symbiote view sees it hang up, and nothing is written', async () => {
    const dir = tempDir();
    dirs.push(dir);
    let closed = 0;
    const view = await fakeView(() => closed++);
    const file = join(dir, 'view.json');
    await writeViewRecord(file, { url: view.url, pid: process.pid, root: '/r', started: 'now' });
    const b = bridge(file, 'scout');
    b.send({ jsonrpc: '2.0', id: 9, method: 'slow' });
    await expect.poll(() => view.seen.length).toBe(1);
    b.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9 } });
    await expect.poll(() => closed).toBe(1);
    b.end();
    await b.done;
    expect(b.answers()).toEqual([]);
    expect(view.seen).toHaveLength(1);
    await view.close();
  });
});

describe("symbiote view's record for the bridge", () => {
  it('is one file per repository, whichever worktree asks', () => {
    expect(viewFile('/cache', '/home/p/trial/.git')).toBe(viewFile('/cache', '/home/p/trial/.git'));
    expect(viewFile('/cache', '/home/p/trial/.git')).not.toBe(
      viewFile('/cache', '/home/p/other/.git'),
    );
    expect(viewFile('/cache', '/home/p/trial/.git')).toMatch(
      /^\/cache\/views\/[0-9a-f]{16}\.json$/,
    );
  });

  it('is written whole, read back, and removed only by the process that wrote it', async () => {
    const dir = tempDir();
    dirs.push(dir);
    const file = join(dir, 'views', 'x.json');
    const record = { url: 'http://127.0.0.1:5/', pid: 42, root: '/r', started: 's' };
    await writeViewRecord(file, record);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(record);
    expect(readViewRecord(file)).toEqual(record);
    await removeViewRecord(file, 43);
    expect(existsSync(file)).toBe(true);
    await removeViewRecord(file, 42);
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, '{"url": 5}');
    expect(readViewRecord(file)).toBeNull();
  });
});
