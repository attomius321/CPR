// Codex's app server (V27a, decisions 154–155): Symbiote as one of its clients, on the WebSocket of
// the person's daemon's unix socket — JSON-RPC without the `jsonrpc` field (Codex 0.163). One
// connection per call: Symbiote keeps no thread subscribed (a thread's clients get every delta of
// its turns) and reads what it shows with `thread/read` and `thread/turns/list`. What it reads is
// checked field by field: the protocol is `[experimental]`.
import {
  EFFORT_LEVEL,
  MODEL_ID,
  type AgentEfforts,
  type AgentModel,
  type AgentModels,
} from '@symbiote/core';
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

/** A start that failed once the server had made its thread: the thread is Codex's still. */
export class AppServerStartFailed extends AppServerError {
  constructor(
    message: string,
    readonly thread: string,
  ) {
    super(message);
  }
}

export interface AppServerConnection {
  request<T = unknown>(method: string, params?: object): Promise<T>;
  /** Notifications: what happens on the threads this connection started or resumed. */
  onNotification(listener: (method: string, params: unknown) => void): void;
  close(): void;
}

/** A unix socket's path from `unix://<path>`, the only kind Symbiote connects to. */
function socketOf(address: string): string {
  const path = /^unix:\/\/(\/.+)$/.exec(address)?.[1];
  if (!path) throw new AppServerUnreachable(`not a unix:// address: ${address}`);
  return path;
}

/**
 * Connects to the app server at `address` (`unix://<path>`) and introduces Symbiote (`initialize`,
 * then `initialized`); `experimental` opts this connection into Codex's experimental methods.
 * Each request is answered within `timeoutMs` or fails.
 */
export async function connectAppServer(
  address: string,
  {
    version = '0.0.0',
    timeoutMs = 20_000,
    experimental = false,
  }: { version?: string; timeoutMs?: number; experimental?: boolean } = {},
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
    // A server request has a method and its own ID (from 0): never an answer to Symbiote's.
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
      clientInfo: { name: 'symbiote', title: 'Symbiote', version },
      capabilities: experimental ? { experimentalApi: true, requestAttestation: false } : null,
    });
  } catch (error) {
    ws.close();
    throw error;
  }
  ws.send(JSON.stringify({ method: 'initialized' }));
  return connection;
}

/** A Codex thread as Symbiote reads it. */
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
  /**
   * Read in full (V48f): what it ran, changed, searched or thought, in its order; absent in a
   * `summary` read, which lists no such item.
   */
  items?: CodexItem[];
}

/** An item of a turn read in full (V48f), as Symbiote shows what Codex does. */
export interface CodexItem {
  id: string;
  /** `command`, `fileChange`, `mcp`, `webSearch` or `reasoning`. */
  kind: string;
  /**
   * What it works on, at most 160 characters: a command's first line, the files changed (by
   * path, as Codex gives them), an MCP server's tool, a search's query.
   */
  subject?: string;
  /** Codex's: `inProgress`, `completed`, `failed`, `declined`; absent for reasoning. */
  status?: string;
  /** Failed, declined, or a command that exited with another code than 0. */
  failed?: true;
}

/** What Symbiote asks of Codex's app server (V27a); tests use a fake server. */
export interface CodexServer {
  /** Where it listens, as `codex resume --remote` takes it: `unix://<socket>`. */
  address: string;
  /**
   * Starts a thread in `cwd` in the `workspace-write` sandbox, `writable` also writable (the
   * branch's git folders, decision 130), approvals asked (`on-request`), named `name`, with
   * `prompt` as its first turn — at `effort` when given (V30b), which the server keeps for the
   * thread's next turns —; its ID once the prompt is in the thread. `readOnly` (Scout, V35): the
   * `read-only` sandbox instead, nothing writable, approvals `never`: a command the sandbox refuses
   * fails, nobody is asked. `confined` (Scribe, V41): `workspace-write` with `cwd` its only writable
   * folder, approvals `never`: a write elsewhere fails (decision 275). On `model` when given (V47):
   * the thread's own, kept for its turns and through a resume (V47's real run).
   */
  start(request: {
    cwd: string;
    writable: string[];
    name: string;
    prompt: string;
    effort?: string;
    model?: string;
    readOnly?: true;
    confined?: true;
    /** The thread's own configuration (MC1: Scout's, Symbiote's MCP server), beside Symbiote's. */
    config?: Record<string, unknown>;
  }): Promise<string>;
  /**
   * The effort levels of the model a thread in `cwd` would use (V30b): the configured model's
   * (`config/read`), else the default model's (`model/list`), and the configured level, else the
   * model's default. Null when they cannot be read: these methods are `[experimental]`.
   */
  efforts(cwd: string): Promise<AgentEfforts | null>;
  /**
   * The models a thread in `cwd` can run on (V47): `model/list`'s, every page, not hidden, each
   * with its levels; the default, the configured model (`config/read`) else the one marked as
   * the default. Null when none can be read.
   */
  models(cwd: string): Promise<AgentModels | null>;
  /**
   * Gives a thread a message: a new turn, or joined to the one that runs (`turn/steer`).
   * A thread the server does not hold (it restarted) is resumed first, with its own options.
   */
  send(request: {
    thread: string;
    text: string;
    /** Given again with the resume (MC1): a thread the server does not hold gets it back. */
    config?: Record<string, unknown>;
  }): Promise<'started' | 'steered'>;
  /**
   * Loads a thread with `config` and no turn (MC1): before Codex's terminal joins it, so the
   * thread has Symbiote's MCP server whatever the server held.
   */
  load(request: { thread: string; config: Record<string, unknown> }): Promise<void>;
  /**
   * Interrupts the turn that runs, once it ended (2 s at most), then the commands the thread's
   * turns left running (Codex's background terminals, decision 159); whether a turn ran. Where
   * Codex refuses the second (it is experimental), the turn is still interrupted.
   */
  interrupt(thread: string): Promise<boolean>;
  /** Codex's trust entries (`projects` in its configuration), by folder: `trusted`, `untrusted`. */
  trust(cwd: string): Promise<Record<string, string>>;
  /** A thread and its newest `turns`, their items in `summary` or in `full`. */
  read(thread: string, view: { turns: number; items: 'summary' | 'full' }): Promise<CodexThread>;
  /** Out of Codex's lists (`thread/archive`), not deleted: `codex unarchive` brings it back. */
  archive(thread: string): Promise<void>;
  /**
   * The account's plan and its windows of use (V29c): `account/read`, then
   * `account/rateLimits/read` (it asks OpenAI: 0.8 s). Null for a login that has no windows (an
   * API key); `rateLimits` as Codex sent it, read field by field by `usage.ts`.
   */
  limits(): Promise<{ plan?: string; rateLimits: unknown } | null>;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
const seconds = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const level = (value: unknown): string | undefined =>
  typeof value === 'string' && EFFORT_LEVEL.test(value) ? value : undefined;

/**
 * A model's effort levels (V30b): the configured model's, else the one `model/list` marks as the
 * default; the levels that are words, the configured level else the model's default. Only the
 * list's first page is read (3 models in Codex 0.163): a model past it gives null, not a guess.
 */
function effortsOf(config: Record<string, unknown>, models: unknown): AgentEfforts | null {
  const listed = (Array.isArray(models) ? models : []) as Record<string, unknown>[];
  const configured = text(config.model);
  const model = configured
    ? listed.find((m) => m?.model === configured || m?.id === configured)
    : listed.find((m) => m?.isDefault === true);
  if (!model) return null;
  const options = Array.isArray(model.supportedReasoningEfforts)
    ? (model.supportedReasoningEfforts as { reasoningEffort?: unknown }[])
    : [];
  const levels = options
    .map((option) => level(option?.reasoningEffort))
    .filter((found): found is string => found !== undefined);
  if (levels.length === 0) return null;
  const fallback = level(config.model_reasoning_effort) ?? level(model.defaultReasoningEffort);
  return { levels, ...(fallback ? { default: fallback } : {}) };
}

/** Pages of `model/list` read at most (V47): Codex 0.163 gave its 3 models in one. */
const MODEL_PAGES = 5;

/**
 * The models Codex lists (V47), not hidden, with the ID it takes (`model`), its name, description
 * and levels — each one's default the configured level, else its own, as `effortsOf` —; the
 * default, the configured model else the listed default. Null with none.
 */
function modelsOf(
  config: Record<string, unknown>,
  listed: Record<string, unknown>[],
): AgentModels | null {
  const models = listed
    .filter((m) => m?.hidden !== true)
    .map((m): AgentModel | null => {
      const id = text(m.model) ?? text(m.id);
      if (!id || !MODEL_ID.test(id)) return null;
      const description = text(m.description);
      const levels = (
        Array.isArray(m.supportedReasoningEfforts)
          ? (m.supportedReasoningEfforts as { reasoningEffort?: unknown }[])
          : []
      )
        .map((option) => level(option?.reasoningEffort))
        .filter((found): found is string => found !== undefined);
      const fallback = level(config.model_reasoning_effort) ?? level(m.defaultReasoningEffort);
      return {
        id,
        name: text(m.displayName) ?? id,
        ...(description ? { description } : {}),
        ...(levels.length > 0
          ? { efforts: { levels, ...(fallback ? { default: fallback } : {}) } }
          : {}),
      };
    })
    .filter((m): m is AgentModel => m !== null);
  if (models.length === 0) return null;
  const marked = listed.find((m) => m?.isDefault === true);
  const chosen =
    text(config.model) ?? (marked ? (text(marked.model) ?? text(marked.id)) : undefined);
  return { models, ...(chosen && MODEL_ID.test(chosen) ? { default: chosen } : {}) };
}

/** A turn's fields Symbiote uses, from what the server sent. */
/** Longest subject kept of an item (V48f), as Claude Code's hooks keep theirs. */
const SUBJECT = 160;
const short = (words: string | undefined) => words?.split('\n')[0]?.trim().slice(0, SUBJECT);

/** An item Symbiote shows (V48f), from a turn read in full; null for messages and the rest. */
function itemOf(item: Record<string, unknown>): CodexItem | null {
  const id = text(item.id);
  if (!id) return null;
  const status = text(item.status);
  const failed = status === 'failed' || status === 'declined';
  const head = (kind: string, subject: string | undefined, bad = failed): CodexItem => ({
    id,
    kind,
    ...(subject ? { subject } : {}),
    ...(status ? { status } : {}),
    ...(bad ? { failed: true as const } : {}),
  });
  switch (item.type) {
    case 'commandExecution': {
      const code = item.exitCode;
      return head(
        'command',
        short(text(item.command)),
        failed || (typeof code === 'number' && code !== 0),
      );
    }
    case 'fileChange': {
      const paths = (Array.isArray(item.changes) ? (item.changes as { path?: unknown }[]) : [])
        .map((change) => text(change?.path))
        .filter((path): path is string => path !== undefined);
      return head('fileChange', short(paths.join(', ')));
    }
    case 'mcpToolCall': {
      const server = text(item.server);
      const tool = text(item.tool);
      return head('mcp', short(server && tool ? `${server}.${tool}` : (tool ?? server)));
    }
    case 'webSearch':
      return head('webSearch', short(text(item.query)));
    case 'reasoning':
      return { id, kind: 'reasoning' };
    default:
      return null;
  }
}

function turnOf(value: unknown, full = false): CodexTurn | null {
  const v = (value ?? {}) as Record<string, unknown>;
  const id = text(v.id);
  if (!id) return null;
  const prompts: string[] = [];
  const items: CodexItem[] = [];
  let final: string | undefined;
  let last: string | undefined;
  for (const item of Array.isArray(v.items) ? (v.items as Record<string, unknown>[]) : []) {
    const shown = item ? itemOf(item) : null;
    if (shown) items.push(shown);
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
    ...(full ? { items } : {}),
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
  const open = (experimental = false) =>
    connectAppServer(address, { ...(version ? { version } : {}), timeoutMs, experimental });
  /** Runs `work` on a connection of its own, closed after. */
  const using = async <T>(
    work: (connection: AppServerConnection) => Promise<T>,
    experimental = false,
  ): Promise<T> => {
    const connection = await open(experimental);
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
    start: ({ cwd, writable, name, prompt, effort, model, readOnly, confined, config }) =>
      using(async (connection) => {
        const on = model ? { model } : {};
        const own = config ? { config } : {};
        const started = await connection.request<{ thread?: { id?: unknown } }>(
          'thread/start',
          readOnly
            ? { cwd, ...on, sandbox: 'read-only', approvalPolicy: 'never', ...own }
            : confined
              ? { cwd, ...on, sandbox: 'workspace-write', approvalPolicy: 'never', ...own }
              : {
                  cwd,
                  ...on,
                  sandbox: 'workspace-write',
                  approvalPolicy: 'on-request',
                  config: { sandbox_workspace_write: { writable_roots: writable }, ...config },
                },
        );
        const thread = text(started.thread?.id);
        if (!thread) throw new AppServerError('Codex started no thread');
        const prompted = messageIn(connection, thread);
        try {
          await connection.request('turn/start', {
            threadId: thread,
            input: input(prompt),
            ...(effort ? { effort } : {}),
          });
        } catch (error) {
          throw new AppServerStartFailed((error as Error).message, thread);
        }
        await prompted;
        // Its name in `codex agents` and `codex resume`'s list: only once the prompt is in (Codex
        // 0.163 refuses to name a thread whose rollout is empty), and never why a start fails.
        await connection
          .request('thread/name/set', { threadId: thread, name })
          .catch(() => undefined);
        return thread;
      }),
    send: ({ thread, text: words, config }) =>
      using(async (connection) => {
        // Joining the thread: one the server does not hold is loaded with its own options (the
        // server keeps them), and this connection hears when the message is in.
        const resumed = await connection.request<{ thread?: { status?: unknown } }>(
          'thread/resume',
          {
            threadId: thread,
            excludeTurns: true,
            ...(config ? { config } : {}),
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
    load: ({ thread, config }) =>
      using(async (connection) => {
        await connection.request('thread/resume', { threadId: thread, excludeTurns: true, config });
      }),
    async interrupt(thread) {
      const interrupted = await using(async (connection) => {
        if ((await statusNow(connection, thread)) !== 'active') return false;
        const running = await lastTurn(connection, thread);
        if (running?.status !== 'inProgress') return false;
        await connection.request('turn/interrupt', { threadId: thread, turnId: running.id });
        for (let waited = 0; waited < 2_000; waited += 50) {
          if ((await statusNow(connection, thread)) !== 'active') break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return true;
      });
      // An interrupted turn's command runs on (Codex 0.163, V27b spike): ended here.
      await using(
        (connection) =>
          connection.request('thread/backgroundTerminals/clean', { threadId: thread }),
        true,
      ).catch(() => undefined);
      return interrupted;
    },
    efforts: (cwd) =>
      using(async (connection) => {
        const read = await connection.request<{ config?: Record<string, unknown> }>('config/read', {
          cwd,
        });
        const listed = await connection.request<{ data?: unknown }>('model/list', {});
        return effortsOf(read.config ?? {}, listed.data);
      }),
    models: (cwd) =>
      using(async (connection) => {
        const read = await connection.request<{ config?: Record<string, unknown> }>('config/read', {
          cwd,
        });
        const listed: Record<string, unknown>[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MODEL_PAGES; page++) {
          const answer = await connection.request<{ data?: unknown; nextCursor?: unknown }>(
            'model/list',
            cursor ? { cursor } : {},
          );
          if (Array.isArray(answer.data))
            listed.push(...(answer.data as Record<string, unknown>[]));
          cursor = text(answer.nextCursor);
          if (!cursor) break;
        }
        return modelsOf(read.config ?? {}, listed);
      }),
    trust: (cwd) =>
      using(async (connection) => {
        const read = await connection.request<{ config?: { projects?: unknown } }>('config/read', {
          cwd,
        });
        const projects = read.config?.projects;
        const entries: Record<string, string> = {};
        if (projects && typeof projects === 'object') {
          for (const [folder, value] of Object.entries(projects as Record<string, unknown>)) {
            const level = text((value as { trust_level?: unknown } | null)?.trust_level);
            if (level) entries[folder] = level;
          }
        }
        return entries;
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
            .map((turn) => turnOf(turn, items === 'full'))
            .filter((turn): turn is CodexTurn => turn !== null)
            .reverse(),
        };
      }),
    archive: (thread) =>
      using(async (connection) => {
        await connection.request('thread/archive', { threadId: thread });
      }),
    limits: () =>
      using(async (connection) => {
        const read = await connection.request<{ account?: { type?: unknown; planType?: unknown } }>(
          'account/read',
          { refreshToken: false },
        );
        if (read.account?.type !== 'chatgpt') return null;
        const plan = text(read.account.planType);
        const limits = await connection.request<{ rateLimits?: unknown }>(
          'account/rateLimits/read',
        );
        return { ...(plan ? { plan } : {}), rateLimits: limits.rateLimits ?? null };
      }),
  };
}
