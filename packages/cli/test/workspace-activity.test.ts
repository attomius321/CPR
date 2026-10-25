import type { ActivityEntry, ThreadEntry, WorkspaceAgentState } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import type { CodexThread, CodexTurn } from '../src/app-server.js';
import { serverTools } from '../src/codex.js';
import { activityOf, doingOf, serverActivity } from '../src/workspace-activity.js';

// What the list says of a workspace's agent (V48): since when its state holds, what it asks, its
// last report; with V48f, the tool it runs.
const at = (minute: number) => `2026-10-25T10:${String(minute).padStart(2, '0')}:00.000Z`;
const entry = (minute: number, rest: Record<string, unknown>): ThreadEntry =>
  ({ at: at(minute), session: 's1', ...rest }) as ThreadEntry;
const agent = (state: WorkspaceAgentState['state'], over: Partial<WorkspaceAgentState> = {}) =>
  ({ state, kind: 'claude', ...over }) as WorkspaceAgentState;

const thread: ThreadEntry[] = [
  entry(0, { kind: 'start', source: 'startup' }),
  entry(0, { kind: 'prompt', text: "Symbiote's prompt" }),
  entry(4, { kind: 'report', text: '# The plan\n\n1. Store sessions' }),
  entry(10, { kind: 'prompt', text: 'Go' }),
  entry(12, { kind: 'asks', tool: 'Bash', input: '{"command":"pnpm test"}' }),
];

describe('activityOf (V48)', () => {
  it('while it works: since its turn began, its last report kept', () => {
    expect(activityOf(thread.slice(0, 4), agent('working'))).toEqual({
      since: at(10),
      report: { at: at(4), text: '# The plan' },
    });
  });

  it("while it waits: since its ask, and the ask; an earlier turn's ask is not it", () => {
    expect(activityOf(thread, agent('needs-you', { waitingFor: 'permission prompt' }))).toEqual({
      since: at(12),
      asks: thread[4],
      report: { at: at(4), text: '# The plan' },
    });
    const later = [
      ...thread,
      entry(13, { kind: 'report', text: 'Done' }),
      entry(15, { kind: 'prompt', text: 'More' }),
    ];
    expect(activityOf(later, agent('needs-you', { interrupted: true }))).toEqual({
      report: { at: at(13), text: 'Done' },
    });
  });

  it('finished: since its last report; stopped or failed: since its end', () => {
    expect(activityOf(thread.slice(0, 3), agent('plan-ready'))).toEqual({
      since: at(4),
      report: { at: at(4), text: '# The plan' },
    });
    const ended = [...thread, entry(20, { kind: 'end', reason: 'other' })];
    expect(activityOf(ended, agent('stopped'))?.since).toBe(at(20));
    expect(activityOf(ended, agent('failed'))?.since).toBe(at(20));
    expect(activityOf(thread, agent('stopped'))?.since).toBeUndefined();
  });

  it('a report is cut to its first line, at most 200 characters', () => {
    const long = [entry(1, { kind: 'report', text: `\n\n${'a'.repeat(300)}\nmore` })];
    expect(activityOf(long, agent('done'))?.report?.text).toBe('a'.repeat(200));
  });

  it('nothing recorded (a thread before V18c, no agent): nothing', () => {
    expect(activityOf([], agent('working'))).toBeUndefined();
    expect(activityOf([], agent('no-agent'))).toBeUndefined();
  });

  it('with its tools recorded (V48f): what runs while it works, never otherwise', () => {
    const tools: ActivityEntry[] = [
      { at: at(11), session: 's1', id: 'a', tool: 'Read', subject: 'src/a.ts', phase: 'start' },
      { at: at(11), session: 's1', id: 'a', tool: 'Read', subject: 'src/a.ts', phase: 'end' },
      { at: at(12), session: 's1', id: 'b', tool: 'Bash', subject: 'pnpm test', phase: 'start' },
    ];
    expect(activityOf(thread.slice(0, 4), agent('working'), tools)?.doing).toEqual({
      tool: 'Bash',
      subject: 'pnpm test',
    });
    expect(activityOf(thread, agent('needs-you'), tools)?.doing).toBeUndefined();
    // Not recorded: no word of what it does.
    expect(activityOf(thread.slice(0, 4), agent('working'), null)?.doing).toBeUndefined();
  });
});

describe('doingOf (V48f)', () => {
  const tool = (
    minute: number,
    id: string,
    phase: 'start' | 'end',
    name = 'Bash',
    over: Partial<ActivityEntry> = {},
  ): ActivityEntry => ({ at: at(minute), session: 's1', id, tool: name, phase, ...over });

  it('the newest tool started and not ended', () => {
    expect(doingOf([tool(1, 'a', 'start', 'Read', { subject: 'x.ts' })], at(0))).toEqual({
      tool: 'Read',
      subject: 'x.ts',
    });
  });

  it('an end written before its start (two async hooks) still closes it', () => {
    expect(doingOf([tool(2, 'a', 'end'), tool(2, 'a', 'start')], at(0))).toEqual({
      thinking: true,
    });
  });

  it('tools run side by side: one still running is what it does', () => {
    const tools = [
      tool(1, 'a', 'start', 'Read'),
      tool(1, 'b', 'start', 'Grep'),
      tool(2, 'b', 'end', 'Grep'),
    ];
    expect(doingOf(tools, at(0))).toEqual({ tool: 'Read' });
  });

  it("a tool of an earlier turn, never ended (an interrupt), is not this turn's", () => {
    expect(doingOf([tool(1, 'a', 'start')], at(5))).toEqual({ thinking: true });
  });

  it("Codex's reasoning running is thinking", () => {
    expect(doingOf([tool(1, 'r', 'start', 'reasoning')], at(0))).toEqual({ thinking: true });
  });
});

describe('serverActivity (V48, Codex on its app server)', () => {
  const t0 = Date.parse(at(0)) / 1000;
  const iso = (minutes: number) => new Date((t0 + minutes * 60) * 1000).toISOString();
  const turn = (over: Partial<CodexTurn>): CodexTurn => ({
    id: 't',
    status: 'completed',
    startedAt: t0,
    completedAt: t0 + 60,
    prompts: ['P'],
    ...over,
  });
  const read = (over: Partial<CodexThread>): CodexThread => ({
    id: 'th',
    createdAt: t0,
    updatedAt: t0 + 300,
    status: 'idle',
    turns: [],
    ...over,
  });
  const codex = (state: WorkspaceAgentState['state']) => agent(state, { kind: 'codex' });

  it('working: since its turn began; what runs from its items', () => {
    const running = read({
      status: 'active',
      turns: [
        turn({ report: 'First', final: true }),
        turn({
          id: 'u',
          status: 'inProgress',
          startedAt: t0 + 120,
          completedAt: undefined,
          items: [
            { id: 'i1', kind: 'command', subject: 'ls', status: 'completed' },
            { id: 'i2', kind: 'command', subject: 'cargo test', status: 'inProgress' },
          ],
        }),
      ],
    });
    expect(serverActivity(running, codex('working'), '/w')).toEqual({
      since: iso(2),
      report: { at: iso(1), text: 'First' },
      doing: { tool: 'command', subject: 'cargo test' },
    });
  });

  it('read without its items: no word of what it does', () => {
    const running = read({
      status: 'active',
      turns: [turn({ status: 'inProgress', completedAt: undefined })],
    });
    expect(serverActivity(running, codex('working'), '/w')?.doing).toBeUndefined();
  });

  it('waiting: since the thread last changed, with what it said', () => {
    const waiting = read({
      status: 'active',
      waiting: 'approval',
      turns: [turn({ status: 'inProgress', completedAt: undefined, report: 'May I?' })],
    });
    expect(serverActivity(waiting, codex('needs-you'), '/w')).toEqual({
      since: iso(5),
      report: { at: iso(5), text: 'May I?' },
    });
  });
});

describe('serverTools (V48f)', () => {
  const t0 = Date.parse(at(0)) / 1000;
  it("a turn's items as activity lines, in its order, at its start, untimed", () => {
    const tools = serverTools(
      {
        id: 't',
        status: 'inProgress',
        startedAt: t0,
        prompts: ['P'],
        items: [
          { id: 'r', kind: 'reasoning' },
          // No status (a web search): ended unless it is the running turn's last.
          { id: 'w', kind: 'webSearch', subject: 'tokio' },
          { id: 'c', kind: 'command', subject: 'cargo test', status: 'failed', failed: true },
          {
            id: 'f',
            kind: 'fileChange',
            subject: '/w/src/lib.rs, /elsewhere/x.rs',
            status: 'completed',
          },
          { id: 'm', kind: 'command', subject: 'ls', status: 'inProgress' },
        ],
      },
      'th',
      '/w',
    );
    const base = { at: at(0), session: 'th', untimed: true };
    expect(tools).toEqual([
      { ...base, id: 'r', tool: 'reasoning', phase: 'start' },
      { ...base, id: 'r', tool: 'reasoning', phase: 'end' },
      { ...base, id: 'w', tool: 'webSearch', subject: 'tokio', phase: 'start' },
      { ...base, id: 'w', tool: 'webSearch', subject: 'tokio', phase: 'end' },
      { ...base, id: 'c', tool: 'command', subject: 'cargo test', phase: 'start' },
      { ...base, id: 'c', tool: 'command', subject: 'cargo test', phase: 'end', failed: true },
      {
        ...base,
        id: 'f',
        tool: 'fileChange',
        subject: 'src/lib.rs, /elsewhere/x.rs',
        phase: 'start',
      },
      {
        ...base,
        id: 'f',
        tool: 'fileChange',
        subject: 'src/lib.rs, /elsewhere/x.rs',
        phase: 'end',
      },
      { ...base, id: 'm', tool: 'command', subject: 'ls', phase: 'start' },
    ]);
  });
});
