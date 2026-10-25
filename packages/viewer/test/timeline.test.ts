import type {
  ActivityEntry,
  ThreadEntry,
  WorkspaceCommit,
  WorkspaceSummary,
  WorkspaceThread,
} from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { timelineItems } from '../src/workspaces/timeline.js';

// A workspace's Activity tab (V48c): what happened, in time order, from the records Symbiote has.
const W = '/work/app.worktrees/feature-csv';
const at = (minute: number, second = 0) =>
  `2026-10-25T10:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;
const workspace = (over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  branch: 'feature/csv',
  base: '94e1feb035b5ac6be30634c0be244e505778ab23',
  from: 'main',
  created: at(0),
  planFirst: true,
  brief: 'Export a review as CSV',
  worktree: { path: W, exists: true },
  tip: 'b'.repeat(40),
  ahead: 1,
  merged: false,
  agent: { state: 'working', kind: 'claude' },
  ...over,
});
const entry = (minute: number, rest: Record<string, unknown>): ThreadEntry =>
  ({ at: at(minute), session: 's1', ...rest }) as ThreadEntry;
const tool = (
  minute: number,
  second: number,
  id: string,
  name: string,
  phase: 'start' | 'end',
  over: Partial<ActivityEntry> = {},
): ActivityEntry => ({ at: at(minute, second), session: 's1', id, tool: name, phase, ...over });
const thread = (
  entries: ThreadEntry[],
  tools?: ActivityEntry[],
  verdict?: WorkspaceThread['verdict'],
): WorkspaceThread => ({
  entries,
  recorded: true,
  ...(tools ? { tools } : {}),
  ...(verdict ? { verdict } : {}),
});
const shown = (items: ReturnType<typeof timelineItems>) =>
  items.map(({ kind, text, at: when }) => [kind, text, when ?? null]);

describe('timelineItems (V48c)', () => {
  it("merges the thread, the agent's tools, the commits and the verdict, in time order", () => {
    const entries = [
      entry(0, { kind: 'start', source: 'startup' }),
      entry(0, { kind: 'prompt', text: "Symbiote's prompt\n\nThe brief" }),
      entry(4, { kind: 'report', text: '# The plan\n\n1. Tests' }),
      entry(5, { kind: 'prompt', text: 'Go ahead\nand test it' }),
      entry(7, { kind: 'asks', tool: 'Bash', input: '{"command":"pnpm test"}' }),
      entry(9, { kind: 'end', reason: 'other' }),
    ];
    const tools = [
      tool(1, 0, 'r1', 'Read', 'start', { subject: 'src/a.ts' }),
      tool(1, 1, 'r1', 'Read', 'end', { subject: 'src/a.ts' }),
      tool(1, 2, 'g1', 'Grep', 'start', { subject: 'parse' }),
      tool(1, 3, 'r2', 'Read', 'start', { subject: 'src/b.ts' }),
      tool(6, 0, 'e1', 'Edit', 'start', { subject: 'src/a.ts' }),
      tool(6, 1, 'e2', 'Write', 'start', { subject: 'src/b.ts' }),
      tool(6, 2, 'e3', 'Edit', 'start', { subject: 'src/a.ts' }),
      // Its start, then the permission it asked for it.
      tool(6, 50, 'b1', 'Bash', 'start', { subject: 'pnpm test' }),
      tool(8, 0, 'b1', 'Bash', 'end', { subject: 'pnpm test', failed: true }),
    ];
    const commits: WorkspaceCommit[] = [
      { sha: 'c'.repeat(40), subject: 'Add the export', author: 'agent', date: at(8, 30) },
    ];
    const verdict = {
      at: at(10),
      event: 'request-changes' as const,
      head: 'c'.repeat(40),
      text: '',
    };
    expect(shown(timelineItems(workspace(), thread(entries, tools, verdict), commits))).toEqual([
      ['made', 'Workspace made from main at 94e1feb', at(0)],
      ['start', 'Claude Code started', at(0)],
      ['prompt', "Symbiote's prompt", at(0)],
      ['reads', 'Read 2 files · searched once', at(1)],
      ['report', 'Reported: # The plan', at(4)],
      ['message', 'You: Go ahead', at(5)],
      ['edits', 'Edited src/a.ts, src/b.ts', at(6)],
      ['command', 'Ran pnpm test', at(6, 50)],
      ['asks', 'Asked for permission to run pnpm test', at(7)],
      ['commit', 'Committed ccccccc: Add the export', at(8, 30)],
      ['end', 'Its session ended', at(9)],
      ['verdict', 'Review: Changes requested', at(10)],
    ]);
  });

  it('keeps what a row opens to: a prompt, a message, a report; marks a failed command', () => {
    const items = timelineItems(
      workspace(),
      thread(
        [
          entry(0, { kind: 'prompt', text: 'P\nmore' }),
          entry(1, { kind: 'report', text: 'Done.' }),
          entry(2, { kind: 'prompt', text: 'One line' }),
        ],
        [
          tool(3, 0, 'b', 'Bash', 'start', { subject: 'ls' }),
          tool(3, 1, 'b', 'Bash', 'end', { failed: true }),
        ],
      ),
      null,
    );
    expect(items.map((i) => [i.kind, i.detail ?? null, i.failed ?? null])).toEqual([
      ['made', null, null],
      ['prompt', 'P\nmore', null],
      ['report', 'Done.', null],
      ['message', null, null],
      ['command', null, true],
    ]);
  });

  it("says each start, question and end in the agent's words", () => {
    const items = timelineItems(
      workspace({ agent: { state: 'failed', kind: 'codex' }, from: undefined }),
      thread([
        entry(0, { kind: 'start', source: 'startup' }),
        entry(1, {
          kind: 'asks',
          tool: 'AskUserQuestion',
          questions: [{ question: 'Q?', options: ['A', 'B'] }],
        }),
        entry(2, { kind: 'end', reason: 'completed' }),
        entry(3, { kind: 'start', source: 'resume' }),
        entry(4, { kind: 'end', reason: 'stopped' }),
        entry(5, { kind: 'start', source: 'resume' }),
        entry(6, { kind: 'end', reason: 'unexpected status 401\nmore' }),
        entry(7, { kind: 'notice', type: 'idle_prompt' }),
      ]),
      null,
    );
    expect(shown(items).map(([kind, text]) => [kind, text])).toEqual([
      ['made', 'Workspace made at 94e1feb'],
      ['start', 'Codex started'],
      ['asks', 'Asked: Q? — A · B'],
      ['end', 'Its run completed'],
      ['start', 'Continued'],
      ['end', 'Stopped'],
      ['start', 'Continued'],
      ['end', 'Failed: unexpected status 401'],
    ]);
    expect(items.at(-1)?.failed).toBe(true);
  });

  it("Codex's items on its app server have no time: in their turn's order, shown without one", () => {
    const untimed = { untimed: true as const };
    const items = timelineItems(
      workspace({ agent: { state: 'working', kind: 'codex' } }),
      thread(
        [entry(0, { kind: 'prompt', text: 'P' })],
        [
          tool(0, 0, 'c1', 'command', 'start', { subject: 'cargo build', ...untimed }),
          tool(0, 0, 'c1', 'command', 'end', { subject: 'cargo build', ...untimed }),
          tool(0, 0, 'f1', 'fileChange', 'start', { subject: 'src/lib.rs', ...untimed }),
        ],
      ),
      null,
    );
    expect(shown(items)).toEqual([
      ['made', 'Workspace made from main at 94e1feb', at(0)],
      ['prompt', "Symbiote's prompt", at(0)],
      ['command', 'Ran cargo build', null],
      ['edits', 'Edited src/lib.rs', null],
    ]);
  });

  it('keeps each row its key as new events arrive, a folded row its first', () => {
    const entries = [entry(0, { kind: 'prompt', text: 'P' })];
    const first = [tool(1, 0, 'e1', 'Edit', 'start', { subject: 'a.ts' })];
    const before = timelineItems(workspace(), thread(entries, first), null);
    const after = timelineItems(
      workspace(),
      thread(
        [...entries, entry(3, { kind: 'report', text: 'R' })],
        [...first, tool(2, 0, 'e2', 'Edit', 'start', { subject: 'b.ts' })],
      ),
      null,
    );
    expect(after.slice(0, before.length).map((i) => i.key)).toEqual(before.map((i) => i.key));
    expect(after.map((i) => i.text)).toEqual([
      'Workspace made from main at 94e1feb',
      "Symbiote's prompt",
      'Edited a.ts, b.ts',
      'Reported: R',
    ]);
    expect(new Set(after.map((i) => i.key)).size).toBe(after.length);
  });

  it('names at most three files a row, then how many more', () => {
    const tools = ['a', 'b', 'c', 'd', 'e'].map((name, i) =>
      tool(1, i, name, 'Edit', 'start', { subject: `${name}.ts` }),
    );
    const [, edits] = timelineItems(workspace(), thread([], tools), null);
    expect(edits?.text).toBe('Edited a.ts, b.ts, c.ts and 2 more');
  });

  it('nothing read yet: only the workspace made', () => {
    expect(shown(timelineItems(workspace(), null, null))).toEqual([
      ['made', 'Workspace made from main at 94e1feb', at(0)],
    ]);
  });
});
