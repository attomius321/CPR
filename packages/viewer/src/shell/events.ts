// What `symbiote view` pushes to the page (V94a, decisions 897, 901): one stream, `/api/events`,
// with the whole of the shell's state on each connect, then only the parts whose JSON changed. A
// part that did not change keeps its object, so nothing keyed on it reads or draws again (every
// poll replaced every object). Without a stream — no `EventSource`, `?poll`, or a server that
// refused it before its first state (an older `symbiote view`: 404) — the store says so, and the
// readers poll as they did before V94.
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

/** The browser's parts the store uses, given so a test can stand in for them. */
export interface PushEnv {
  /** Absent where the browser has none. */
  EventSource?: typeof EventSource;
  /** `location.search`: `?poll` turns the stream off. */
  search: string;
  now(): number;
  setTimeout(run: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** With no event at all for this long (the server sends `alive` every 25 s), the stream is lost. */
const SILENT_MS = 60_000;
/** How long before a stream closed after it streamed is opened again (the server's `retry`). */
const AGAIN_MS = 1_000;

export interface PushStore {
  /** Listens; the stream opens with the first listener, which gets what is known at once. */
  subscribe(listener: PushListener): () => void;
  status(): Status;
  /** The parts as last known (none before the first state). */
  parts(): Parts;
  /** When the stream was last heard from, by the page's clock; 0 before. */
  heardAt(): number;
}

export function pushStore(env: PushEnv): PushStore {
  const listeners = new Set<PushListener>();
  let status: Status = 'connecting';
  let started = false;
  let parts: Parts = {};
  /** Each part's JSON, to tell a part sent again unchanged from a changed one. */
  const texts = new Map<PartName, string>();
  let source: EventSource | null = null;
  let streamed = false;
  let heard = 0;
  let silence: number | undefined;

  function tell(changed: Parts): void {
    for (const listener of listeners) listener(changed, status);
  }

  function setStatus(next: Status): void {
    if (status === next) return;
    status = next;
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
    const Source = env.EventSource;
    if (!Source) return setStatus('unavailable');
    const es = new Source('/api/events');
    source = es;
    let stated = false;
    const data = (event: Event) => JSON.parse((event as MessageEvent<string>).data) as unknown;
    es.addEventListener('state', (event) => {
      if (source !== es) return;
      stated = true;
      streamed = true;
      heardNow();
      take((data(event) as { parts: Parts }).parts, true);
    });
    es.addEventListener('change', (event) => {
      if (source !== es) return;
      heardNow();
      take((data(event) as { parts: Parts }).parts, false);
    });
    es.addEventListener('alive', () => {
      if (source === es) heardNow();
    });
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

  function start(): void {
    started = true;
    if (!env.EventSource || new URLSearchParams(env.search).has('poll')) {
      status = 'unavailable';
      return;
    }
    open();
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
  };
}

/**
 * The page's one store: the stream is the page's while it lives, opened by the first reader.
 * Outside a page (a unit test in Node) there is no stream: the readers poll.
 */
let store: PushStore | null = null;
export function pushed(): PushStore {
  const page = typeof window !== 'undefined';
  store ??= pushStore({
    ...(page && typeof EventSource !== 'undefined' ? { EventSource } : {}),
    search: page ? location.search : '',
    now: () => Date.now(),
    setTimeout: (run, ms) => globalThis.setTimeout(run, ms) as unknown as number,
    clearTimeout: (id) => globalThis.clearTimeout(id),
  });
  return store;
}
