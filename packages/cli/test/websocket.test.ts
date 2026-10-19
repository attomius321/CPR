import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openWebSocket, WebSocketRefused } from '../src/websocket.js';
import { webSocketServer, type FakeSocket } from './fake-app-server.js';

const dirs: string[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A socket path short enough for a unix socket (108 bytes on Linux). */
function socketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cpr-ws-'));
  dirs.push(dir);
  return join(dir, 's.sock');
}

async function serve(
  onSocket: (socket: FakeSocket) => void = () => {},
  options?: Parameters<typeof webSocketServer>[2],
) {
  const path = socketPath();
  const server = await webSocketServer(path, onSocket, options);
  closers.push(() => server.close());
  return { path, server };
}

const until = async (check: () => boolean, ms = 2_000) => {
  for (let waited = 0; !check(); waited += 10) {
    if (waited > ms) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('openWebSocket', () => {
  it('upgrades on a unix socket, sends masked text frames, and reads messages of every length', async () => {
    const sizes = [5, 300, 70_000];
    const { path, server } = await serve((socket) => {
      socket.onText((text) => {
        if (text === 'sizes') for (const size of sizes) socket.send('x'.repeat(size));
      });
    });
    const ws = await openWebSocket(path);
    const got: string[] = [];
    ws.onMessage((text) => got.push(text));
    ws.send('{"id":1,"method":"initialize"}');
    ws.send('é'.repeat(200));
    ws.send('sizes');
    await until(() => got.length === sizes.length);
    expect(got.map((text) => text.length)).toEqual(sizes);
    const [socket] = server.sockets;
    expect(socket?.received).toEqual(['{"id":1,"method":"initialize"}', 'é'.repeat(200), 'sizes']);
    expect(socket?.masked).toBe(true);
    ws.close();
  });

  it('joins a fragmented message, and answers pings, between fragments too', async () => {
    const { path, server } = await serve((socket) => {
      socket.ping('before');
      socket.send('{"method":"turn/completed","params":{"text":"joined"}}', 3, () =>
        socket.ping('between'),
      );
    });
    const ws = await openWebSocket(path);
    const got: string[] = [];
    ws.onMessage((text) => got.push(text));
    await until(() => got.length === 1 && (server.sockets[0]?.pongs.length ?? 0) === 3);
    expect(got).toEqual(['{"method":"turn/completed","params":{"text":"joined"}}']);
    expect(server.sockets[0]?.pongs).toEqual(['before', 'between', 'between']);
    ws.close();
  });

  it('reads frames however the bytes arrive: a message cut mid-header, two in one chunk', async () => {
    const { path } = await serve((socket) => {
      const one = Buffer.from([0x81, 0x03, ...Buffer.from('one')]);
      const two = Buffer.from([0x81, 0x03, ...Buffer.from('two')]);
      socket.raw(one.subarray(0, 1));
      setTimeout(() => socket.raw(Buffer.concat([one.subarray(1), two])), 20);
    });
    const ws = await openWebSocket(path);
    const got: string[] = [];
    ws.onMessage((text) => got.push(text));
    await until(() => got.length === 2);
    expect(got).toEqual(['one', 'two']);
    ws.close();
  });

  it('closes: its own close says 1000; the server closing ends it, once', async () => {
    const { path, server } = await serve();
    const ws = await openWebSocket(path);
    const ended: (Error | undefined)[] = [];
    ws.onClose((error) => ended.push(error));
    ws.close();
    await until(() => ended.length === 1);
    expect(server.sockets[0]?.closed).toBe(1000);
    expect(ended).toEqual([undefined]);

    const other = await openWebSocket(path);
    const gone: (Error | undefined)[] = [];
    other.onClose((error) => gone.push(error));
    server.sockets[1]?.close(1012);
    await until(() => gone.length === 1);
    expect(gone[0]?.message).toMatch(/closed by the server \(1012\)/);
    // Sending after the end does nothing, and throws nothing.
    other.send('late');
    other.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gone).toHaveLength(1);
  });

  it('refuses a server that does not upgrade, or answers for another key', async () => {
    const plain = await serve(undefined, {
      answer: () => 'HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\n\r\n',
    });
    await expect(openWebSocket(plain.path)).rejects.toThrow(WebSocketRefused);
    await expect(openWebSocket(plain.path)).rejects.toThrow(/400 Bad Request/);
    const wrong = await serve(undefined, {
      answer: () =>
        'HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nsec-websocket-accept: nope\r\n\r\n',
    });
    await expect(openWebSocket(wrong.path)).rejects.toThrow(/Sec-WebSocket-Accept/);
  });

  it('rejects with the socket error when nothing listens, and in time when nothing answers', async () => {
    await expect(openWebSocket(socketPath())).rejects.toMatchObject({ code: 'ENOENT' });
    const silent = await serve(undefined, { answer: () => '' });
    const started = Date.now();
    await expect(openWebSocket(silent.path, { timeoutMs: 100 })).rejects.toThrow(/no answer/);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
