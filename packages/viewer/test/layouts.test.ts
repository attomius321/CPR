import { readFileSync } from 'node:fs';
import type { Graph } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { layoutFlow, type FlowLayout } from '../src/flow.js';
import {
  LayoutCache,
  layoutKey,
  workerLayouts,
  type LayoutMessage,
  type LayoutReply,
  type LayoutWorker,
} from '../src/layouts.js';

const golden = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../core/test/__snapshots__/graph-${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as Graph;

/** A stand-in layout: only its identity matters to the cache. */
const fake = (name: string) => ({ name }) as unknown as FlowLayout;

describe('layoutKey', () => {
  it('gives one view one key, whatever the order of its sets', () => {
    expect(layoutKey({})).toBe(layoutKey({ context: true, typeReferences: false }));
    expect(layoutKey({ expanded: new Set(['b', 'a']), focus: new Set(['y', 'x']) })).toBe(
      layoutKey({ expanded: new Set(['a', 'b']), focus: new Set(['x', 'y']) }),
    );
    expect(layoutKey({ expanded: new Set() })).toBe(layoutKey({}));
  });

  it('tells views apart', () => {
    const keys = [
      layoutKey({}),
      layoutKey({ context: false }),
      layoutKey({ typeReferences: true }),
      layoutKey({ focus: new Set() }),
      layoutKey({ focus: new Set(['a']) }),
      layoutKey({ expanded: new Set(['a']) }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('LayoutCache', () => {
  it('asks once for a view, and keeps its layout', () => {
    const cache = new LayoutCache();
    expect(cache.ask('a')).toEqual({ request: true });
    // Asked again before the answer: no second request.
    expect(cache.ask('a')).toEqual({ request: false });
    expect(cache.answer('a', fake('A'))).toBe(true);
    expect(cache.get('a')).toEqual(fake('A'));
    expect(cache.ask('a')).toEqual({ layout: fake('A') });
  });

  it('keeps a late answer for an older view, and never draws it', () => {
    const cache = new LayoutCache();
    cache.ask('a');
    cache.ask('b');
    // The answer for `a` arrives after `b` was asked: kept, not to be drawn.
    expect(cache.answer('a', fake('A'))).toBe(false);
    expect(cache.answer('b', fake('B'))).toBe(true);
    // Back to `a`: at once.
    expect(cache.ask('a')).toEqual({ layout: fake('A') });
    // A view asked again after a cached one is the latest again.
    cache.ask('c');
    cache.ask('a');
    expect(cache.answer('c', fake('C'))).toBe(false);
  });

  it('keeps the most recently used layouts only', () => {
    const cache = new LayoutCache(2);
    for (const key of ['a', 'b']) {
      cache.ask(key);
      cache.answer(key, fake(key));
    }
    cache.ask('a'); // used again: `b` is now the oldest
    cache.ask('c');
    cache.answer('c', fake('c'));
    expect(cache.get('a')).toEqual(fake('a'));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.ask('b')).toEqual({ request: true });
  });
});

/** A worker that answers only when told to, in any order. */
function fakeWorker() {
  const sent: LayoutMessage[] = [];
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const worker: LayoutWorker = {
    postMessage: (message) => sent.push(message),
    addEventListener: (type: string, listener: (event: never) => void) =>
      (listeners[type] ??= []).push(listener as (event: unknown) => void),
    terminate: () => undefined,
  };
  const emit = (type: string, event: unknown) => {
    for (const listener of listeners[type] ?? []) listener(event);
  };
  return {
    worker,
    sent,
    reply: (data: LayoutReply) => emit('message', { data }),
    fail: () => emit('error', new Event('error')),
  };
}

describe('workerLayouts', () => {
  const graph = golden('callers');

  it('sends the graph once, numbers requests and matches answers by number', async () => {
    const fakes = fakeWorker();
    const layouts = workerLayouts(graph, fakes.worker);
    const first = layouts.layout({});
    const second = layouts.layout({ context: false });
    expect(fakes.sent.map((m) => (m.type === 'layout' ? m.id : m.type))).toEqual(['graph', 1, 2]);
    // Answered out of order.
    fakes.reply({ id: 2, layout: fake('second') });
    fakes.reply({ id: 1, layout: fake('first') });
    expect(await first).toEqual(fake('first'));
    expect(await second).toEqual(fake('second'));
  });

  it('lays out on the main thread when the worker fails', async () => {
    const fakes = fakeWorker();
    const layouts = workerLayouts(graph, fakes.worker);
    const pending = layouts.layout({});
    fakes.fail();
    const expected = layoutFlow(graph);
    expect((await pending).nodes).toEqual(expected.nodes);
    // And from then on.
    expect((await layouts.layout({ context: false })).nodes).toEqual(
      layoutFlow(graph, { context: false }).nodes,
    );
    expect(fakes.sent).toHaveLength(2);
  });

  it('lays out on the main thread without a worker', async () => {
    const layouts = workerLayouts(graph, null);
    expect((await layouts.layout({})).edges).toEqual(layoutFlow(graph).edges);
  });
});
