// What `symbiote view` pushes to the page (V94a, decisions 897, 901): one stream, `/api/events`,
// with the whole of the shell's state on each connect, then only the parts whose JSON changed. A
// part that did not change keeps its object, so nothing keyed on it reads or draws again (every
// poll replaced every object). Without a stream — no `EventSource`, `?poll`, or a server that
// refused it before its first state (an older `symbiote view`: 404) — the store says so, and the
// readers poll as they did before V94.
//
// One stream per browser (V94b, decisions 902–903): Chrome holds 6 connections to a host, and an
// `EventSource` keeps one, so one stream per tab stalled the 6th tab. The tab holding the Web Lock
// `symbiote-events:<host>` opens the stream and relays each event on the `BroadcastChannel` of the
// same name; a tab that joins says `hello` and the holder answers with the whole state. When the
// holder closes, the next tab waiting for the lock takes it. The holder beats every 10 s; a tab
// that hears nothing for 30 s (a frozen holder) opens a stream of its own. Terminals' output rides
// the same stream: a tab listens to a terminal by the stream's ID, and the holder relays it.
import { useSyncExternalStore } from 'react';
import type {
  BranchReviewList,
  McpAsks,
  MergeList,
  PageAgentState,
  WorkspaceList,
} from '@symbiote/core';

/** The shell's state, as the stream sends it: each part as its own read answers it. */
export interface Parts {
  workspaces?: WorkspaceList | null;
  reviews?: BranchReviewList | null;
  merges?: MergeList | null;
  nucleus?: PageAgentState | null;
  scribe?: PageAgentState | null;
  asks?: McpAsks | null;
}
export type PartName = keyof Parts;

/**
 * `connecting` until the first state; `streaming`; `reconnecting` while the stream is lost (the
 * sidenav says since when); `unavailable`: no stream, the page polls.
 */
export type Status = 'connecting' | 'streaming' | 'reconnecting' | 'unavailable';

/** The parts that changed (only those), and the status: told on either changing. */
export type PushListener = (changed: Parts, status: Status) => void;

/** What a terminal shown in this tab is told of its output on the browser's stream (V94b). */
export interface TerminalHandlers {
  /** Its output is listened to: what it kept follows. Told again after a new stream. */
  listening(): void;
  out(data: string): void;
  exit(code: number): void;
  /** Symbiote has no such terminal any more. */
  lost(): void;
}

/** A `BroadcastChannel`, as the store uses it. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

/** The browser's parts the store uses, given so a test can stand in for them. */
export interface PushEnv {
  /** Absent where the browser has none. */
  EventSource?: typeof EventSource;
  /** `navigator.locks`; absent where there are none: each tab opens its own stream. */
  locks?: { request(name: string, callback: () => Promise<void>): Promise<unknown> };
  /** `BroadcastChannel`; absent: each tab opens its own stream. */
  Channel?: new (name: string) => ChannelLike;
  /** `location.host`: the lock and the channel are this server's. */
  host: string;
  /** `location.search`: `?poll` turns the stream off. */
  search: string;
  now(): number;
  setTimeout(run: () => void, ms: number): number;
  clearTimeout(id: number): void;
  /** A JSON write with `x-symbiote`: its status; rejects when Symbiote did not answer. */
  post(path: string, body: unknown): Promise<number>;
}

/** With no event at all for this long (the server sends `alive` every 25 s), the stream is lost. */
const SILENT_MS = 60_000;
/** How long before a stream closed after it streamed is opened again (the server's `retry`). */
const AGAIN_MS = 1_000;
/** How often the holder says it is there. */
const BEAT_MS = 10_000;
/** How long a tab hears nothing from the holder before it opens a stream of its own. */
const HOLDER_SILENT_MS = 30_000;

/** What the tabs of one browser say to each other on the channel. */
type Message =
  | { kind: 'hello' }
  | { kind: 'state'; parts: Parts; stream: string | null }
  | { kind: 'change'; parts: Parts }
  | { kind: 'status'; status: Status }
  | { kind: 'stream'; stream: string }
  | { kind: 'beat' }
  | { kind: 'touched'; paths: string[] }
  | { kind: 'listening'; terminal: string }
  | { kind: 'out'; terminal: string; data: string }
  | { kind: 'exit'; terminal: string; code: number };

export interface PushStore {
  /** Listens; the stream opens with the first listener, which gets what is known at once. */
  subscribe(listener: PushListener): () => void;
  status(): Status;
  /** The parts as last known (none before the first state). */
  parts(): Parts;
  /** When the stream was last heard from, by the page's clock; 0 before. */
  heardAt(): number;
  /**
   * A terminal's output on the browser's stream (V94b); the way to stop. Use only while the
   * status is not `unavailable`.
   */
  listenTerminal(terminal: string, handlers: TerminalHandlers): () => void;
  /**
   * How often a record file a page reads beside the parts (`threads/<branch>.jsonl`,
   * `activity/<branch>.jsonl`, `hive/<branch>.json`, `nucleus-activity.jsonl`) was said to change
   * (V94c): what reads it reads again on a new count.
   */
  touched(path: string): number;
  /** Listens to the paths said to change; the way to stop. */
  onTouched(listener: (paths: readonly string[]) => void): () => void;
  /** The tab's part in the browser: tests only. */
  role(): 'alone' | 'holder' | 'follower' | 'none';
  /** Ends everything: what a closed tab does (tests). */
  close(): void;
}

export function pushStore(env: PushEnv): PushStore {
  const listeners = new Set<PushListener>();
  let status: Status = 'connecting';
  let started = false;
  let closed = false;
  let parts: Parts = {};
  /** Each part's JSON, to tell a part sent again unchanged from a changed one. */
  const texts = new Map<PartName, string>();
  let source: EventSource | null = null;
  let streamed = false;
  let heard = 0;
  let silence: number | undefined;
  /** `alone`: a stream of its own, relayed to none; `holder`: the browser's; `follower`: relayed. */
  let role: 'alone' | 'holder' | 'follower' | 'none' = 'none';
  let channel: ChannelLike | null = null;
  let beat: number | undefined;
  let holderSilence: number | undefined;
  /** The ID of the stream that carries this browser's terminals. */
  let stream: string | null = null;
  const terminals = new Map<string, Set<TerminalHandlers>>();
  const touchedCounts = new Map<string, number>();
  const touchListeners = new Set<(paths: readonly string[]) => void>();
  function touched(paths: readonly string[]): void {
    for (const path of paths) touchedCounts.set(path, (touchedCounts.get(path) ?? 0) + 1);
    for (const listener of touchListeners) listener(paths);
  }

  function tell(changed: Parts): void {
    for (const listener of listeners) listener(changed, status);
  }

  function relay(message: Message): void {
    if (role === 'holder') channel?.postMessage(message);
  }

  function setStatus(next: Status): void {
    if (status === next) return;
    status = next;
    relay({ kind: 'status', status: next });
    tell({});
  }

  /** Takes what was sent: the parts whose JSON changed replace theirs, the others keep theirs. */
  function take(sent: Parts, whole: boolean): void {
    const changed: Parts = {};
    for (const [name, value] of Object.entries(sent) as [PartName, unknown][]) {
      const text = JSON.stringify(value ?? null);
      if (texts.get(name) === text) continue;
      texts.set(name, text);
      (changed as Record<PartName, unknown>)[name] = value ?? null;
    }
    parts = { ...parts, ...changed };
    const was = status;
    if (whole) status = 'streaming';
    if (Object.keys(changed).length > 0 || status !== was) tell(changed);
  }

  // Terminals (V94b, decision 903).
  function listenOn(terminal: string, stop = false): void {
    const on = stream;
    if (!on) return;
    env.post('/api/events/listen', { stream: on, terminal, ...(stop ? { stop } : {}) }).then(
      (answer) => {
        // 409: that stream is gone; the new one's ID listens again.
        if (answer === 404 && !stop && stream === on) {
          for (const handlers of terminals.get(terminal) ?? []) handlers.lost();
          terminals.delete(terminal);
        }
      },
      () => {
        // Symbiote did not answer: the next stream listens again.
      },
    );
  }

  function setStream(id: string): void {
    if (stream === id) return;
    stream = id;
    for (const terminal of terminals.keys()) listenOn(terminal);
  }

  function terminalEvent(message: Extract<Message, { terminal: string }>): void {
    const shown = terminals.get(message.terminal);
    if (!shown) return;
    for (const handlers of shown) {
      if (message.kind === 'listening') handlers.listening();
      else if (message.kind === 'out') handlers.out(message.data);
      else handlers.exit(message.code);
    }
    if (message.kind === 'exit') terminals.delete(message.terminal);
  }

  /** Heard from: the silence's clock starts again. */
  function heardNow(): void {
    heard = env.now();
    if (silence !== undefined) env.clearTimeout(silence);
    silence = env.setTimeout(() => {
      // Silent too long (a sleep, a relay that dropped it): open it again.
      source?.close();
      source = null;
      setStatus('reconnecting');
      env.setTimeout(open, AGAIN_MS);
    }, SILENT_MS);
  }

  function open(): void {
    if (closed) return;
    const Source = env.EventSource;
    if (!Source) return setStatus('unavailable');
    const es = new Source('/api/events');
    source = es;
    let stated = false;
    const data = <T>(event: Event) => JSON.parse((event as MessageEvent<string>).data) as T;
    es.addEventListener('id', (event) => {
      if (source !== es) return;
      const { id } = data<{ id: string }>(event);
      relay({ kind: 'stream', stream: id });
      setStream(id);
    });
    es.addEventListener('state', (event) => {
      if (source !== es) return;
      stated = true;
      streamed = true;
      heardNow();
      take(data<{ parts: Parts }>(event).parts, true);
      relay({ kind: 'state', parts, stream });
    });
    es.addEventListener('change', (event) => {
      if (source !== es) return;
      heardNow();
      const sent = data<{ parts: Parts }>(event).parts;
      take(sent, false);
      relay({ kind: 'change', parts: sent });
    });
    es.addEventListener('alive', () => {
      if (source === es) heardNow();
    });
    es.addEventListener('touched', (event) => {
      if (source !== es) return;
      heardNow();
      const { paths } = data<{ paths: string[] }>(event);
      touched(paths);
      relay({ kind: 'touched', paths });
    });
    for (const kind of ['listening', 'out', 'exit'] as const) {
      es.addEventListener(kind, (event) => {
        if (source !== es) return;
        const message = { kind, ...data<object>(event) } as Extract<Message, { terminal: string }>;
        terminalEvent(message);
        relay(message);
      });
    }
    es.onerror = () => {
      if (source !== es) return;
      if (es.readyState !== Source.CLOSED) {
        // Lost: the browser opens it again after the server's `retry`.
        if (status !== 'connecting' || streamed) setStatus('reconnecting');
        return;
      }
      source = null;
      if (!stated && !streamed) {
        // Refused before any state: no stream here (an older `symbiote view`).
        if (silence !== undefined) env.clearTimeout(silence);
        return setStatus('unavailable');
      }
      setStatus('reconnecting');
      env.setTimeout(open, AGAIN_MS);
    };
  }

  /** A follower that heard nothing for 30 s opens a stream of its own: its holder froze. */
  function holderHeard(): void {
    if (holderSilence !== undefined) env.clearTimeout(holderSilence);
    if (role !== 'follower') return;
    holderSilence = env.setTimeout(() => {
      if (role !== 'follower' || closed) return;
      role = 'alone';
      open();
    }, HOLDER_SILENT_MS);
  }

  function onMessage(message: Message): void {
    if (closed) return;
    if (message.kind === 'hello') {
      if (role !== 'holder') return;
      if (status === 'streaming') relay({ kind: 'state', parts, stream });
      // No stream here (an older `symbiote view`), or lost: the tab that joins learns it at once.
      else if (status !== 'connecting') relay({ kind: 'status', status });
      return;
    }
    if (role === 'holder') return;
    if (role === 'alone') {
      // A tab that opened its own stream after its holder froze goes back to listening.
      if (message.kind !== 'beat' && message.kind !== 'state') return;
      source?.close();
      source = null;
      if (silence !== undefined) env.clearTimeout(silence);
      role = 'follower';
    }
    holderHeard();
    if (message.kind === 'state') {
      if (message.stream) setStream(message.stream);
      take(message.parts, true);
    } else if (message.kind === 'change') take(message.parts, false);
    else if (message.kind === 'status') setStatus(message.status);
    else if (message.kind === 'stream') setStream(message.stream);
    else if (message.kind === 'touched') touched(message.paths);
    else if (message.kind !== 'beat') terminalEvent(message);
  }

  /** The lock is this tab's: it opens the stream (or keeps its own) and relays it. */
  function hold(): void {
    if (closed) return;
    if (holderSilence !== undefined) env.clearTimeout(holderSilence);
    const had = role === 'alone' && source !== null;
    role = 'holder';
    const beating = () => {
      relay({ kind: 'beat' });
      beat = env.setTimeout(beating, BEAT_MS);
    };
    beating();
    if (had) {
      if (stream) relay({ kind: 'stream', stream });
      if (status === 'streaming') relay({ kind: 'state', parts, stream });
    } else open();
  }

  function start(): void {
    started = true;
    if (!env.EventSource || new URLSearchParams(env.search).has('poll')) {
      status = 'unavailable';
      return;
    }
    if (!env.locks || !env.Channel) {
      role = 'alone';
      open();
      return;
    }
    const name = `symbiote-events:${env.host}`;
    channel = new env.Channel(name);
    channel.onmessage = (event) => onMessage(event.data as Message);
    role = 'follower';
    holderHeard();
    // Held until the tab closes: then the next tab waiting for it takes the stream.
    void env.locks.request(name, () => {
      hold();
      return new Promise<void>(() => {});
    });
    channel.postMessage({ kind: 'hello' } satisfies Message);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!started) start();
      if (status !== 'connecting') listener(parts, status);
      return () => {
        listeners.delete(listener);
      };
    },
    status: () => status,
    parts: () => parts,
    heardAt: () => heard,
    listenTerminal(terminal, handlers) {
      const shown = terminals.get(terminal) ?? new Set<TerminalHandlers>();
      const first = shown.size === 0;
      shown.add(handlers);
      terminals.set(terminal, shown);
      if (first) listenOn(terminal);
      return () => {
        if (!shown.delete(handlers) || shown.size > 0) return;
        terminals.delete(terminal);
        listenOn(terminal, true);
      };
    },
    touched: (path) => touchedCounts.get(path) ?? 0,
    onTouched(listener) {
      touchListeners.add(listener);
      return () => {
        touchListeners.delete(listener);
      };
    },
    role: () => role,
    close() {
      closed = true;
      source?.close();
      source = null;
      channel?.close();
      for (const timer of [silence, beat, holderSilence]) {
        if (timer !== undefined) env.clearTimeout(timer);
      }
      role = 'none';
    },
  };
}

/**
 * The address's `?poll` as the page loaded: read before the shell moves `/` to `/overview` (V91),
 * which leaves the query behind.
 */
const loadedWith = typeof location === 'undefined' ? '' : location.search;

/**
 * The page's one store: the stream is the page's while it lives, opened by the first reader.
 * Outside a page (a unit test in Node) there is no stream: the readers poll.
 */
let store: PushStore | null = null;
export function pushed(): PushStore {
  const page = typeof window !== 'undefined';
  store ??= pushStore({
    ...(page && typeof EventSource !== 'undefined' ? { EventSource } : {}),
    ...(page && typeof navigator.locks?.request === 'function' ? { locks: navigator.locks } : {}),
    ...(page && typeof BroadcastChannel !== 'undefined' ? { Channel: BroadcastChannel } : {}),
    host: page ? location.host : '',
    search: loadedWith,
    now: () => Date.now(),
    setTimeout: (run, ms) => globalThis.setTimeout(run, ms) as unknown as number,
    clearTimeout: (id) => globalThis.clearTimeout(id),
    post: (path, body) =>
      fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
        body: JSON.stringify(body),
      }).then((response) => response.status),
  });
  return store;
}

/**
 * How often `path`, a record file the page reads beside the parts, was said to change (V94c): a
 * read keyed on it reads again. Always 0 without a stream: the readers' own keys do then.
 */
export function useTouched(path: string | null): number {
  return useSyncExternalStore(
    (changed) =>
      pushed().onTouched((paths) => {
        if (path !== null && paths.includes(path)) changed();
      }),
    () => (path === null ? 0 : pushed().touched(path)),
  );
}

/**
 * A terminal's output (V21) for `AgentTerminal`: on the browser's one stream where Symbiote pushes
 * (V94b), else its own `EventSource` on `/api/terminals/<id>`, as before. The way to stop.
 */
export function terminalOutput(terminal: string, handlers: TerminalHandlers): () => void {
  const store = pushed();
  let stop = () => {};
  const own = () => {
    const events = new EventSource(`/api/terminals/${terminal}`);
    events.addEventListener('open', () => handlers.listening());
    events.addEventListener('out', (event) =>
      handlers.out(JSON.parse((event as MessageEvent<string>).data) as string),
    );
    events.addEventListener('exit', (event) =>
      handlers.exit((JSON.parse((event as MessageEvent<string>).data) as { code: number }).code),
    );
    events.addEventListener('error', () => {
      if (events.readyState === EventSource.CLOSED) handlers.lost();
    });
    stop = () => events.close();
  };
  if (store.status() === 'unavailable') {
    own();
    return () => stop();
  }
  stop = store.listenTerminal(terminal, handlers);
  // The store learns only now that there is no stream (an older `symbiote view`): its own.
  let switched = false;
  const unsubscribe = store.subscribe((_changed, status) => {
    if (status !== 'unavailable' || switched) return;
    switched = true;
    stop();
    own();
  });
  return () => {
    unsubscribe();
    stop();
  };
}
