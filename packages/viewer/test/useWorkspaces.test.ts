import type { WorkspaceSummary } from '@cpr/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEvery, reloadWorkspaces, type WorkspacesState } from '../src/useWorkspaces.js';

const state = (...agents: WorkspaceSummary['agent'][]): WorkspacesState => ({
  list: {
    workspaces: agents.map((agent) => ({ agent }) as WorkspaceSummary),
    place: 'repository',
  },
  reviews: null,
  merges: null,
});

describe('readEvery', () => {
  it('reads the list again while an agent works or waits, and not once all are done', () => {
    expect(readEvery(state({ state: 'working' }, { state: 'ready' }), 0)).toBe(5_000);
    expect(readEvery(state({ state: 'needs-you' }), 0)).toBe(5_000);
    expect(readEvery(state({ state: 'plan-ready' }, { state: 'ready' }), 0)).toBeNull();
  });

  it('also while a terminal is open: what is typed there starts a turn (V27b)', () => {
    expect(readEvery(state({ state: 'plan-ready' }), 1)).toBe(5_000);
    expect(readEvery({ list: null, reviews: null, merges: null }, 1)).toBe(5_000);
  });
});

describe('reloadWorkspaces (V29b)', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A fake `fetch`: each request waits until `answer()`; what was asked, in order. */
  function fakeServer() {
    const asked: string[] = [];
    const waiting: (() => void)[] = [];
    vi.stubGlobal('fetch', (path: string) => {
      asked.push(path);
      return new Promise((resolve) =>
        waiting.push(() => resolve({ ok: true, json: () => Promise.resolve({ merges: [] }) })),
      );
    });
    const answer = () => {
      for (const go of waiting.splice(0)) go();
    };
    return { asked, answer };
  }

  it('asked during a read, reads again after it: a change made meanwhile is not answered by the older read', async () => {
    const server = fakeServer();
    const opened = reloadWorkspaces();
    expect(server.asked).toHaveLength(3);
    // Land is clicked while the page's first read is under way; what follows it reads again.
    let landed = false;
    const after = reloadWorkspaces().then(() => (landed = true));
    server.answer();
    await opened;
    await vi.waitFor(() => expect(server.asked).toHaveLength(6));
    expect(landed).toBe(false);
    server.answer();
    await after;
    expect(landed).toBe(true);
  });

  it('callers during one read share the one read after it', async () => {
    const server = fakeServer();
    const first = reloadWorkspaces();
    const second = reloadWorkspaces();
    const third = reloadWorkspaces();
    server.answer();
    await first;
    await vi.waitFor(() => expect(server.asked).toHaveLength(6));
    server.answer();
    await Promise.all([second, third]);
    expect(server.asked).toHaveLength(6);
  });
});
