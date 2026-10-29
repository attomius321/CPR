import type { PageAgentStateName, WorkspaceSummary } from '@symbiote/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readEvery,
  reloadWorkspaces,
  type WorkspacesState,
} from '../src/workspaces/useWorkspaces.js';

const state = (...agents: WorkspaceSummary['agent'][]): WorkspacesState => ({
  list: {
    workspaces: agents.map((agent) => ({ agent }) as WorkspaceSummary),
    place: 'repository',
  },
  reviews: null,
  merges: null,
  nucleus: null,
  scribe: null,
});

describe('readEvery', () => {
  it('reads again every 5 s after a read failed, until one answers (V48)', () => {
    expect(readEvery({ ...state({ state: 'ready' }), failing: true }, 0)).toBe(5_000);
    expect(readEvery(state({ state: 'ready' }), 0)).toBeNull();
  });

  it('reads the list again while an agent works or waits, and not once all are done', () => {
    expect(readEvery(state({ state: 'working' }, { state: 'ready' }), 0)).toBe(5_000);
    expect(readEvery(state({ state: 'needs-you' }), 0)).toBe(5_000);
    expect(readEvery(state({ state: 'plan-ready' }, { state: 'ready' }), 0)).toBeNull();
  });

  it('also while a terminal is open: what is typed there starts a turn (V27b)', () => {
    expect(readEvery(state({ state: 'plan-ready' }), 1)).toBe(5_000);
    expect(
      readEvery({ list: null, reviews: null, merges: null, nucleus: null, scribe: null }, 1),
    ).toBe(5_000);
  });

  it('also while Scout answers (V35) or waits on the person (V59)', () => {
    const done = state({ state: 'ready' });
    const nucleus = (state: PageAgentStateName): WorkspacesState => ({
      ...done,
      nucleus: {
        checkout: '/repo',
        agents: [],
        conversation: { kind: 'claude', started: '2026-10-22T09:00:00.000Z', state },
      },
    });
    expect(readEvery(nucleus('working'), 0)).toBe(5_000);
    // Its link is an amber band while it waits: read on, so the band goes once it does not.
    expect(readEvery(nucleus('needs-you'), 0)).toBe(5_000);
    expect(readEvery(nucleus('answered'), 0)).toBeNull();
  });

  it('also while Scribe writes (V41) or waits on the person (V59)', () => {
    const done = state({ state: 'ready' });
    const scribe = (state: PageAgentStateName): WorkspacesState => ({
      ...done,
      scribe: {
        checkout: '/repo',
        agents: [],
        conversation: { kind: 'claude', started: '2026-10-23T09:00:00.000Z', state },
      },
    });
    expect(readEvery(scribe('working'), 0)).toBe(5_000);
    expect(readEvery(scribe('needs-you'), 0)).toBe(5_000);
    expect(readEvery(scribe('answered'), 0)).toBeNull();
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
    // The workspaces, the reviews, the merges, Nucleus (V35) and Scribe (V41).
    expect(server.asked).toHaveLength(5);
    // Land is clicked while the page's first read is under way; what follows it reads again.
    let landed = false;
    const after = reloadWorkspaces().then(() => (landed = true));
    server.answer();
    await opened;
    await vi.waitFor(() => expect(server.asked).toHaveLength(10));
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
    await vi.waitFor(() => expect(server.asked).toHaveLength(10));
    server.answer();
    await Promise.all([second, third]);
    expect(server.asked).toHaveLength(10);
  });
});
