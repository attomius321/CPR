import type { WorkspaceSummary } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { moves, transitionNotice } from '../src/workspaces/transitions.js';
import { allRows, workspaceGroups } from '../src/workspaces/workspaces.js';

// What the status bar says when an agent moves on while the person is elsewhere (V48), and how
// a card moves to its new place.
const summary = (
  branch: string,
  agent: WorkspaceSummary['agent'],
  over = {},
): WorkspaceSummary => ({
  branch,
  title: branch.split('/')[1],
  base: 'a'.repeat(40),
  created: '2026-10-25T10:00:00.000Z',
  planFirst: false,
  brief: 'B',
  worktree: { path: `/w/${branch}`, exists: true },
  tip: 'b'.repeat(40),
  ahead: 0,
  merged: false,
  agent,
  ...over,
});
const rows = (...workspaces: WorkspaceSummary[]) => allRows(workspaceGroups(workspaces, null));
const working = { state: 'working' as const, kind: 'claude' as const };

describe('transitionNotice (V48)', () => {
  it('says once that an agent now waits, what it asks, with a link to it', () => {
    const before = rows(summary('feature/store', working));
    const after = rows(
      summary(
        'feature/store',
        { state: 'needs-you', kind: 'claude', waitingFor: 'question' },
        {
          activity: {
            asks: {
              at: '2026-10-25T10:05:00.000Z',
              session: 's',
              kind: 'asks',
              tool: 'AskUserQuestion',
              questions: [{ question: 'Which store?', options: [] }],
            },
          },
        },
      ),
    );
    expect(transitionNotice(before, after, null)).toEqual({
      text: 'store waits for you: Asks: Which store?',
      href: '/?branch=feature%2Fstore',
    });
    // The same read again: nothing new to say.
    expect(transitionNotice(after, after, null)).toBeNull();
  });

  it('says an agent finished, or failed', () => {
    const before = rows(summary('feature/a', working), summary('feature/b', working));
    const after = rows(
      summary('feature/a', { state: 'ready', kind: 'claude' }, { ahead: 2 }),
      summary('feature/b', working),
    );
    expect(transitionNotice(before, after, null)?.text).toBe('a finished: Ready for review');
    const failed = rows(summary('feature/a', { state: 'failed', kind: 'codex', error: '401' }));
    expect(transitionNotice(rows(summary('feature/a', working)), failed, null)).toEqual({
      text: 'a stopped: Its agent failed: 401',
      href: '/?branch=feature%2Fa',
    });
  });

  it("says Hive's check and review ended, as a writer's turn (decision 698)", () => {
    const ready = { state: 'ready' as const, kind: 'claude' as const };
    const hive = { round: 1, rounds: 3 };
    const before = rows(
      summary('feature/h', ready, { ahead: 2, hive: { ...hive, step: 'checking' } }),
    );
    expect(before[0]?.next.group).toBe('hive');
    const after = rows(
      summary('feature/h', ready, { ahead: 2, hive: { ...hive, step: 'landing' } }),
    );
    expect(transitionNotice(before, after, null)?.text).toBe('h finished: Checked: land it');
  });

  it('nothing on the first read, for the workspace on screen, for a new one, or a stop asked', () => {
    const after = rows(summary('feature/a', { state: 'needs-you', kind: 'claude' }));
    expect(transitionNotice(null, after, null)).toBeNull();
    expect(transitionNotice(rows(summary('feature/a', working)), after, 'feature/a')).toBeNull();
    expect(transitionNotice([], after, null)).toBeNull();
    // Stopped by the person: they know.
    const stopped = rows(summary('feature/a', { state: 'stopped', kind: 'claude' }));
    expect(transitionNotice(rows(summary('feature/a', working)), stopped, null)).toBeNull();
  });

  it('several at once: the first, and how many more', () => {
    const before = rows(summary('feature/a', working), summary('feature/b', working));
    const after = rows(
      summary('feature/a', { state: 'needs-you', kind: 'claude', waitingFor: 'permission prompt' }),
      summary('feature/b', { state: 'needs-you', kind: 'claude', interrupted: true }),
    );
    expect(transitionNotice(before, after, null)?.text).toBe(
      'a waits for you: Waiting: permission prompt (and 1 more)',
    );
  });
});

describe('moves (V48)', () => {
  it('how far each card that stayed moved; a new card enters; one that did not move, nothing', () => {
    const before = new Map([
      ['a', 0],
      ['b', 64],
      ['c', 128],
    ]);
    const after = new Map([
      ['b', 0],
      ['a', 64],
      ['c', 128],
      ['d', 192],
    ]);
    expect(moves(before, after)).toEqual([
      { key: 'b', dy: 64 },
      { key: 'a', dy: -64 },
      { key: 'd', enter: true },
    ]);
    // The first layout: nothing moves, nothing enters.
    expect(moves(null, after)).toEqual([]);
  });
});
