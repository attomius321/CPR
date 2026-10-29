// Symbiote's MCP bridge (MC1, decision 358): the stdio MCP server an agent starts — Nucleus's, or the
// person's own through `symbiote mcp` — that hands each message to the `symbiote view` serving the
// repository (`POST /api/mcp`) and writes its answer back. That server's address is read from its
// record on every message, since a restarted `symbiote view` takes another port while an agent's
// session lives on. Node's modules only, like the hooks: it starts with every agent session.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { request, type ClientRequest } from 'node:http';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { writeFileWhole } from './file-write.js';

/** Where a `symbiote view` serves a repository, for the bridge: `<cache>/views/<hash>.json`. */
export interface ViewRecord {
  /** `http://127.0.0.1:<port>/`. */
  url: string;
  pid: number;
  root: string;
  started: string;
}

/** The record's file for a repository: one per repository, whichever of its worktrees asks. */
export function viewFile(cacheDir: string, commonDir: string): string {
  const hash = createHash('sha256').update(commonDir).digest('hex').slice(0, 16);
  return join(cacheDir, 'views', `${hash}.json`);
}

/** Writes the record whole (a bridge may read it at any time). */
export async function writeViewRecord(path: string, record: ViewRecord): Promise<void> {
  await writeFileWhole(path, `${JSON.stringify(record, null, 2)}\n`);
}

/** The record, or null when there is none or it is not one. */
export function readViewRecord(path: string): ViewRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  const v = (value && typeof value === 'object' ? value : {}) as Partial<ViewRecord>;
  if (typeof v.url !== 'string' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(v.url)) {
    return null;
  }
  if (typeof v.pid !== 'number' || typeof v.root !== 'string') return null;
  return { url: v.url, pid: v.pid, root: v.root, started: String(v.started ?? '') };
}

/** Removes the record if `pid` wrote it: a newer `symbiote view`'s stays. */
export async function removeViewRecord(path: string, pid: number): Promise<void> {
  if (readViewRecord(path)?.pid === pid) await rm(path, { force: true });
}

export interface BridgeOptions {
  /** The record's file (`viewFile`). */
  view: string;
  /** Nucleus's bridge, started by Symbiote; else an agent's through `symbiote mcp`. */
  as?: 'scout';
  input: Readable;
  output: Writable;
  /** The folder the agent runs in: who asks, and the words when no record names the repository. */
  folder: string;
}

type Id = string | number;

/** Forwards `input`'s messages until it ends and every answer is written. */
export async function runBridge({ view, as, input, output, folder }: BridgeOptions): Promise<void> {
  let client: string | undefined;
  /** Calls under way, by ID: what cancels one. */
  const inflight = new Map<Id, () => void>();
  const pending = new Set<Promise<void>>();
  const write = (message: unknown) => output.write(`${JSON.stringify(message)}\n`);
  const fail = (id: Id | null, code: number, message: string) =>
    write({ jsonrpc: '2.0', id, error: { code, message } });
  const notRunning = (root: string) =>
    `Symbiote is not running for ${root}: open it with \`symbiote view\``;

  async function forward(line: string): Promise<void> {
    let message: Record<string, unknown>;
    try {
      const value = JSON.parse(line) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not one');
      message = value as Record<string, unknown>;
    } catch {
      fail(null, -32700, 'not JSON');
      return;
    }
    const params = (message.params ?? {}) as Record<string, unknown>;
    if (message.method === 'initialize') {
      const name = (params.clientInfo as { name?: unknown } | undefined)?.name;
      if (typeof name === 'string') client = name.slice(0, 200);
    }
    // The client gave up on a call: its request is dropped, and so is an ask it holds.
    if (message.method === 'notifications/cancelled') {
      const id = params.requestId;
      if (typeof id === 'string' || typeof id === 'number') inflight.get(id)?.();
      return;
    }
    const raw = message.id;
    const id: Id | null = typeof raw === 'string' || typeof raw === 'number' ? raw : null;
    const answers = 'id' in message;
    const record = readViewRecord(view);
    if (!record) {
      if (answers) fail(id, -32000, notRunning(folder));
      return;
    }
    const body = JSON.stringify(message);
    await new Promise<void>((resolve) => {
      let cancelled = false;
      const req: ClientRequest = request(new URL('api/mcp', record.url), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-symbiote': '1',
          'x-symbiote-caller': as ?? 'mcp',
          ...(client ? { 'x-symbiote-client': client } : {}),
          'x-symbiote-folder': encodeURIComponent(folder),
        },
      });
      if (id !== null) {
        inflight.set(id, () => {
          cancelled = true;
          req.destroy();
        });
      }
      const done = () => {
        if (id !== null) inflight.delete(id);
        resolve();
      };
      req.on('response', (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              write(JSON.parse(text));
            } catch {
              if (answers) fail(id, -32603, 'Symbiote answered with no JSON');
            }
          } else if (res.statusCode !== 202 && answers) {
            fail(id, -32000, `Symbiote answered ${res.statusCode ?? '?'}: ${text.slice(0, 500)}`);
          }
          done();
        });
        res.on('error', done);
      });
      // A cancelled call is not answered; a refused connection is Symbiote not running.
      req.on('error', () => {
        if (answers && !cancelled) fail(id, -32000, notRunning(record.root));
        done();
      });
      req.end(body);
    });
  }

  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (line.trim() === '') return;
    const task = forward(line);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  await new Promise<void>((resolve) => lines.once('close', resolve));
  while (pending.size > 0) await Promise.all([...pending]);
}
