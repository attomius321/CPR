import type { WorkspaceSummary } from '@cpr/core';
import { describe, expect, it } from 'vitest';
import { readEvery, type WorkspacesState } from '../src/useWorkspaces.js';

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
