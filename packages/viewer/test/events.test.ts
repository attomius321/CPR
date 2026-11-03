// The page's store of what `symbiote view` pushes (V94a, decisions 897, 901): the whole state on
// connect, then the parts that changed; a part whose JSON did not change keeps its object; polling
// as today when there is no stream. A fake EventSource stands for the browser's.
import { describe, expect, it } from 'vitest';
import {
  pushStore,
  type ChannelLike,
  type Parts,
  type PushEnv,
  type Status,
  type TerminalHandlers,
} from '../src/shell/events.js';

type Listener = (event: MessageEvent<string>) => void;

class FakeSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static made: FakeSource[] = [];
  readyState = FakeSource.CONNECTING;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Listener[]>();
  constructor(readonly url: string) {
    FakeSource.made.push(this);
  }
  addEventListener(name: string, listener: Listener): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  close(): void {
    this.readyState = FakeSource.CLOSED;
  }
  emit(name: string, data: unknown): void {
    this.readyState = FakeSource.OPEN;
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent<string>);
    }
  }
  fail(closed: boolean): void {
    this.readyState = closed ? FakeSource.CLOSED : FakeSource.CONNECTING;
    this.onerror?.(new Event('error'));
  }
}

/** A store over the fake, with a clock the test moves. */
function made(search = '') {
  FakeSource.made = [];
  let now = 1_000;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let ids = 0;
  const env: PushEnv = {
    EventSource: FakeSource as unknown as typeof EventSource,
    host: '127.0.0.1:4000',
    search,
    post: () => Promise.resolve(204),
    now: () => now,
    setTimeout: (run, ms) => {
      const id = ++ids;
      timers.push({ at: now + ms, run, id });
      return id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const created = pushStore(env);
  const seen: { parts: Parts; status: Status }[] = [];
  created.subscribe((parts, status) => seen.push({ parts, status }));
  return {
    store: created,
    seen,
    source: () => FakeSource.made.at(-1)!,
    advance: (ms: number) => {
      now += ms;
      for (const t of timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)) {
        timers.splice(timers.indexOf(t), 1);
        t.run();
      }
    },
  };
}

const STATE = {
  parts: {
    workspaces: { workspaces: [{ branch: 'a' }], place: 'repository' },
    reviews: { reviews: [] },
    merges: { merges: [] },
    nucleus: null,
    scribe: null,
    asks: { asks: [] },
  },
};

describe('the pushed state (V94a)', () => {
  it('opens /api/events and hands every part on the whole state', () => {
    const { store, seen, source } = made();
    expect(source().url).toBe('/api/events');
    expect(store.status()).toBe('connecting');
    source().emit('id', { id: 'abc' });
    source().emit('state', STATE);
    expect(store.status()).toBe('streaming');
    expect(seen.at(-1)).toEqual({ parts: STATE.parts, status: 'streaming' });
    expect(store.parts()).toEqual(STATE.parts);
  });

  it('hands on only the parts that changed, and keeps the others’ objects', () => {
    const { store, seen, source } = made();
    source().emit('state', STATE);
    const reviews = store.parts().reviews;
    source().emit('change', { parts: { workspaces: { workspaces: [], place: 'repository' } } });
    expect(seen.at(-1)?.parts).toEqual({ workspaces: { workspaces: [], place: 'repository' } });
    expect(store.parts().reviews).toBe(reviews);
  });

  it('keeps the objects of parts a reconnect sent unchanged', () => {
    const { store, seen, source } = made();
    source().emit('state', STATE);
    const before = store.parts();
    source().fail(false);
    expect(store.status()).toBe('reconnecting');
    expect(seen.at(-1)).toEqual({ parts: {}, status: 'reconnecting' });
    source().emit('state', {
      parts: { ...STATE.parts, merges: { merges: [{ id: 'm1' }] } },
    });
    expect(seen.at(-1)).toEqual({
      parts: { merges: { merges: [{ id: 'm1' }] } },
      status: 'streaming',
    });
    expect(store.parts().workspaces).toBe(before.workspaces);
    expect(store.parts().asks).toBe(before.asks);
  });

  it('is unavailable without a stream: no EventSource, ?poll, or a stream refused before its state', () => {
    expect(made('?poll').store.status()).toBe('unavailable');
    expect(FakeSource.made).toEqual([]);
    const refused = made();
    refused.source().fail(true);
    expect(refused.store.status()).toBe('unavailable');
    expect(refused.seen.at(-1)).toEqual({ parts: {}, status: 'unavailable' });
    const none = pushStore({
      host: '',
      post: () => Promise.resolve(204),
      search: '',
      now: () => 0,
      setTimeout: () => 0,
      clearTimeout: () => {},
    });
    none.subscribe(() => {});
    expect(none.status()).toBe('unavailable');
  });

  it('opens a new stream a second after one that streamed was closed', () => {
    const { store, source, advance } = made();
    source().emit('state', STATE);
    const first = source();
    first.fail(true);
    expect(store.status()).toBe('reconnecting');
    advance(999);
    expect(source()).toBe(first);
    advance(1);
    expect(source()).not.toBe(first);
    source().emit('state', STATE);
    expect(store.status()).toBe('streaming');
  });

  it('opens it again when it falls silent: no event, not even `alive`, for 60 s', () => {
    const { store, source, advance } = made();
    source().emit('state', STATE);
    const first = source();
    advance(50_000);
    first.emit('alive', { at: 1 });
    advance(50_000);
    expect(source()).toBe(first);
    expect(store.heardAt()).toBe(51_000);
    advance(10_000);
    expect(first.readyState).toBe(FakeSource.CLOSED);
    expect(store.status()).toBe('reconnecting');
    advance(1_000);
    expect(source()).not.toBe(first);
  });

  it('gives a late listener what it has', () => {
    const { store, source } = made();
    source().emit('state', STATE);
    const late: { parts: Parts; status: Status }[] = [];
    store.subscribe((parts, status) => late.push({ parts, status }));
    expect(late).toEqual([{ parts: STATE.parts, status: 'streaming' }]);
  });
});

/**
 * One browser: a clock, a lock manager and channels shared by its tabs, as Chrome's are. Messages
 * and grants arrive after the current task, as the browser's do.
 */
function browser() {
  FakeSource.made = [];
  let now = 1_000;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let ids = 0;
  const channels = new Set<FakeChannel>();
  class FakeChannel implements ChannelLike {
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(readonly name: string) {
      channels.add(this);
    }
    postMessage(message: unknown): void {
      const copy = structuredClone(message);
      for (const other of channels) {
        if (other !== this && other.name === this.name) {
          queueMicrotask(() => other.onmessage?.({ data: copy } as MessageEvent));
        }
      }
    }
    close(): void {
      channels.delete(this);
    }
  }
  /** Who holds each lock, and who waits for it, in order. */
  const held = new Map<string, number>();
  const waiting: { name: string; tab: number; grant: () => void }[] = [];
  let tabs = 0;
  const posts: { tab: number; path: string; body: unknown }[] = [];
  const answers = new Map<string, number>();
  function tab() {
    const me = ++tabs;
    const env: PushEnv = {
      EventSource: FakeSource as unknown as typeof EventSource,
      locks: {
        request(name, callback) {
          const grant = () => {
            held.set(name, me);
            queueMicrotask(() => void callback());
          };
          if (held.has(name)) waiting.push({ name, tab: me, grant });
          else grant();
          return Promise.resolve();
        },
      },
      Channel: FakeChannel,
      host: '127.0.0.1:4000',
      search: '',
      now: () => now,
      setTimeout: (run, ms) => {
        const id = ++ids;
        timers.push({ at: now + ms, run, id });
        return id;
      },
      clearTimeout: (id) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
      post: (path, body) => {
        posts.push({ tab: me, path, body });
        const terminal = (body as { terminal: string }).terminal;
        return Promise.resolve(answers.get(terminal) ?? 204);
      },
    };
    const store = pushStore(env);
    const seen: { parts: Parts; status: Status }[] = [];
    store.subscribe((parts, status) => seen.push({ parts, status }));
    const sources = new Set<FakeSource>();
    return {
      me,
      store,
      seen,
      /** Closes the tab: its stream, channel and lock go. */
      close() {
        store.close();
        for (const [name, holder] of held) {
          if (holder !== me) continue;
          held.delete(name);
          const next = waiting.findIndex((w) => w.name === name);
          if (next >= 0) waiting.splice(next, 1)[0]!.grant();
        }
        for (let i = waiting.length - 1; i >= 0; i--)
          if (waiting[i]?.tab === me) waiting.splice(i, 1);
      },
      sources,
    };
  }
  return {
    tab,
    posts,
    answers,
    flush: async () => {
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    },
    advance: async (ms: number) => {
      const until = now + ms;
      for (;;) {
        const next = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        timers.splice(timers.indexOf(next), 1);
        next.run();
        for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      now = until;
    },
  };
}

describe('one stream per browser (V94b)', () => {
  it('the tab holding the lock opens the one stream; a tab that joins gets its whole state', async () => {
    const b = browser();
    const first = b.tab();
    await b.flush();
    expect(first.store.role()).toBe('holder');
    expect(FakeSource.made).toHaveLength(1);
    FakeSource.made[0]!.emit('id', { id: 's1' });
    FakeSource.made[0]!.emit('state', STATE);
    await b.flush();
    const second = b.tab();
    await b.flush();
    expect(second.store.role()).toBe('follower');
    expect(FakeSource.made).toHaveLength(1);
    expect(second.store.status()).toBe('streaming');
    expect(second.store.parts()).toEqual(STATE.parts);
  });

  it('relays each change to every tab, which keeps the objects of the other parts', async () => {
    const b = browser();
    const tabs = [b.tab(), b.tab(), b.tab()];
    await b.flush();
    const source = FakeSource.made[0]!;
    source.emit('state', STATE);
    await b.flush();
    const reviews = tabs.map((t) => t.store.parts().reviews);
    source.emit('change', { parts: { merges: { merges: [{ id: 'm1' }] } } });
    await b.flush();
    for (const [i, t] of tabs.entries()) {
      expect(t.seen.at(-1)).toEqual({
        parts: { merges: { merges: [{ id: 'm1' }] } },
        status: 'streaming',
      });
      expect(t.store.parts().reviews).toBe(reviews[i]);
    }
    expect(FakeSource.made).toHaveLength(1);
  });

  it('hands the stream on when its tab closes: the next tab takes the lock and opens it', async () => {
    const b = browser();
    const [first, second, third] = [b.tab(), b.tab(), b.tab()];
    await b.flush();
    FakeSource.made[0]!.emit('state', STATE);
    await b.flush();
    first.close();
    await b.flush();
    expect(second.store.role()).toBe('holder');
    expect(FakeSource.made).toHaveLength(2);
    FakeSource.made[1]!.emit('state', {
      parts: { ...STATE.parts, asks: { asks: [{ id: 'a1' }] } },
    });
    await b.flush();
    expect(third.store.parts().asks).toEqual({ asks: [{ id: 'a1' }] });
    expect(third.store.role()).toBe('follower');
  });

  it('a tab that hears nothing from the holder for 30 s opens its own; the beat keeps it from that', async () => {
    const b = browser();
    const [first, second] = [b.tab(), b.tab()];
    await b.flush();
    FakeSource.made[0]!.emit('state', STATE);
    await b.flush();
    // The holder beats every 10 s: a minute passes with one stream.
    for (let i = 0; i < 6; i++) {
      FakeSource.made[0]!.emit('alive', {});
      await b.advance(10_000);
    }
    expect(FakeSource.made).toHaveLength(1);
    // The holder freezes: nothing from it any more.
    first.store.close();
    await b.advance(29_000);
    expect(FakeSource.made).toHaveLength(1);
    await b.advance(2_000);
    expect(second.store.role()).toBe('alone');
    expect(FakeSource.made).toHaveLength(2);
  });

  it("follows the holder's status: polling everywhere when the holder has no stream", async () => {
    const b = browser();
    const [first, second] = [b.tab(), b.tab()];
    await b.flush();
    FakeSource.made[0]!.fail(true);
    await b.flush();
    expect(first.store.status()).toBe('unavailable');
    expect(second.store.status()).toBe('unavailable');
  });
});

describe("a terminal's output on the browser's stream (V94b)", () => {
  const handlers = () => {
    const got: string[] = [];
    const h: TerminalHandlers = {
      listening: () => got.push('listening'),
      out: (data) => got.push(`out ${data}`),
      exit: (code) => got.push(`exit ${code}`),
      lost: () => got.push('lost'),
    };
    return { got, h };
  };

  it('listens by the stream’s ID, from the tab that shows it; the output reaches that tab', async () => {
    const b = browser();
    const [first, second] = [b.tab(), b.tab()];
    await b.flush();
    const source = FakeSource.made[0]!;
    source.emit('id', { id: 's1' });
    source.emit('state', STATE);
    await b.flush();
    const shown = handlers();
    second.store.listenTerminal('t1', shown.h);
    await b.flush();
    expect(b.posts).toEqual([
      { tab: second.me, path: '/api/events/listen', body: { stream: 's1', terminal: 't1' } },
    ]);
    source.emit('listening', { terminal: 't1' });
    source.emit('out', { terminal: 't1', data: 'hi' });
    source.emit('exit', { terminal: 't1', code: 0 });
    await b.flush();
    expect(shown.got).toEqual(['listening', 'out hi', 'exit 0']);
    void first;
  });

  it('listens again on the next stream when the holder changes; says when the terminal is gone', async () => {
    const b = browser();
    const [first, second] = [b.tab(), b.tab()];
    await b.flush();
    FakeSource.made[0]!.emit('id', { id: 's1' });
    FakeSource.made[0]!.emit('state', STATE);
    await b.flush();
    const shown = handlers();
    second.store.listenTerminal('t1', shown.h);
    await b.flush();
    first.close();
    await b.flush();
    // The second tab holds the lock now, and its own stream says its ID.
    FakeSource.made[1]!.emit('id', { id: 's2' });
    await b.flush();
    expect(b.posts.map((p) => p.body)).toEqual([
      { stream: 's1', terminal: 't1' },
      { stream: 's2', terminal: 't1' },
    ]);
    b.answers.set('t2', 404);
    const gone = handlers();
    second.store.listenTerminal('t2', gone.h);
    await b.flush();
    expect(gone.got).toEqual(['lost']);
  });

  it('stops listening once no view in the tab shows it', async () => {
    const b = browser();
    const only = b.tab();
    await b.flush();
    FakeSource.made[0]!.emit('id', { id: 's1' });
    await b.flush();
    const one = handlers();
    const two = handlers();
    const stopOne = only.store.listenTerminal('t1', one.h);
    const stopTwo = only.store.listenTerminal('t1', two.h);
    stopOne();
    expect(b.posts.map((p) => p.body)).toEqual([{ stream: 's1', terminal: 't1' }]);
    stopTwo();
    expect(b.posts.map((p) => p.body)).toEqual([
      { stream: 's1', terminal: 't1' },
      { stream: 's1', terminal: 't1', stop: true },
    ]);
  });
});

describe('files said to change (V94c)', () => {
  it('counts each path in every tab of the browser, and tells who listens', async () => {
    const b = browser();
    const [first, second] = [b.tab(), b.tab()];
    await b.flush();
    FakeSource.made[0]!.emit('state', STATE);
    await b.flush();
    const heard: (readonly string[])[] = [];
    second.store.onTouched((paths) => heard.push(paths));
    FakeSource.made[0]!.emit('touched', { paths: ['threads/feature/x.jsonl'] });
    FakeSource.made[0]!.emit('touched', { paths: ['threads/feature/x.jsonl', 'hive/a.json'] });
    await b.flush();
    for (const t of [first, second]) {
      expect(t.store.touched('threads/feature/x.jsonl')).toBe(2);
      expect(t.store.touched('hive/a.json')).toBe(1);
      expect(t.store.touched('activity/feature/x.jsonl')).toBe(0);
    }
    expect(heard).toEqual([
      ['threads/feature/x.jsonl'],
      ['threads/feature/x.jsonl', 'hive/a.json'],
    ]);
  });
});

describe('a tab that joins a holder with no stream (V94b)', () => {
  it('is told at once that there is none, and polls', async () => {
    const b = browser();
    const first = b.tab();
    await b.flush();
    FakeSource.made[0]!.fail(true);
    await b.flush();
    expect(first.store.status()).toBe('unavailable');
    const late = b.tab();
    await b.flush();
    expect(late.store.status()).toBe('unavailable');
    expect(late.seen.at(-1)).toEqual({ parts: {}, status: 'unavailable' });
  });
});
