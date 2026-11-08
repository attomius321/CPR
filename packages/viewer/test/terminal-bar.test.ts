import type { ThreadEntry, WorkspaceSummary } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { workspaceNext } from '../src/workspaces/workspaces.js';
import { barOf } from '../src/workspaces/terminal-bar.js';

// V89 (decisions 828, 829): the bar under the terminal says what waits in the agent's own words,
// and only keys measured to answer it; or what it does, or who drives.
const summary = (over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  branch: 'feature/cart',
  base: 'a'.repeat(40),
  from: 'main',
  created: '2026-10-15T09:00:00.000Z',
  planFirst: false,
  brief: 'Save a cart',
  worktree: { path: '/work/app.worktrees/feature-cart', exists: true, changed: 0 },
  tip: 'b'.repeat(40),
  ahead: 0,
  merged: false,
  agent: { state: 'working', kind: 'claude', id: 's1' },
  ...over,
});
const bar = (workspace: WorkspaceSummary, entries: ThreadEntry[] = []) =>
  barOf({ workspace, next: workspaceNext(workspace), entries });

const SINCE = '2026-10-15T09:10:00.000Z';
const ASKS: Extract<ThreadEntry, { kind: 'asks' }> = {
  at: SINCE,
  session: 's',
  kind: 'asks',
  tool: 'Bash',
  input: JSON.stringify({ command: 'npm install pg' }),
};
const waiting = (over: Partial<WorkspaceSummary> = {}) =>
  summary({
    agent: { state: 'needs-you', kind: 'claude', id: 's1', waitingFor: 'permission prompt' },
    activity: { since: SINCE, asks: ASKS },
    ...over,
  });
const notice = (at: string, message: string): ThreadEntry => ({
  at,
  session: 's',
  kind: 'notice',
  type: 'permission_prompt',
  message,
});

describe('the bar under the terminal (V89)', () => {
  it("a permission: Claude Code's own words, since when, and Enter and Esc", () => {
    const model = bar(waiting(), [
      notice('2026-10-15T09:00:00.000Z', 'Claude needs your permission to use Read'),
      notice('2026-10-15T09:10:01.000Z', 'Claude needs your permission to use Bash'),
    ]);
    expect(model).toMatchObject({
      tone: 'you',
      text: 'Claude needs your permission to use Bash',
      since: SINCE,
    });
    expect(model.keys).toEqual([
      { keys: ['Enter'], what: 'allows it' },
      { keys: ['Esc'], what: 'says no and ends its turn' },
    ]);
  });

  it('no notice since the wait began: what it asked, else what it waits for', () => {
    const old = [notice('2026-10-15T09:00:00.000Z', 'Claude needs your permission to use Read')];
    expect(bar(waiting(), old).text).toBe('Permission to run npm install pg');
    const bare = waiting({ activity: { since: SINCE } });
    expect(bar(bare).text).toBe('Waiting: permission prompt');
    expect(bar(bare).keys).toEqual([]);
  });

  it('a question: it and its options as words, no keys (not measured)', () => {
    const question = waiting({
      agent: { state: 'needs-you', kind: 'claude', id: 's1', waitingFor: 'question' },
      activity: {
        since: SINCE,
        asks: {
          at: SINCE,
          session: 's',
          kind: 'asks',
          tool: 'AskUserQuestion',
          questions: [{ question: 'Which store?', options: ['Postgres', 'SQLite'] }],
        },
      },
    });
    const model = bar(question);
    expect(model.tone).toBe('you');
    expect(model.text).toBe('Asks: Which store? — Postgres · SQLite');
    expect(model.keys).toEqual([]);
    expect(model.note).toBe('Answer in its terminal');
  });

  it('Codex waiting: its words, no keys', () => {
    const codex = waiting({
      agent: { state: 'needs-you', kind: 'codex', id: 't1', waitingFor: 'approval prompt' },
      activity: { since: SINCE },
    });
    expect(bar(codex)).toMatchObject({ text: 'Waiting: approval prompt', keys: [] });
  });

  it('interrupted: it waits at its prompt, no keys', () => {
    const model = bar(
      summary({ agent: { state: 'needs-you', kind: 'claude', id: 's1', interrupted: true } }),
    );
    expect(model).toMatchObject({ tone: 'you', text: 'Interrupted: it waits at its prompt' });
    expect(model.keys).toEqual([]);
  });

  it("a plan ready: it waits for the person's OK", () => {
    const model = bar(
      summary({ planFirst: true, agent: { state: 'plan-ready', kind: 'claude', id: 's1' } }),
    );
    expect(model).toMatchObject({ tone: 'you', text: 'The plan waits for your OK', plan: true });
  });

  it("working: what it does, and Symbiote's own keys", () => {
    const model = bar(
      summary({ activity: { since: SINCE, doing: { tool: 'Bash', subject: 'npm test' } } }),
    );
    expect(model).toMatchObject({
      tone: 'run',
      text: 'Claude Code is working',
      detail: 'Running npm test',
      since: SINCE,
      keys: [],
      terminalKeys: true,
    });
  });

  it('failed: red, its words, and where to read why', () => {
    const model = bar(
      summary({ agent: { state: 'failed', kind: 'claude', id: 's1', error: 'Out of credit' } }),
    );
    expect(model).toMatchObject({
      tone: 'error',
      text: 'Its agent failed: Out of credit',
      thread: true,
    });
  });

  it('stopped, to review, merged: what the sidenav says', () => {
    expect(bar(summary({ agent: { state: 'stopped', kind: 'claude', id: 's1' } }))).toMatchObject({
      tone: 'idle',
      text: 'Stopped',
    });
    expect(
      bar(summary({ ahead: 1, agent: { state: 'ready', kind: 'claude', id: 's1' } })),
    ).toMatchObject({ tone: 'you', text: 'Ready for review' });
    expect(bar(summary({ merged: true }))).toMatchObject({ tone: 'ok', text: 'Merged' });
  });

  it('Hive drives the writer: who drives, and that typing reaches it too', () => {
    const model = bar(summary({ hive: { step: 'writing', round: 1, rounds: 3 } }));
    expect(model).toMatchObject({
      tone: 'hive',
      text: 'Hive drives this writer',
      detail:
        "it answers the writer's questions and sends it what the check and the reviewer found",
      note: 'What you type reaches the writer too, recorded as yours',
      keys: [],
    });
    const checking = bar(
      summary({
        hive: {
          step: 'checking',
          round: 1,
          rounds: 3,
          live: {
            kind: 'check',
            started: SINCE,
            commands: ['pnpm test'],
            step: 0,
            since: SINCE,
            done: [],
          },
        },
      }),
    );
    expect(checking).toMatchObject({ tone: 'hive', hiveLive: true });
    // HV5: its next start held for usage: the pause in Hive's words, not who drives.
    const paused = bar(
      summary({
        agent: { state: 'done', kind: 'claude', id: 's1' },
        hive: {
          step: 'writing',
          round: 1,
          rounds: 3,
          pause: { reason: 'usage', pauseAt: 90, percent: 95, minutes: 300, since: SINCE },
        },
      }),
    );
    expect(paused.tone).toBe('info');
    expect(paused.text).toMatch(/^Paused: usage 95 %/);
    const stuck = bar(
      summary({ hive: { step: 'stuck', round: 3, rounds: 3, note: '3 rounds failed the check' } }),
    );
    expect(stuck).toMatchObject({ tone: 'error', text: 'Stopped: 3 rounds failed the check' });
  });
});
