import type { McpAsk, MergeEntry, PageAgentState, WorkspaceSummary } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { waitingCount, whatWaits } from '../src/shell/waiting.js';

const summary = (branch: string, agent: WorkspaceSummary['agent']): WorkspaceSummary => ({
  branch,
  base: 'a'.repeat(40),
  from: 'main',
  created: '2026-10-27T09:00:00.000Z',
  planFirst: true,
  brief: 'Export a review as CSV',
  worktree: { path: `/work/${branch}`, exists: true, changed: 0 },
  tip: 'b'.repeat(40),
  ahead: 0,
  merged: false,
  agent,
});
const merge = (state: MergeEntry['state']): MergeEntry => ({
  id: `m-${state}`,
  branch: 'feature/csv',
  head: 'c'.repeat(40),
  into: 'main',
  title: 'Merge feature/csv: CSV',
  state,
  queued: '2026-10-27T12:00:00.000Z',
  updated: '2026-10-27T12:00:00.000Z',
});
const page = (state: 'working' | 'needs-you' | 'answered' | null): PageAgentState => ({
  checkout: '/work/app',
  agents: [],
  conversation: state ? { kind: 'claude', state, started: '2026-10-27T12:00:00.000Z' } : null,
});
const ask = (by: McpAsk['by']): McpAsk => ({
  id: `a-${by.via}`,
  tool: 'queue_merge',
  words: 'Merge fix/a at bbbbbbb into main',
  by,
  at: '2026-10-27T12:00:00.000Z',
  until: '2026-10-27T12:10:00.000Z',
});

const nothing = { list: null, reviews: null, merges: null, nucleus: null, scribe: null };

describe('what waits for the person (N2)', () => {
  it('nothing, before anything is read', () => {
    expect(whatWaits(nothing, [])).toEqual({
      workspaces: 0,
      merges: 0,
      nucleus: false,
      scribe: false,
      asks: 0,
    });
    expect(waitingCount(whatWaits(nothing, []))).toBe(0);
  });

  it('the workspaces in Waiting for you: a question, a permission, a plan to read', () => {
    const list = {
      place: 'repository' as const,
      workspaces: [
        summary('feature/a', { state: 'needs-you', kind: 'claude', waitingFor: 'permission' }),
        summary('feature/b', { state: 'plan-ready', kind: 'claude' }),
        summary('feature/c', { state: 'working', kind: 'claude' }),
        summary('feature/d', { state: 'failed', kind: 'claude', error: 'gone' }),
      ],
    };
    const waiting = whatWaits({ ...nothing, list }, []);
    expect(waiting.workspaces).toBe(2);
    expect(waitingCount(waiting)).toBe(2);
  });

  it('the merges that need the person, not those at work, ready or landed', () => {
    const merges = {
      merges: (['needs-you', 'queued', 'merging', 'ready', 'landed', 'failed'] as const).map(merge),
    };
    expect(whatWaits({ ...nothing, merges }, []).merges).toBe(1);
  });

  it('Nucleus by its ask or a dialog in its terminal, once; Scribe by its dialog', () => {
    expect(whatWaits({ ...nothing, nucleus: page('needs-you') }, []).nucleus).toBe(true);
    expect(whatWaits({ ...nothing, nucleus: page('working') }, []).nucleus).toBe(false);
    const nucleusAsks = [ask({ via: 'nucleus' })];
    expect(whatWaits({ ...nothing, nucleus: page('working') }, nucleusAsks)).toMatchObject({
      nucleus: true,
      asks: 0,
    });
    expect(waitingCount(whatWaits({ ...nothing, nucleus: page('needs-you') }, nucleusAsks))).toBe(
      1,
    );
    expect(whatWaits({ ...nothing, scribe: page('needs-you') }, []).scribe).toBe(true);
    expect(whatWaits({ ...nothing, scribe: page('answered') }, []).scribe).toBe(false);
  });

  it("each agent's ask through symbiote mcp", () => {
    const asks = [
      ask({ via: 'mcp', client: 'claude-code', folder: '/work/a' }),
      { ...ask({ via: 'mcp' }), id: 'a2' },
    ];
    expect(whatWaits(nothing, asks).asks).toBe(2);
  });

  it('all of it, in one count: what the title and the icon say', () => {
    const list = {
      place: 'repository' as const,
      workspaces: [summary('feature/a', { state: 'needs-you', kind: 'claude' })],
    };
    const waiting = whatWaits(
      {
        list,
        reviews: null,
        merges: { merges: [merge('needs-you')] },
        nucleus: page('needs-you'),
        scribe: page('needs-you'),
      },
      [ask({ via: 'mcp' })],
    );
    expect(waitingCount(waiting)).toBe(5);
  });
});
