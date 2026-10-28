// The Activity tab's words (V73): durations, an event's line, a group's status and summary parts.
import { describe, expect, it } from 'vitest';
import type { ActivityEvent, ToolCall } from '../src/workspaces/activity/events.js';
import type { ActivityGroup } from '../src/workspaces/activity/groups.js';
import {
  durationText,
  elapsedText,
  eventWords,
  statusWords,
  summaryParts,
} from '../src/workspaces/activity/words.js';

const W = '/home/ada/app.worktrees/feature-x';
const call = (over: Partial<ToolCall>): ActivityEvent => ({
  key: `call:${over.id ?? 'x'}`,
  kind: 'call',
  call: { id: 'x', tool: 'Bash', session: 's', failed: false, ...over },
});
const group = (over: Partial<ActivityGroup>): ActivityGroup => ({
  key: 'k',
  kind: 'test',
  milestone: false,
  title: 'Testing',
  status: 'done',
  failures: 0,
  events: [],
  ...over,
});

describe('durationText and elapsedText (V73)', () => {
  it('says a duration briefly, in its scale', () => {
    expect(durationText(480)).toBe('480 ms');
    expect(durationText(4_210)).toBe('4.2 s');
    expect(durationText(42_400)).toBe('42 s');
    expect(durationText(132_000)).toBe('2m 12s');
    expect(durationText(3_725_000)).toBe('1h 2m');
  });

  it('says an elapsed time as a clock: minutes and seconds, hours when there are any', () => {
    expect(elapsedText(42_000)).toBe('0:42');
    expect(elapsedText(723_000)).toBe('12:03');
    expect(elapsedText(3_723_000)).toBe('1:02:03');
    expect(elapsedText(-5)).toBe('0:00');
  });
});

describe('eventWords (V73)', () => {
  it("a command by the agent's words, its command short beside them; else the command", () => {
    expect(
      eventWords(call({ about: 'Run the full check', input: `cd ${W} && pnpm check` }), W),
    ).toEqual({ text: 'Run the full check', code: 'pnpm check' });
    expect(eventWords(call({ subject: `cd ${W}; ls\nsecond` }), W)).toEqual({ code: 'ls' });
    expect(eventWords(call({}), W)).toEqual({ text: 'Ran a command' });
  });

  it('a file by its path from the worktree, a search by its pattern', () => {
    expect(eventWords(call({ tool: 'Read', subject: 'src/a.ts' }), W)).toEqual({
      text: 'Read',
      path: 'src/a.ts',
    });
    expect(
      eventWords(call({ tool: 'Edit', subject: 'src/a.ts', added: 3, removed: 1 }), W),
    ).toEqual({ text: 'Edited', path: 'src/a.ts' });
    expect(eventWords(call({ tool: 'Read', subject: '/home/ada/.claude/a.png' }), W)).toEqual({
      text: 'Read',
      path: '~/.claude/a.png',
    });
    expect(eventWords(call({ tool: 'Grep', subject: 'parseToken' }), W)).toEqual({
      text: 'Searched for',
      code: 'parseToken',
    });
    expect(eventWords(call({ tool: 'mcp__symbiote__review' }), W)).toEqual({
      text: 'Used symbiote · review',
    });
    expect(eventWords(call({ tool: 'Mystery' }), W)).toEqual({ text: 'Used Mystery' });
  });

  it('a task by its subject; a commit by its subject and short SHA', () => {
    expect(eventWords(call({ tool: 'TaskCreate', task: { subject: 'Write tests' } }), W)).toEqual({
      text: 'Added a task: Write tests',
    });
    expect(
      eventWords(call({ tool: 'TaskUpdate', task: { id: '3', status: 'completed' } }), W),
    ).toEqual({ text: 'Task 3 completed' });
    const commit: ActivityEvent = {
      key: 'commit:abc',
      kind: 'commit',
      at: '2026-10-28T09:00:00.000Z',
      commit: {
        sha: 'abcdef1234',
        subject: 'Add half',
        author: 'Ada',
        date: '2026-10-28T09:00:00Z',
      },
    };
    expect(eventWords(commit, W)).toEqual({ text: 'Add half', code: 'abcdef1' });
  });
});

describe('statusWords and summaryParts (V73)', () => {
  it('says a status only when it is news: running, failed, stopped, waiting, no end; a test passed', () => {
    expect(statusWords(group({ status: 'running' }))).toEqual({ text: 'Running', tone: 'info' });
    expect(statusWords(group({ status: 'failed' }))).toEqual({ text: 'Failed', tone: 'error' });
    expect(statusWords(group({ status: 'recovered' }))).toEqual({ text: 'Passed', tone: 'added' });
    expect(statusWords(group({ status: 'done' }))).toEqual({ text: 'Passed', tone: 'added' });
    expect(statusWords(group({ kind: 'implement', status: 'done' }))).toBeNull();
    expect(statusWords(group({ kind: 'explore', status: 'cancelled' }))).toEqual({
      text: 'Stopped',
      tone: 'muted',
    });
    expect(statusWords(group({ kind: 'asks', status: 'waiting' }))).toEqual({
      text: 'Waiting for you',
      tone: 'warning',
    });
    expect(statusWords(group({ kind: 'explore', status: 'open' }))).toEqual({
      text: 'No end recorded',
      tone: 'muted',
    });
  });

  it("a summary's parts, each in its tone: a test's command as code, counts and lines in colour", () => {
    expect(summaryParts(group({ summary: 'pnpm check · 1 failed · 41 passed (exit 1)' }))).toEqual([
      { text: 'pnpm check', code: true },
      { text: '1 failed', tone: 'error' },
      { text: '41 passed (exit 1)', tone: 'added' },
    ]);
    expect(summaryParts(group({ kind: 'implement', summary: '3 files · +40 −2' }))).toEqual([
      { text: '3 files' },
      { text: '', lines: { added: '+40', removed: '−2' } },
    ]);
    expect(summaryParts(group({ kind: 'implement' }))).toEqual([]);
  });
});
