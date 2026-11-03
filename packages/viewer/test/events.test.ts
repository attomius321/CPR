// The page's store of what `symbiote view` pushes (V94a, decisions 897, 901): the whole state on
// connect, then the parts that changed; a part whose JSON did not change keeps its object; polling
// as today when there is no stream. A fake EventSource stands for the browser's.
import { describe, expect, it } from 'vitest';
import { pushStore, type Parts, type PushEnv, type Status } from '../src/shell/events.js';

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
    search,
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
