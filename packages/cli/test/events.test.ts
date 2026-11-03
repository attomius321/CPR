// The page's one stream (V94a, decisions 897–899): the whole state on connect, then only the parts
// whose JSON changed; each part read 30 ms after a trigger, then at most once in `between`; a
// safety read while a page is connected; nothing read with none. Served by a bare http server here,
// read as a browser's EventSource reads it.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EVENT_PARTS,
  eventStream,
  partsOfRecord,
  partsOfWrite,
  type EventPart,
  type EventStream,
} from '../src/events.js';
import { writeFileWhole } from '../src/file-write.js';

interface Event {
  name: string;
  data: unknown;
}

/** An SSE reader: each event as it arrives, and the `retry:` it was told. */
async function listen(url: string) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const events: Event[] = [];
  const waiting: (() => void)[] = [];
  let retry: number | undefined;
  let ended = false;
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let name = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('retry: ')) retry = Number(line.slice(7));
            else if (line.startsWith('event: ')) name = line.slice(7);
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (data) events.push({ name, data: JSON.parse(data) as unknown });
          for (const wake of waiting.splice(0)) wake();
        }
      }
    } catch {
      // Aborted.
    }
    ended = true;
    for (const wake of waiting.splice(0)) wake();
  })();
  /** The next event named `name` after the first `after` events, waited for up to `ms`. */
  async function next(name: string, after = 0, ms = 2_000): Promise<Event> {
    const until = Date.now() + ms;
    for (;;) {
      const found = events.slice(after).find((e) => e.name === name);
      if (found) return found;
      if (ended || Date.now() > until) throw new Error(`no ${name} event`);
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        setTimeout(resolve, 20);
      });
    }
  }
  return {
    events,
    next,
    retry: () => retry,
    ended: () => ended,
    close: () => controller.abort(),
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let server: Server | undefined;
let stream: EventStream | undefined;
const folders: string[] = [];
afterEach(async () => {
  stream?.close();
  stream = undefined;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A stream over parts whose values the test sets, counting their reads. */
async function serve(
  timing: { first?: number; between?: number; safety?: number; alive?: number } = {},
  roots: string[] = [],
  slow: Partial<Record<EventPart, number>> = {},
) {
  const values: Partial<Record<EventPart, unknown>> = {
    workspaces: { workspaces: [] },
    reviews: { reviews: [] },
    merges: { merges: [] },
    nucleus: null,
    scribe: null,
    asks: { asks: [] },
  };
  const reads: Record<string, number> = {};
  const read = Object.fromEntries(
    EVENT_PARTS.map((part) => [
      part,
      async () => {
        reads[part] = (reads[part] ?? 0) + 1;
        const value = values[part];
        if (slow[part]) await wait(slow[part]);
        return value;
      },
    ]),
  );
  stream = eventStream({
    read,
    roots: () => Promise.resolve(roots),
    timing: { first: 5, between: 100, safety: 60_000, alive: 25_000, ...timing },
  });
  const events = stream;
  server = createServer((req, res) => void events.open(req, res));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/events`;
  return { values, reads, url, stream: events };
}

describe('the stream (V94a)', () => {
  it('says to retry after 1 s, gives the stream its id, then the whole state', async () => {
    const { url } = await serve();
    const page = await listen(url);
    const id = await page.next('id');
    expect(id.data).toEqual({ id: expect.stringMatching(/^[0-9a-f]{16}$/) as unknown });
    const state = await page.next('state');
    expect(page.retry()).toBe(1000);
    expect(state.data).toEqual({
      parts: {
        workspaces: { workspaces: [] },
        reviews: { reviews: [] },
        merges: { merges: [] },
        nucleus: null,
        scribe: null,
        asks: { asks: [] },
      },
    });
    page.close();
  });

  it('sends only the parts whose JSON changed after a trigger', async () => {
    const { url, values, stream } = await serve();
    const page = await listen(url);
    await page.next('state');
    values.workspaces = { workspaces: [{ branch: 'a' }] };
    stream.changed(['workspaces', 'reviews'], 'test');
    const change = await page.next('change');
    expect(change.data).toEqual({ parts: { workspaces: { workspaces: [{ branch: 'a' }] } } });
    // Nothing changed: nothing sent.
    const seen = page.events.length;
    stream.changed(['workspaces', 'reviews'], 'test');
    await wait(150);
    expect(page.events.slice(seen)).toEqual([]);
    page.close();
  });

  it('reads a part at most once in `between`, and once more after a trigger meanwhile', async () => {
    const { url, reads, values, stream } = await serve({ first: 5, between: 200 });
    const page = await listen(url);
    await page.next('state');
    // The page's own read counts: the burst starts once `between` has passed since it.
    await wait(250);
    const before = reads.workspaces ?? 0;
    for (let i = 0; i < 20; i++) {
      stream.changed(['workspaces'], 'burst');
      await wait(5);
    }
    values.workspaces = { workspaces: [{ branch: 'last' }] };
    stream.changed(['workspaces'], 'burst');
    await wait(80);
    // The first trigger's read, 5 ms in; the rest wait for 200 ms after it.
    expect((reads.workspaces ?? 0) - before).toBe(1);
    const change = await page.next('change', 0, 1_000);
    expect(change.data).toEqual({ parts: { workspaces: { workspaces: [{ branch: 'last' }] } } });
    expect((reads.workspaces ?? 0) - before).toBe(2);
    page.close();
  });

  it('reads nothing while no page is connected, not even its safety read', async () => {
    const { url, reads, stream } = await serve({ safety: 50 });
    stream.changed(EVENT_PARTS, 'nobody');
    await wait(120);
    expect(reads).toEqual({});
    const page = await listen(url);
    await page.next('state');
    page.close();
    await wait(30);
    const after = { ...reads };
    stream.changed(EVENT_PARTS, 'gone');
    await wait(150);
    expect(reads).toEqual(after);
    expect(stream.connected).toBe(0);
  });

  it('reads every part again every `safety` while a page is connected', async () => {
    const { url, reads, values } = await serve({ safety: 150, between: 10 });
    const page = await listen(url);
    await page.next('state');
    values.merges = { merges: [{ id: 'm1' }] };
    const change = await page.next('change', 0, 1_000);
    expect(change.data).toEqual({ parts: { merges: { merges: [{ id: 'm1' }] } } });
    for (const part of EVENT_PARTS) expect(reads[part]).toBeGreaterThanOrEqual(2);
    page.close();
  });

  it('sends `alive` while nothing changes, so a page can tell a quiet stream from a dead one', async () => {
    const { url } = await serve({ alive: 60 });
    const page = await listen(url);
    await page.next('state');
    const alive = await page.next('alive', 0, 1_000);
    expect(alive.data).toEqual({ at: expect.any(Number) as unknown });
    page.close();
  });

  it("keeps a trigger that comes while a page's first state is read", async () => {
    // The workspaces take 150 ms to read; an ask is held 20 ms after the page connects, once the
    // asks were read for its state.
    const { url, values, stream } = await serve({}, [], { workspaces: 150 });
    const page = await listen(url);
    await wait(20);
    values.asks = { asks: [{ id: 'a1' }] };
    stream.changed(['asks'], 'asks');
    // In its state, or in a change right after it.
    const state = (await page.next('state')).data as { parts: { asks: unknown } };
    const asks =
      JSON.stringify(state.parts.asks) === JSON.stringify({ asks: [{ id: 'a1' }] })
        ? state.parts.asks
        : ((await page.next('change', 0, 1_000)).data as { parts: { asks: unknown } }).parts.asks;
    expect(asks).toEqual({ asks: [{ id: 'a1' }] });
    page.close();
  });

  it('tells pages already connected of a change a new page read first', async () => {
    const { url, values } = await serve();
    const first = await listen(url);
    await first.next('state');
    values.asks = { asks: [{ id: 'a1' }] };
    const second = await listen(url);
    expect((await second.next('state')).data).toMatchObject({
      parts: { asks: { asks: [{ id: 'a1' }] } },
    });
    expect((await first.next('change')).data).toEqual({
      parts: { asks: { asks: [{ id: 'a1' }] } },
    });
    first.close();
    second.close();
  });

  it("hears this process's writes to a record: its parts read at once", async () => {
    const root = mkdtempSync(join(tmpdir(), 'events-'));
    folders.push(root);
    const { url, values } = await serve({}, [root]);
    const page = await listen(url);
    await page.next('state');
    values.reviews = { reviews: [{ branch: 'b' }] };
    await writeFileWhole(join(root, 'reviews', 'b', 'ada@example.com.json'), '{}\n');
    const change = await page.next('change');
    expect(change.data).toEqual({ parts: { reviews: { reviews: [{ branch: 'b' }] } } });
    page.close();
  });

  it('ends every stream when closed, and reads nothing after', async () => {
    const { url, reads, stream } = await serve({ safety: 40, alive: 40 });
    const page = await listen(url);
    await page.next('state');
    stream.close();
    await wait(50);
    expect(page.ended()).toBe(true);
    const after = { ...reads };
    await wait(120);
    expect(reads).toEqual(after);
  });
});

describe('what a write touches (V94a)', () => {
  it("maps a record's path in the records' folder to the parts it changes", () => {
    expect(partsOfRecord('reviews/feature/x/ada@example.com.json')).toEqual([
      'reviews',
      'workspaces',
    ]);
    expect(partsOfRecord('workspaces/feature/x.json')).toEqual(['workspaces', 'reviews']);
    expect(partsOfRecord('threads/feature/x.jsonl')).toEqual(['workspaces']);
    expect(partsOfRecord('activity/feature/x.jsonl')).toEqual(['workspaces']);
    expect(partsOfRecord('hive/feature/x.json')).toEqual(['workspaces']);
    expect(partsOfRecord('hive.json')).toEqual(['workspaces']);
    expect(partsOfRecord('nucleus.json')).toEqual(['nucleus']);
    expect(partsOfRecord('nucleus-activity.jsonl')).toEqual(['nucleus']);
    expect(partsOfRecord('scribe.json')).toEqual(['scribe']);
    expect(partsOfRecord('merges.json')).toEqual(['merges', 'workspaces', 'reviews']);
    expect(partsOfRecord('config.json')).toEqual(['merges', 'workspaces']);
    // What Symbiote writes on reads, or keeps for itself: nothing to tell.
    expect(partsOfRecord('claude-settings.json')).toEqual([]);
    expect(partsOfRecord('AGENTS.md')).toEqual([]);
    expect(partsOfRecord('reviews/.x.json.123.abc.tmp')).toEqual([]);
  });

  it("maps the server's own write requests to the parts they change; a terminal's keys to none", () => {
    expect(partsOfWrite('/api/workspaces')).toEqual(['workspaces', 'reviews']);
    expect(partsOfWrite('/api/workspaces/stop')).toEqual(['workspaces', 'reviews']);
    expect(partsOfWrite('/api/workspaces/draft')).toEqual([]);
    expect(partsOfWrite('/api/merges/approve')).toEqual(['merges', 'workspaces', 'reviews']);
    expect(partsOfWrite('/api/reviews')).toEqual(['reviews']);
    expect(partsOfWrite('/api/state/abc/review')).toEqual(['reviews']);
    expect(partsOfWrite('/review/feature%2Fx/api/state/review')).toEqual(['reviews']);
    expect(partsOfWrite('/api/nucleus/send')).toEqual(['nucleus', 'workspaces']);
    expect(partsOfWrite('/api/scribe/send')).toEqual(['scribe']);
    expect(partsOfWrite('/api/mcp')).toEqual(['asks', 'workspaces', 'reviews', 'merges']);
    expect(partsOfWrite('/api/mcp/answer')).toEqual(['asks', 'workspaces', 'reviews', 'merges']);
    expect(partsOfWrite('/api/hive')).toEqual(['workspaces']);
    expect(partsOfWrite('/api/terminals/abc123/in')).toEqual([]);
    expect(partsOfWrite('/api/logs')).toEqual([]);
    expect(partsOfWrite('/api/events/ping')).toEqual([]);
  });
});

describe("a terminal's output on the page's stream (V94b, decision 903)", () => {
  /** A terminal that keeps what it printed and replays it to each new listener, as terminal.ts. */
  function fakeTerminals() {
    const listeners = new Map<string, Set<{ out(d: string): void; exit(c: number): void }>>();
    const kept = new Map<string, string>([['t1', 'kept ']]);
    return {
      listeners,
      listen(id: string, listener: { out(d: string): void; exit(c: number): void }) {
        if (!kept.has(id)) return undefined;
        if (kept.get(id)) listener.out(kept.get(id) ?? '');
        const set = listeners.get(id) ?? new Set();
        set.add(listener);
        listeners.set(id, set);
        return () => set.delete(listener);
      },
      print(id: string, data: string) {
        kept.set(id, (kept.get(id) ?? '') + data);
        for (const l of listeners.get(id) ?? []) l.out(data);
      },
      exit(id: string, code: number) {
        for (const l of listeners.get(id) ?? []) l.exit(code);
        listeners.delete(id);
        kept.delete(id);
      },
    };
  }

  async function serveWithTerminals() {
    const terminals = fakeTerminals();
    stream = eventStream({
      read: { asks: () => Promise.resolve({ asks: [] }) },
      terminals,
      timing: { first: 5, between: 100, safety: 60_000, alive: 25_000 },
    });
    const events = stream;
    server = createServer((req, res) => void events.open(req, res));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/events`;
    return { terminals, url, stream: events };
  }

  it("sends a listened terminal's replay, then its output, then its end", async () => {
    const { terminals, url, stream } = await serveWithTerminals();
    const page = await listen(url);
    const { id } = (await page.next('id')).data as { id: string };
    expect(stream.listen(id, 't1')).toBe('ok');
    terminals.print('t1', 'more');
    terminals.exit('t1', 0);
    await page.next('exit');
    expect(page.events.filter((e) => e.name !== 'state' && e.name !== 'id')).toEqual([
      { name: 'listening', data: { terminal: 't1' } },
      { name: 'out', data: { terminal: 't1', data: 'kept ' } },
      { name: 'out', data: { terminal: 't1', data: 'more' } },
      { name: 'exit', data: { terminal: 't1', code: 0 } },
    ]);
    page.close();
  });

  it('says which is unknown: the stream, or the terminal', async () => {
    const { url, stream } = await serveWithTerminals();
    const page = await listen(url);
    const { id } = (await page.next('id')).data as { id: string };
    expect(stream.listen('nope', 't1')).toBe('no-stream');
    expect(stream.listen(id, 'gone')).toBe('no-terminal');
    page.close();
  });

  it('sends one copy for two tabs listening on one stream, and stops when both stop', async () => {
    const { terminals, url, stream } = await serveWithTerminals();
    const page = await listen(url);
    const { id } = (await page.next('id')).data as { id: string };
    stream.listen(id, 't1');
    stream.listen(id, 't1');
    expect(terminals.listeners.get('t1')?.size).toBe(1);
    terminals.print('t1', 'x');
    await wait(30);
    expect(
      page.events.filter((e) => e.name === 'out' && (e.data as { data: string }).data === 'x'),
    ).toHaveLength(1);
    expect(stream.listen(id, 't1', true)).toBe('ok');
    expect(terminals.listeners.get('t1')?.size).toBe(1);
    stream.listen(id, 't1', true);
    expect(terminals.listeners.get('t1')?.size).toBe(0);
    page.close();
  });

  it('stops listening when the page goes', async () => {
    const { terminals, url, stream } = await serveWithTerminals();
    const page = await listen(url);
    const { id } = (await page.next('id')).data as { id: string };
    stream.listen(id, 't1');
    page.close();
    await wait(50);
    expect(terminals.listeners.get('t1')?.size).toBe(0);
  });
});
