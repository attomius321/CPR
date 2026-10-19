// Codex's app server (V27a, decisions 154–155): CPR as one of its clients, on the WebSocket of
// the person's daemon's unix socket — JSON-RPC without the `jsonrpc` field (Codex 0.163). One
// connection per call: CPR keeps no thread subscribed (a thread's clients get every delta of its
// turns) and reads what it shows with `thread/read` and `thread/turns/list`. What it reads is
// checked field by field: the protocol is `[experimental]`.
import { openWebSocket, type WebSocketClient } from './websocket.js';

/** An error the app server answered, with its JSON-RPC code; or no answer in time. */
export class AppServerError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

/** No app server there: its socket is gone, refused the connection, or did not speak WebSocket. */
export class AppServerUnreachable extends Error {}

export interface AppServerConnection {
  request<T = unknown>(method: string, params?: object): Promise<T>;
  /** Notifications: what happens on the threads this connection started or resumed. */
  onNotification(listener: (method: string, params: unknown) => void): void;
  close(): void;
}

/** A unix socket's path from `unix://<path>`, the only kind CPR connects to. */
function socketOf(address: string): string {
  const path = /^unix:\/\/(\/.+)$/.exec(address)?.[1];
  if (!path) throw new AppServerUnreachable(`not a unix:// address: ${address}`);
  return path;
}

/**
 * Connects to the app server at `address` (`unix://<path>`) and introduces CPR (`initialize`,
 * then `initialized`). Each request is answered within `timeoutMs` or fails.
 */
export async function connectAppServer(
  address: string,
  { version = '0.0.0', timeoutMs = 20_000 }: { version?: string; timeoutMs?: number } = {},
): Promise<AppServerConnection> {
  let ws: WebSocketClient;
  try {
    ws = await openWebSocket(socketOf(address), { timeoutMs: Math.min(timeoutMs, 5_000) });
  } catch (error) {
    if (error instanceof AppServerUnreachable) throw error;
    throw new AppServerUnreachable(`Codex's app server at ${address}: ${(error as Error).message}`);
  }
  let next = 1;
  let gone: Error | null = null;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const listeners: ((method: string, params: unknown) => void)[] = [];
  ws.onMessage((text) => {
    let message: {
      id?: unknown;
      method?: unknown;
      params?: unknown;
      result?: unknown;
      error?: unknown;
    };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    // A server request has a method and its own ID (from 0): never an answer to CPR's.
    if (typeof message.method === 'string') {
      if (message.id === undefined)
        for (const listener of listeners) listener(message.method, message.params);
      return;
    }
    const waiting = typeof message.id === 'number' ? pending.get(message.id) : undefined;
    if (!waiting) return;
    pending.delete(message.id as number);
    if (message.error) {
      const { message: words, code } = message.error as { message?: unknown; code?: unknown };
      waiting.reject(
        new AppServerError(
          typeof words === 'string' ? words : 'the app server refused it',
          typeof code === 'number' ? code : undefined,
        ),
      );
    } else waiting.resolve(message.result);
  });
  ws.onClose((error) => {
    gone = new AppServerError(
      `Codex's app server closed the connection${error ? `: ${error.message}` : ''}`,
    );
    for (const waiting of pending.values()) waiting.reject(gone);
    pending.clear();
  });
  const connection: AppServerConnection = {
    request<T>(method: string, params?: object) {
      if (gone) return Promise.reject(gone);
      const id = next++;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new AppServerError(`Codex's app server did not answer ${method} in ${timeoutMs} ms`),
          );
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value as T);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        ws.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }));
      });
    },
    onNotification: (listener) => void listeners.push(listener),
    close: () => ws.close(),
  };
  try {
    await connection.request('initialize', {
      clientInfo: { name: 'cpr', title: 'CPR', version },
      capabilities: null,
    });
  } catch (error) {
    ws.close();
    throw error;
  }
  ws.send(JSON.stringify({ method: 'initialized' }));
  return connection;
}

/** A Codex thread as CPR reads it. */
export interface CodexThread {
  id: string;
  /** Unix seconds. */
  createdAt: number;
  updatedAt: number;
  /** `active` while a turn runs, `idle`, `notLoaded` (the server restarted), `systemError`. */
  status: string;
  /** What an active thread waits on: an approval, or the person's input. */
  waiting?: 'approval' | 'input';
  /** Its newest turns, oldest first. */
  turns: CodexTurn[];
}

export interface CodexTurn {
  id: string;
  /** `inProgress`, `completed`, `interrupted`, `failed`. */
  status: string;
  /** Unix seconds. */
  startedAt?: number;
  completedAt?: number;
  /** Why it failed, in Codex's words. */
  error?: string;
  /** What it was given: its first message, then those that joined it (`turn/steer`). */
  prompts: string[];
  /** Codex's final answer (`final`); else, in a turn read in full, its newest message. */
  report?: string;
  final?: true;
}

/** What CPR asks of Codex's app server (V27a); tests use a fake server. */
export interface CodexServer {
  /** Where it listens, as `codex resume --remote` takes it: `unix://<socket>`. */
  address: string;
  /**
   * Starts a thread in `cwd` in the `workspace-write` sandbox, `writable` also writable (the
   * branch's git folders, decision 130), approvals asked (`on-request`), named `name`, with
   * `prompt` as its first turn; its ID once the prompt is in the thread.
   */
  start(request: {
    cwd: string;
    writable: string[];
    name: string;
    prompt: string;
  }): Promise<string>;
  /**
   * Gives a thread a message: a new turn, or joined to the one that runs (`turn/steer`).
   * A thread the server does not hold (it restarted) is resumed first, with its own options.
   */
  send(request: { thread: string; text: string }): Promise<'started' | 'steered'>;
  /** Interrupts the turn that runs; whether there was one. Answers once it ended (2 s at most). */
  interrupt(thread: string): Promise<boolean>;
  /** A thread and its newest `turns`, their items in `summary` or in `full`. */
  read(thread: string, view: { turns: number; items: 'summary' | 'full' }): Promise<CodexThread>;
  /** Out of Codex's lists (`thread/archive`), not deleted: `codex unarchive` brings it back. */
  archive(thread: string): Promise<void>;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
const seconds = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** A turn's fields CPR uses, from what the server sent. */
function turnOf(value: unknown): CodexTurn | null {
  const v = (value ?? {}) as Record<string, unknown>;
  const id = text(v.id);
  if (!id) return null;
  const prompts: string[] = [];
  let final: string | undefined;
  let last: string | undefined;
  for (const item of Array.isArray(v.items) ? (v.items as Record<string, unknown>[]) : []) {
    if (item?.type === 'userMessage' && Array.isArray(item.content)) {
      const words = (item.content as { type?: unknown; text?: unknown }[])
        .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
        .join('');
      if (words !== '') prompts.push(words);
    } else if (item?.type === 'agentMessage') {
      const words = text(item.text);
      if (!words) continue;
      last = words;
      if (item.phase === 'final_answer') final = words;
    }
  }
  const startedAt = seconds(v.startedAt);
  const completedAt = seconds(v.completedAt);
  const error = text((v.error as { message?: unknown } | null)?.message);
  const report = final ?? last;
  return {
    id,
    status: text(v.status) ?? 'unknown',
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(error ? { error } : {}),
    prompts,
    ...(report ? { report } : {}),
    ...(final ? { final: true as const } : {}),
  };
}

/** A thread's status: its type, and what it waits on. */
function statusOf(value: unknown): Pick<CodexThread, 'status' | 'waiting'> {
  const v = (value ?? {}) as { type?: unknown; activeFlags?: unknown };
  const flags = Array.isArray(v.activeFlags) ? (v.activeFlags as unknown[]) : [];
  const waiting = flags.includes('waitingOnApproval')
    ? 'approval'
    : flags.includes('waitingOnUserInput')
      ? 'input'
      : undefined;
  return { status: text(v.type) ?? 'unknown', ...(waiting ? { waiting } : {}) };
}

interface Turns {
  data?: unknown[];
}

/**
 * Codex's app server at `address`. A start or a message answers once Codex has it in the thread
 * (`waitMs` at most): Codex 0.163 took 0.9 s, and the page reads the thread right after.
 */
export function codexServer(
  address: string,
  {
    version,
    timeoutMs = 20_000,
    waitMs = 3_000,
  }: { version?: string; timeoutMs?: number; waitMs?: number } = {},
): CodexServer {
  const open = () => connectAppServer(address, { ...(version ? { version } : {}), timeoutMs });
  /** Runs `work` on a connection of its own, closed after. */
  const using = async <T>(work: (connection: AppServerConnection) => Promise<T>): Promise<T> => {
    const connection = await open();
    try {
      return await work(connection);
    } finally {
      connection.close();
    }
  };
  /** Resolves when the thread's next message is in it, or after `waitMs`. */
  const messageIn = (connection: AppServerConnection, thread: string) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, waitMs);
      connection.onNotification((method, params) => {
        const v = (params ?? {}) as { threadId?: unknown; item?: { type?: unknown } };
        if (
          method === 'item/completed' &&
          v.threadId === thread &&
          v.item?.type === 'userMessage'
        ) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  const input = (words: string) => [{ type: 'text', text: words, text_elements: [] }];
  const lastTurn = async (connection: AppServerConnection, thread: string) => {
    const turns = await connection.request<Turns>('thread/turns/list', {
      threadId: thread,
      limit: 1,
      sortDirection: 'desc',
      itemsView: 'summary',
    });
    return turnOf(turns.data?.[0]);
  };
  const statusNow = async (connection: AppServerConnection, thread: string) =>
    statusOf(
      (
        await connection.request<{ thread?: { status?: unknown } }>('thread/read', {
          threadId: thread,
        })
      ).thread?.status,
    ).status;

  return {
    address,
    start: ({ cwd, writable, name, prompt }) =>
      using(async (connection) => {
        const started = await connection.request<{ thread?: { id?: unknown } }>('thread/start', {
          cwd,
          sandbox: 'workspace-write',
          approvalPolicy: 'on-request',
          config: { sandbox_workspace_write: { writable_roots: writable } },
        });
        const thread = text(started.thread?.id);
        if (!thread) throw new AppServerError('Codex started no thread');
        const prompted = messageIn(connection, thread);
        await connection.request('turn/start', { threadId: thread, input: input(prompt) });
        // Its name in `codex agents` and `codex resume`'s list; the turn need not wait for it.
        await connection.request('thread/name/set', { threadId: thread, name });
        await prompted;
        return thread;
      }),
    send: ({ thread, text: words }) =>
      using(async (connection) => {
        // Joining the thread: one the server does not hold is loaded with its own options (the
        // server keeps them), and this connection hears when the message is in.
        const resumed = await connection.request<{ thread?: { status?: unknown } }>(
          'thread/resume',
          {
            threadId: thread,
            excludeTurns: true,
          },
        );
        const sent = messageIn(connection, thread);
        let how: 'started' | 'steered' = 'started';
        const running =
          statusOf(resumed.thread?.status).status === 'active'
            ? await lastTurn(connection, thread)
            : null;
        if (running?.status === 'inProgress') {
          await connection.request('turn/steer', {
            threadId: thread,
            expectedTurnId: running.id,
            input: input(words),
          });
          how = 'steered';
        } else await connection.request('turn/start', { threadId: thread, input: input(words) });
        await sent;
        return how;
      }),
    interrupt: (thread) =>
      using(async (connection) => {
        if ((await statusNow(connection, thread)) !== 'active') return false;
        const running = await lastTurn(connection, thread);
        if (running?.status !== 'inProgress') return false;
        await connection.request('turn/interrupt', { threadId: thread, turnId: running.id });
        for (let waited = 0; waited < 2_000; waited += 50) {
          if ((await statusNow(connection, thread)) !== 'active') break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return true;
      }),
    read: (thread, { turns, items }) =>
      using(async (connection) => {
        const read = await connection.request<{ thread?: Record<string, unknown> }>('thread/read', {
          threadId: thread,
        });
        const listed = await connection.request<Turns>('thread/turns/list', {
          threadId: thread,
          limit: turns,
          sortDirection: 'desc',
          itemsView: items,
        });
        const v = read.thread ?? {};
        return {
          id: text(v.id) ?? thread,
          createdAt: seconds(v.createdAt) ?? 0,
          updatedAt: seconds(v.updatedAt) ?? 0,
          ...statusOf(v.status),
          turns: (listed.data ?? [])
            .map(turnOf)
            .filter((turn): turn is CodexTurn => turn !== null)
            .reverse(),
        };
      }),
    archive: (thread) =>
      using(async (connection) => {
        await connection.request('thread/archive', { threadId: thread });
      }),
  };
}
