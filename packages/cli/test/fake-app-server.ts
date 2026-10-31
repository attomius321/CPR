// A fake of Codex's app server (V27a), for unit and e2e tests: a WebSocket server on a unix socket
// (`webSocketServer`: the server side of RFC 6455 that Symbiote's client meets), and on it a small
// model of Codex's threads (`fakeAppServer`) answering as Codex 0.163 did in the V27 spike and
// probes: JSON-RPC without `jsonrpc`, server requests numbered from 0, items without times, turns
// with their times in seconds, `notLoaded` threads after a restart.
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** One client's connection, as the test drives it. */
export interface FakeSocket {
  /** Sends a text message, in `fragments` frames when asked (control frames may come between). */
  send(text: string, fragments?: number, between?: () => void): void;
  ping(payload: string): void;
  /** Sends a close frame and ends the connection. */
  close(code?: number): void;
  /** Writes bytes as they are. */
  raw(bytes: Buffer): void;
  /** Text messages received, whole. */
  received: string[];
  pongs: string[];
  /** The close code the client sent. */
  closed?: number;
  /** Whether the client's frames were all masked (RFC 6455 says they must be). */
  masked: boolean;
  onText(listener: (text: string) => void): void;
  onEnd(listener: () => void): void;
}

/** A server frame: never masked. */
function frame(opcode: number, payload: Buffer, fin = true): Buffer {
  const length = payload.length;
  const head = length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = (fin ? 0x80 : 0) | opcode;
  if (length < 126) head[1] = length;
  else if (length < 65536) {
    head[1] = 126;
    head.writeUInt16BE(length, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([head, payload]);
}

/**
 * A WebSocket server on the unix socket `path`; `answer` writes the upgrade's response (tests
 * pass a wrong one). Its `close` ends every connection and removes the socket.
 */
export async function webSocketServer(
  path: string,
  onSocket: (socket: FakeSocket) => void,
  {
    answer = (key: string) =>
      'HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\n' +
      `sec-websocket-accept: ${createHash('sha1')
        .update(key + GUID)
        .digest('base64')}\r\n` +
      'x-codex-websocket-max-unfragmented-message-bytes: 16777216\r\n\r\n',
  }: { answer?: (key: string) => string } = {},
): Promise<{ close(): Promise<void>; sockets: FakeSocket[] }> {
  const sockets: FakeSocket[] = [];
  const open = new Set<Socket>();
  const server = createServer((socket) => {
    open.add(socket);
    socket.on('close', () => open.delete(socket));
    socket.on('error', () => undefined);
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    const texts: ((text: string) => void)[] = [];
    const ends: (() => void)[] = [];
    const fake: FakeSocket = {
      send(text, fragments = 1, between) {
        const bytes = Buffer.from(text);
        const size = Math.ceil(bytes.length / fragments);
        for (let i = 0; i < fragments; i++) {
          const part = bytes.subarray(i * size, (i + 1) * size);
          socket.write(frame(i === 0 ? 0x1 : 0x0, part, i === fragments - 1));
          if (i < fragments - 1) between?.();
        }
      },
      ping: (payload) => void socket.write(frame(0x9, Buffer.from(payload))),
      close(code = 1000) {
        const body = Buffer.alloc(2);
        body.writeUInt16BE(code);
        socket.end(frame(0x8, body));
      },
      raw: (bytes) => void socket.write(bytes),
      received: [],
      pongs: [],
      masked: true,
      onText: (listener) => void texts.push(listener),
      onEnd: (listener) => void ends.push(listener),
    };
    socket.on('close', () => ends.forEach((end) => end()));
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString();
        buffer = buffer.subarray(end + 4);
        const key = /^sec-websocket-key:\s*(\S+)/im.exec(head)?.[1] ?? '';
        socket.write(answer(key));
        upgraded = true;
        sockets.push(fake);
        onSocket(fake);
      }
      for (;;) {
        if (buffer.length < 2) return;
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
          length = Number(buffer.readBigUInt64BE(2));
          at = 10;
        }
        const masked = (second & 0x80) !== 0;
        if (!masked) fake.masked = false;
        const key = masked ? buffer.subarray(at, at + 4) : null;
        if (key) at += 4;
        if (buffer.length < at + length) return;
        const payload = Buffer.from(buffer.subarray(at, at + length));
        buffer = buffer.subarray(at + length);
        if (key) for (let i = 0; i < payload.length; i++) payload[i]! ^= key[i % 4]!;
        const opcode = first & 0x0f;
        if (opcode === 0x1) {
          const text = payload.toString();
          fake.received.push(text);
          texts.forEach((listener) => listener(text));
        } else if (opcode === 0xa) fake.pongs.push(payload.toString());
        else if (opcode === 0x8) {
          fake.closed = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
          socket.end(frame(0x8, payload));
        }
      }
    });
  });
  rmSync(path, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  return {
    sockets,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => {
          rmSync(path, { force: true });
          resolve();
        });
      }),
  };
}

/** A thread item, as Codex 0.163 sends them (the fields Symbiote reads, and a few it does not). */
export type FakeItem =
  | { type: 'userMessage'; id: string; clientId: null; content: { type: 'text'; text: string }[] }
  | { type: 'agentMessage'; id: string; text: string; phase: 'commentary' | 'final_answer' }
  | { type: 'commandExecution'; id: string; command: string; status: string }
  /** Any other item as Codex sends it (NU2: MCP calls, web searches, compactions). */
  | ({ type: 'mcpToolCall' | 'webSearch' | 'contextCompaction' | 'reasoning'; id: string } & Record<
      string,
      unknown
    >);

interface FakeTurn {
  id: string;
  status: 'inProgress' | 'completed' | 'interrupted' | 'failed';
  items: FakeItem[];
  error: { message: string } | null;
  startedAt: number;
  completedAt: number | null;
}

export interface FakeThread {
  id: string;
  cwd: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  sandbox: string;
  /**
   * The folders a permission profile lets its commands read (V80): Scout's, started with one in its
   * config and no sandbox mode; absent, the sandbox's own reads.
   */
  reads?: string[];
  approvalPolicy: string;
  writableRoots: string[];
  loaded: boolean;
  archived: boolean;
  /** The flags of an active thread: `waitingOnApproval` while it asks. */
  flags: string[];
  turns: FakeTurn[];
  /** Commands its turns left running (Codex's background terminals): they outlive an interrupt. */
  terminals: string[];
  /** Its session file (NU2), as `thread/read` gives it. */
  path?: string;
  /**
   * What it runs on (V83), as Codex 0.163's `Thread` says it: the model and level given at its
   * start or a turn's, else the configured ones (measured on the person's Codex).
   */
  model?: string | null;
  effort?: string | null;
}

/** What the fake was asked: each request's method and parameters, in order. */
export interface FakeCall {
  method: string;
  params: Record<string, unknown>;
  /** Whether its connection opted into experimental methods at `initialize`. */
  experimental: boolean;
}

export interface FakeAppServer {
  /** `unix://<path>`, as `codex app-server daemon` names it. */
  address: string;
  path: string;
  calls: FakeCall[];
  threads: FakeThread[];
  thread(id: string): FakeThread;
  /** Ends the running turn with Codex's last message. */
  reply(thread: string, text: string): void;
  /** Fails the running turn in Codex's words. */
  fail(thread: string, message: string): void;
  /** The running turn asks for an approval (a command), after a commentary message. */
  ask(thread: string, commentary: string, command: string): void;
  /** A turn another client started (the TUI): the person's message, the turn running. */
  typed(thread: string, text: string): void;
  /** The running turn starts a command that runs on (a test run, a server): until it is cleaned. */
  command(thread: string, command: string): void;
  /** An item in the running turn, as Codex sends it (NU2); the same ID replaces it. */
  item(thread: string, item: FakeItem): void;
  /** Codex's trust entries (`projects` in its config), by folder: what `config/read` answers. */
  trusted: Record<string, string>;
  /** Who is signed in (`account/read`, V29c): a ChatGPT Go plan unless a test says otherwise. */
  account: Record<string, unknown> | null;
  /** The account's windows (`account/rateLimits/read`): Go's one 30-day window, 0 % used. */
  rateLimits: Record<string, unknown>;
  /**
   * What `config/read` answers besides `projects` (V30b): the model and level configured,
   * `gpt-6-luna` at `medium` as here in the V30 spike.
   */
  config: { model?: string; model_reasoning_effort?: string };
  /**
   * What `model/list` answers (V30b): Codex 0.163's three models, `gpt-6-luna` the default, with
   * their names and descriptions as it gave them (V47 spike).
   */
  models: Record<string, unknown>[];
  /** How many models a page of `model/list` holds (V47); all of them in one page when null. */
  modelPage: number | null;
  /** The server restarts: running turns interrupted, every thread not loaded, clients cut. */
  restart(): void;
  close(): Promise<void>;
}

/**
 * Codex's app server on `path`, its threads in memory. `now` gives Unix seconds. A turn's
 * message reaches its items `delayMs` after `turn/start` (Codex 0.163: 0.9 s), and a connection
 * gets item events only for the threads it started or resumed (status changes reach all). A
 * thread is named only once it has an item. The methods in `refuse` fail, in the server's words.
 * As Codex 0.163 (V80 spike), a thread started with a permission profile and no sandbox mode reads
 * only the profile's folders; a sandbox mode switches the profile off; with neither, a thread gets
 * the folder's default, writable where Codex trusts it (`trusted`). `profiles: false` is a Codex
 * that does not take profiles.
 */
export async function fakeAppServer(
  path: string,
  {
    now = () => Math.floor(Date.now() / 1000),
    delayMs = 10,
    refuse = [],
    profiles = true,
  }: { now?: () => number; delayMs?: number; refuse?: string[]; profiles?: boolean } = {},
): Promise<FakeAppServer> {
  const calls: FakeCall[] = [];
  const threads: FakeThread[] = [];
  let ids = 0;
  const id = (kind: string) => `${kind}-${++ids}`;
  /** Connections, each with the threads it is subscribed to. */
  const clients = new Map<FakeSocket, Set<string>>();
  /** The connections that opted into experimental methods. */
  const experimental = new Set<FakeSocket>();
  const trusted: Record<string, string> = {};
  const config: FakeAppServer['config'] = { model: 'gpt-6-luna', model_reasoning_effort: 'medium' };
  /** The configured model and level, where a handler's own `config` (a request's) hides it. */
  const configured = config;
  const levels = (...efforts: string[]) =>
    efforts.map((effort) => ({ reasoningEffort: effort, description: `${effort} reasoning` }));
  const models: Record<string, unknown>[] = [
    [
      'gpt-6-luna',
      'GPT-6-Luna',
      'Fast and affordable model for easier tasks.',
      true,
      levels('low', 'medium', 'high', 'xhigh', 'max'),
    ],
    [
      'gpt-5.6-terra',
      'GPT-5.6-Terra',
      'Older balanced model for straightforward work.',
      false,
      levels('low', 'medium', 'high', 'xhigh', 'max', 'ultra'),
    ],
    [
      'gpt-5.6-luna',
      'GPT-5.6-Luna',
      'Older fast and efficient model.',
      false,
      levels('low', 'medium', 'high', 'xhigh', 'max'),
    ],
  ].map(([model, displayName, description, isDefault, supported]) => ({
    id: model,
    model,
    displayName,
    description,
    hidden: false,
    isDefault,
    supportedReasoningEfforts: supported,
    defaultReasoningEffort: 'medium',
  }));
  // As Codex 0.163 answered on a Go plan (V29 spike).
  const usage = {
    account: { type: 'chatgpt', email: 'person@example.com', planType: 'go' } as Record<
      string,
      unknown
    > | null,
    rateLimits: {
      limitId: 'codex',
      limitName: null,
      primary: { usedPercent: 0, windowDurationMins: 43_200, resetsAt: 1_795_046_400 },
      secondary: null,
      credits: { hasCredits: false, unlimited: false, balance: null },
      planType: 'go',
      rateLimitReachedType: null,
    } as Record<string, unknown>,
  };
  const needsExperimental = (method: string, socket: FakeSocket) => {
    if (!experimental.has(socket)) {
      throw Object.assign(new Error(`${method} requires experimentalApi capability`), {
        code: -32600,
      });
    }
  };
  const notify = (thread: string, method: string, params: object, all = false) => {
    for (const [socket, subscribed] of clients) {
      if (all || subscribed.has(thread)) {
        socket.send(JSON.stringify({ method, params, emittedAtMs: Date.now() }));
      }
    }
  };
  let requests = 0;
  const status = (thread: FakeThread) =>
    !thread.loaded
      ? { type: 'notLoaded' }
      : thread.turns.at(-1)?.status === 'inProgress'
        ? { type: 'active', activeFlags: thread.flags }
        : { type: 'idle' };
  const statusChanged = (thread: FakeThread) =>
    notify(
      thread.id,
      'thread/status/changed',
      { threadId: thread.id, status: status(thread) },
      true,
    );
  const turnOf = (turn: FakeTurn, view: 'full' | 'summary' | 'notLoaded') => {
    let items = turn.items;
    if (view === 'summary') {
      const first = items.find((i) => i.type === 'userMessage');
      const last = items.findLast((i) => i.type === 'agentMessage' && i.phase === 'final_answer');
      items = [first, last].filter((i) => i !== undefined);
    } else if (view === 'notLoaded') items = [];
    return {
      id: turn.id,
      rootTurnId: turn.id,
      items,
      itemsView: view,
      status: turn.status,
      error: turn.error ? { ...turn.error, codexErrorInfo: null, additionalDetails: null } : null,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
      durationMs: turn.completedAt === null ? null : (turn.completedAt - turn.startedAt) * 1000,
    };
  };
  const threadOf = (thread: FakeThread) => ({
    id: thread.id,
    sessionId: thread.id,
    preview: '',
    ephemeral: false,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    status: status(thread),
    path: thread.path ?? null,
    cwd: thread.cwd,
    cliVersion: '0.163.0',
    source: 'vscode',
    name: thread.name,
    model: thread.model ?? null,
    reasoningEffort: thread.effort ?? null,
    turns: [],
  });
  // As Codex 0.163 answers: `readOnly` for a read-only thread (V35 spike).
  const sandboxOf = (thread: FakeThread) =>
    thread.sandbox === 'read-only'
      ? { type: 'readOnly', networkAccess: false }
      : {
          type: 'workspaceWrite',
          writableRoots: thread.writableRoots,
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        };
  /** The folders a thread's configuration's permission profile reads, or null without one. */
  const profileOf = (configured: unknown): string[] | null => {
    if (!profiles || !configured || typeof configured !== 'object') return null;
    const { default_permissions: name, permissions } = configured as {
      default_permissions?: unknown;
      permissions?: Record<string, { filesystem?: Record<string, string> }>;
    };
    const filesystem = typeof name === 'string' ? permissions?.[name]?.filesystem : undefined;
    if (!filesystem) return null;
    return Object.keys(filesystem).filter((k) => filesystem[k] === 'read' && !k.startsWith(':'));
  };
  /** With no sandbox mode and no profile: the folder's default, writable where it is trusted. */
  const defaultSandbox = (cwd: string) =>
    trusted[cwd] === 'trusted' ? 'workspace-write' : 'read-only';
  const find = (threadId: unknown): FakeThread => {
    const thread = threads.find((t) => t.id === threadId);
    if (!thread)
      throw Object.assign(new Error(`thread not found: ${String(threadId)}`), { code: -32600 });
    return thread;
  };
  const loaded = (threadId: unknown) => {
    const thread = find(threadId);
    if (!thread.loaded)
      throw Object.assign(new Error(`thread not found: ${String(threadId)}`), { code: -32600 });
    return thread;
  };
  const running = (thread: FakeThread) => {
    const turn = thread.turns.at(-1);
    if (turn?.status !== 'inProgress') throw new Error(`no active turn on ${thread.id}`);
    return turn;
  };
  const message = (thread: FakeThread, turn: FakeTurn, text: string) => {
    const item: FakeItem = {
      type: 'userMessage',
      id: id('item'),
      clientId: null,
      content: [{ type: 'text', text }],
    };
    setTimeout(() => {
      turn.items.push(item);
      thread.updatedAt = now();
      for (const method of ['item/started', 'item/completed']) {
        notify(thread.id, method, { item, threadId: thread.id, turnId: turn.id });
      }
    }, delayMs);
  };
  const begin = (thread: FakeThread, text: string) => {
    const turn: FakeTurn = {
      id: id('turn'),
      status: 'inProgress',
      items: [],
      error: null,
      startedAt: now(),
      completedAt: null,
    };
    thread.turns.push(turn);
    thread.flags = [];
    thread.updatedAt = now();
    statusChanged(thread);
    notify(thread.id, 'turn/started', { threadId: thread.id, turn: turnOf(turn, 'notLoaded') });
    message(thread, turn, text);
    return turn;
  };
  const end = (thread: FakeThread, status: FakeTurn['status'], error?: string) => {
    const turn = running(thread);
    turn.status = status;
    turn.completedAt = now();
    if (error) turn.error = { message: error };
    thread.flags = [];
    thread.updatedAt = now();
    statusChanged(thread);
    notify(thread.id, 'turn/completed', { threadId: thread.id, turn: turnOf(turn, 'summary') });
  };
  const text = (input: unknown) =>
    ((input as { text?: string }[] | undefined) ?? []).map((i) => i.text ?? '').join('');

  const methods: Record<string, (params: Record<string, unknown>, socket: FakeSocket) => unknown> =
    {
      initialize: (params, socket) => {
        const capabilities = params.capabilities as { experimentalApi?: unknown } | null;
        if (capabilities?.experimentalApi === true) experimental.add(socket);
        return {
          userAgent: 'symbiote/0.163.0',
          codexHome: '/home/someone/.codex',
          platformFamily: 'unix',
          platformOs: 'linux',
        };
      },
      'thread/start': (params, socket) => {
        const config = params.config as
          { sandbox_workspace_write?: { writable_roots?: string[] } } | undefined;
        const mode = typeof params.sandbox === 'string' ? params.sandbox : null;
        const reads = mode ? null : profileOf(params.config);
        const thread: FakeThread = {
          id: id('thread'),
          cwd: String(params.cwd),
          name: null,
          createdAt: now(),
          updatedAt: now(),
          sandbox: mode ?? (reads ? 'read-only' : defaultSandbox(String(params.cwd))),
          ...(reads ? { reads } : {}),
          approvalPolicy:
            typeof params.approvalPolicy === 'string' ? params.approvalPolicy : 'on-request',
          writableRoots: config?.sandbox_workspace_write?.writable_roots ?? [],
          loaded: true,
          archived: false,
          flags: [],
          turns: [],
          terminals: [],
          model: typeof params.model === 'string' ? params.model : (configured.model ?? null),
          effort:
            (params.config as { model_reasoning_effort?: string } | undefined)
              ?.model_reasoning_effort ??
            configured.model_reasoning_effort ??
            null,
        };
        threads.push(thread);
        clients.get(socket)?.add(thread.id);
        notify(thread.id, 'thread/started', { thread: threadOf(thread) });
        return {
          thread: threadOf(thread),
          cwd: thread.cwd,
          approvalPolicy: thread.approvalPolicy,
          sandbox: sandboxOf(thread),
        };
      },
      'thread/resume': (params, socket) => {
        const thread = find(params.threadId);
        if (!thread.loaded) {
          // One the server does not hold takes the profile it is resumed with; without one, a
          // thread that had one gets the folder's default (V80 spike: writable where trusted).
          const reads = profileOf(params.config);
          if (reads) {
            thread.reads = reads;
            thread.sandbox = 'read-only';
          } else if (thread.reads) {
            delete thread.reads;
            thread.sandbox = defaultSandbox(thread.cwd);
          }
        }
        thread.loaded = true;
        clients.get(socket)?.add(thread.id);
        // A client that joins a waiting thread is asked too (the V27 spike's TUI).
        if (thread.flags.includes('waitingOnApproval')) {
          socket.send(
            JSON.stringify({
              method: 'item/commandExecution/requestApproval',
              id: requests++,
              params: { threadId: thread.id },
            }),
          );
        }
        return {
          thread: threadOf(thread),
          cwd: thread.cwd,
          approvalPolicy: thread.approvalPolicy,
          sandbox: sandboxOf(thread),
        };
      },
      'thread/name/set': (params) => {
        const thread = find(params.threadId);
        // Codex 0.163 names a thread only once its rollout has an item (V27a's real run).
        if (!thread.turns.some((turn) => turn.items.length > 0)) {
          throw new Error(
            `failed to set thread name: Fatal error: failed to update thread metadata ${thread.id}: rollout is empty`,
          );
        }
        thread.name = typeof params.name === 'string' ? params.name : null;
        notify(thread.id, 'thread/name/updated', { threadId: thread.id, threadName: thread.name });
        return {};
      },
      'turn/start': (params) => {
        const thread = loaded(params.threadId);
        if (thread.turns.at(-1)?.status === 'inProgress')
          throw new Error('a turn is already running');
        // "For this turn and subsequent turns": the thread's own from now on.
        if (typeof params.effort === 'string') thread.effort = params.effort;
        if (typeof params.model === 'string') thread.model = params.model;
        return { turn: turnOf(begin(thread, text(params.input)), 'notLoaded') };
      },
      'turn/steer': (params) => {
        const thread = loaded(params.threadId);
        const turn = running(thread);
        if (turn.id !== params.expectedTurnId) throw new Error('expected turn mismatch');
        message(thread, turn, text(params.input));
        return { turnId: turn.id };
      },
      'turn/interrupt': (params) => {
        const thread = loaded(params.threadId);
        if (running(thread).id !== params.turnId) throw new Error('not the active turn');
        setTimeout(() => end(thread, 'interrupted'), 3);
        return {};
      },
      'thread/read': (params) => ({ thread: threadOf(find(params.threadId)) }),
      'thread/turns/list': (params) => {
        const thread = find(params.threadId);
        const view = (params.itemsView as 'full' | 'summary' | undefined) ?? 'summary';
        const turns = thread.turns.map((turn) => turnOf(turn, view));
        if (params.sortDirection === 'desc') turns.reverse();
        const limit = typeof params.limit === 'number' ? params.limit : turns.length;
        return { data: turns.slice(0, limit), nextCursor: null, backwardsCursor: null };
      },
      'account/read': () => ({ account: usage.account, requiresOpenaiAuth: true }),
      'account/rateLimits/read': () => ({
        ordinaryUsageAllowed: true,
        rateLimits: usage.rateLimits,
        rateLimitsByLimitId: { codex: usage.rateLimits },
      }),
      'model/list': (params) => {
        const from = typeof params.cursor === 'string' ? Number(params.cursor) : 0;
        const size = fake.modelPage ?? models.length;
        const to = from + size;
        return {
          data: models.slice(from, to),
          nextCursor: to < models.length ? String(to) : null,
        };
      },
      'config/read': () => ({
        config: {
          ...config,
          projects: Object.fromEntries(
            Object.entries(trusted).map(([folder, level]) => [folder, { trust_level: level }]),
          ),
        },
        origins: {},
        layers: null,
      }),
      'thread/backgroundTerminals/list': (params, socket) => {
        needsExperimental('thread/backgroundTerminals/list', socket);
        const thread = find(params.threadId);
        return {
          data: thread.terminals.map((command, i) => ({ processId: String(i), command })),
          nextCursor: null,
        };
      },
      'thread/backgroundTerminals/clean': (params, socket) => {
        needsExperimental('thread/backgroundTerminals/clean', socket);
        find(params.threadId).terminals = [];
        return {};
      },
      // The e2e's fake TUI trusts a folder as Codex's does when the person says so.
      'fake/trust': (params) => {
        trusted[String(params.folder)] = 'trusted';
        return {};
      },
      'thread/archive': (params) => {
        const thread = find(params.threadId);
        thread.archived = true;
        return {};
      },
    };

  const ws = await webSocketServer(path, (socket) => {
    clients.set(socket, new Set());
    socket.onEnd(() => {
      clients.delete(socket);
      experimental.delete(socket);
    });
    socket.onText((line) => {
      const request = JSON.parse(line) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
      };
      if (!request.method) return; // a client's answer to a server request
      if (request.id === undefined) return; // a notification (`initialized`)
      const params = request.params ?? {};
      calls.push({ method: request.method, params, experimental: experimental.has(socket) });
      const handler = methods[request.method];
      try {
        if (!handler)
          throw Object.assign(new Error(`unknown method ${request.method}`), { code: -32601 });
        if (refuse.includes(request.method)) throw new Error(`refused: ${request.method}`);
        socket.send(JSON.stringify({ id: request.id, result: handler(params, socket) }));
      } catch (error) {
        const { message, code = -32603 } = error as Error & { code?: number };
        socket.send(JSON.stringify({ id: request.id, error: { code, message } }));
      }
    });
  });

  const fake: FakeAppServer = {
    address: `unix://${path}`,
    path,
    calls,
    threads,
    thread: find,
    reply(thread, value) {
      const t = find(thread);
      const item: FakeItem = {
        type: 'agentMessage',
        id: id('msg'),
        text: value,
        phase: 'final_answer',
      };
      running(t).items.push(item);
      notify(t.id, 'item/completed', { item, threadId: t.id, turnId: running(t).id });
      end(t, 'completed');
    },
    fail: (thread, value) => end(find(thread), 'failed', value),
    ask(thread, commentary, command) {
      const t = find(thread);
      const turn = running(t);
      turn.items.push({
        type: 'agentMessage',
        id: id('msg'),
        text: commentary,
        phase: 'commentary',
      });
      t.flags = ['waitingOnApproval'];
      t.updatedAt = now();
      statusChanged(t);
      for (const [socket, subscribed] of clients) {
        if (!subscribed.has(t.id)) continue;
        socket.send(
          JSON.stringify({
            method: 'item/commandExecution/requestApproval',
            id: requests++,
            params: {
              kind: 'command',
              threadId: t.id,
              turnId: turn.id,
              itemId: id('exec'),
              command,
            },
          }),
        );
      }
    },
    command(thread, value) {
      const t = find(thread);
      const turn = running(t);
      turn.items.push({
        type: 'commandExecution',
        id: id('exec'),
        command: value,
        status: 'inProgress',
      });
      t.terminals.push(value);
    },
    item(thread, item) {
      const t = find(thread);
      const turn = running(t);
      const at = turn.items.findIndex((i) => i.id === item.id);
      if (at >= 0) turn.items[at] = item;
      else turn.items.push(item);
      t.updatedAt = now();
    },
    trusted,
    config,
    models,
    modelPage: null,
    get account() {
      return usage.account;
    },
    set account(value) {
      usage.account = value;
    },
    get rateLimits() {
      return usage.rateLimits;
    },
    set rateLimits(value) {
      usage.rateLimits = value;
    },
    typed(thread, value) {
      const t = loaded(thread);
      if (t.turns.at(-1)?.status === 'inProgress') throw new Error(`a turn runs on ${thread}`);
      begin(t, value);
    },
    restart() {
      for (const thread of threads) {
        const turn = thread.turns.at(-1);
        if (turn?.status === 'inProgress') turn.status = 'interrupted';
        thread.loaded = false;
        thread.flags = [];
      }
      for (const socket of clients.keys()) socket.close(1012);
      clients.clear();
    },
    close: () => ws.close(),
  };
  return fake;
}

/** What `codex app-server daemon start` prints (Codex 0.163): log lines, then its state as JSON. */
export function daemonStartOutput(socketPath: string, status = 'alreadyRunning'): string {
  return [
    JSON.stringify({ timestampMs: 1, processPid: 2, stage: 'pid_write', outcome: 'succeeded' }),
    JSON.stringify({
      status,
      backend: 'pid',
      managedCodexVersion: '0.163.0',
      socketPath,
      cliVersion: '0.163.0',
      appServerVersion: '0.163.0',
    }),
    '',
  ].join('\n');
}
