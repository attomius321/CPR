// A WebSocket client on a unix socket (V27a): what Codex's app server speaks on its daemon's
// socket. Node's own WebSocket connects only to `ws://` hosts, so this is the part of RFC 6455 a
// client needs — the HTTP upgrade, masked text frames out, text frames in (fragments joined),
// ping and close. Node's own modules only.
import { createHash, randomBytes } from 'node:crypto';
import { connect } from 'node:net';

/** RFC 6455's key suffix for `Sec-WebSocket-Accept`. */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Longest message read; Codex fragments messages over 16 MB (its upgrade's header says so). */
export const MAX_MESSAGE = 64 * 1024 * 1024;

/** A server that did not upgrade, answered for another key, or broke the protocol. */
export class WebSocketRefused extends Error {}

export interface WebSocketClient {
  /** Sends a text message; nothing once the connection has ended. */
  send(text: string): void;
  /** Ends the connection (close 1000). */
  close(): void;
  /** Each text message, whole. */
  onMessage(listener: (text: string) => void): void;
  /** Once, when the connection ends: with why, unless it was `close()`d. */
  onClose(listener: (error?: Error) => void): void;
}

/** A client frame: always masked. */
function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  const head = length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (length < 126) head[1] = 0x80 | length;
  else if (length < 65536) {
    head[1] = 0x80 | 126;
    head.writeUInt16BE(length, 2);
  } else {
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(length), 2);
  }
  const mask = randomBytes(4);
  const body = Buffer.alloc(length);
  for (let i = 0; i < length; i++) body[i] = (payload[i] as number) ^ (mask[i % 4] as number);
  return Buffer.concat([head, mask, body]);
}

/**
 * Opens a WebSocket on the unix socket `path`: resolves once the server upgraded the connection,
 * rejects with the socket's error (`ENOENT`, `ECONNREFUSED`), a `WebSocketRefused`, or when
 * nothing answers within `timeoutMs`.
 */
export function openWebSocket(
  path: string,
  { timeoutMs = 5_000 }: { timeoutMs?: number } = {},
): Promise<WebSocketClient> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path });
    const key = randomBytes(16).toString('base64');
    const messages: ((text: string) => void)[] = [];
    const closes: ((error?: Error) => void)[] = [];
    /** Messages before the first listener: they may come with the upgrade's answer. */
    const early: string[] = [];
    /** How it ended, for a listener that comes later. */
    let endedWith: { error?: Error } | null = null;
    let buffer: Buffer = Buffer.alloc(0);
    let upgraded = false;
    let ended = false;
    let closing = false;
    /** A message's fragments so far, while its last has not come. */
    let parts: Buffer[] | null = null;
    let partsLength = 0;

    const timer = setTimeout(
      () => fail(new WebSocketRefused(`no answer in ${timeoutMs} ms`)),
      timeoutMs,
    );
    timer.unref();
    const end = (error?: Error) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      socket.destroy();
      if (!upgraded) return reject(error ?? new WebSocketRefused('the connection closed'));
      endedWith = closing || !error ? {} : { error };
      for (const listener of closes) listener(endedWith.error);
    };
    const fail = (error: Error) => end(error);
    const write = (opcode: number, payload: Buffer) => {
      if (!ended && socket.writable) socket.write(frame(opcode, payload));
    };

    const client: WebSocketClient = {
      send: (text) => write(0x1, Buffer.from(text)),
      close() {
        if (ended || closing) return;
        closing = true;
        const code = Buffer.alloc(2);
        code.writeUInt16BE(1000);
        write(0x8, code);
        socket.end();
        // The server answers with its close; a server that does not is cut off.
        setTimeout(() => end(), 1_000).unref();
      },
      onMessage(listener) {
        messages.push(listener);
        for (const text of early.splice(0)) listener(text);
      },
      onClose(listener) {
        if (endedWith) listener(endedWith.error);
        else closes.push(listener);
      },
    };

    /** The upgrade's answer, once its headers are all here; false while they are not. */
    const handshake = (): boolean => {
      const at = buffer.indexOf('\r\n\r\n');
      if (at < 0) return false;
      const head = buffer.subarray(0, at).toString('latin1');
      buffer = buffer.subarray(at + 4);
      const [status = '', ...lines] = head.split('\r\n');
      if (!/^HTTP\/1\.1 101\b/.test(status)) {
        fail(new WebSocketRefused(`the server did not upgrade: ${status}`));
        return false;
      }
      const accept = lines
        .map((line) => /^sec-websocket-accept:\s*(.*)$/i.exec(line)?.[1]?.trim())
        .find((value) => value !== undefined);
      const expected = createHash('sha1')
        .update(key + GUID)
        .digest('base64');
      if (accept !== expected) {
        fail(new WebSocketRefused('the server answered with another Sec-WebSocket-Accept'));
        return false;
      }
      upgraded = true;
      clearTimeout(timer);
      resolve(client);
      return true;
    };

    /** Reads every whole frame in the buffer. */
    const frames = () => {
      while (!ended && buffer.length >= 2) {
        const first = buffer[0] as number;
        const second = buffer[1] as number;
        let length = second & 0x7f;
        let at = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          at = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          const long = buffer.readBigUInt64BE(2);
          if (long > BigInt(MAX_MESSAGE)) return fail(new WebSocketRefused('a message over 64 MB'));
          length = Number(long);
          at = 10;
        }
        // A server's frames are not masked; one that masks them is read all the same.
        const mask = (second & 0x80) !== 0 ? 4 : 0;
        if (buffer.length < at + mask + length) return;
        const payload = Buffer.from(buffer.subarray(at + mask, at + mask + length));
        if (mask) {
          const bytes = buffer.subarray(at, at + 4);
          for (let i = 0; i < length; i++)
            payload[i] = (payload[i] as number) ^ (bytes[i % 4] as number);
        }
        buffer = buffer.subarray(at + mask + length);
        const fin = (first & 0x80) !== 0;
        const opcode = first & 0x0f;
        if (opcode === 0x9) write(0xa, payload);
        else if (opcode === 0x8) {
          const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
          if (!closing) write(0x8, payload.subarray(0, 2));
          return end(closing ? undefined : new Error(`closed by the server (${code})`));
        } else if (opcode === 0x1 || opcode === 0x0) {
          if (opcode === 0x1) {
            parts = [];
            partsLength = 0;
          }
          if (!parts) return fail(new WebSocketRefused('a continuation with no message'));
          parts.push(payload);
          partsLength += payload.length;
          if (partsLength > MAX_MESSAGE) return fail(new WebSocketRefused('a message over 64 MB'));
          if (fin) {
            const text = Buffer.concat(parts).toString('utf8');
            parts = null;
            if (messages.length === 0) early.push(text);
            for (const listener of messages) listener(text);
          }
        }
        // Binary messages and pongs: Codex sends none that CPR reads.
      }
    };

    socket.on('connect', () => {
      socket.write(
        'GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      if (!upgraded && !handshake()) return;
      frames();
    });
    socket.on('error', (error) => fail(error));
    socket.on('close', () => end(closing ? undefined : new Error('the connection closed')));
  });
}
