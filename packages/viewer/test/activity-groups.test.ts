// The Activity tab's events and phases (V73): the raw records paired and ordered, then grouped into
// phases between milestones. Nothing recorded is changed, dropped or made up.
import { describe, expect, it } from 'vitest';
import type {
  ActivityEntry,
  ThreadEntry,
  WorkspaceAgentState,
  WorkspaceCommit,
  WorkspaceSummary,
  WorkspaceThread,
} from '@symbiote/core';
import { activityEvents, rawLines, type ActivityEvent } from '../src/workspaces/activity/events.js';
import { activityGroups, type ActivityGroup } from '../src/workspaces/activity/groups.js';
import { liveActivity } from '../src/workspaces/activity/live.js';

const W = '/home/ada/app.worktrees/feature-x';
const at = (s: number) => new Date(Date.UTC(2026, 9, 28, 9, 0, s)).toISOString();

const workspace = (over: Partial<WorkspaceSummary> = {}): WorkspaceSummary =>
  ({
    branch: 'feature/x',
    title: 'X',
    kind: 'feature',
    base: 'abcdef1234567',
    from: 'main',
    created: at(0),
    worktree: { path: W, exists: true },
    tip: 'f00',
    ahead: 1,
    merged: false,
    agent: { state: 'done' },
    ...over,
  }) as WorkspaceSummary;

const entry = (s: number, rest: Record<string, unknown>): ThreadEntry =>
  ({ at: at(s), session: 's1', ...rest }) as ThreadEntry;
const thread = (entries: ThreadEntry[], over: Partial<WorkspaceThread> = {}): WorkspaceThread => ({
  entries,
  recorded: true,
  ...over,
});

/** A call's two lines: its start at `s`, its end `ms` later (none when `ms` is null). */
function call(
  id: string,
  s: number,
  tool: string,
  subject: string,
  {
    ms = 500,
    end = {},
    start = {},
  }: {
    ms?: number | null;
    end?: Partial<ActivityEntry>;
    start?: Partial<ActivityEntry>;
  } = {},
): ActivityEntry[] {
  const head = { session: 's1', id, tool, subject };
  const first: ActivityEntry = { at: at(s), ...head, phase: 'start', ...start };
  if (ms === null) return [first];
  return [
    first,
    { at: new Date(Date.parse(at(s)) + ms).toISOString(), ...head, phase: 'end', ms, ...end },
  ];
}
const bash = (id: string, s: number, command: string, over: Parameters<typeof call>[4] = {}) =>
  call(id, s, 'Bash', command.split('\n')[0]!.slice(0, 160), {
    ...over,
    start: { input: command, ...over.start },
  });
const commit = (sha: string, s: number, subject: string): WorkspaceCommit => ({
  sha,
  subject,
  author: 'Ada',
  date: at(s),
});

const groupsOf = (
  tools: ActivityEntry[],
  entries: ThreadEntry[] = [],
  commits: WorkspaceCommit[] = [],
  agent: WorkspaceAgentState = { state: 'done' },
  threadOver: Partial<WorkspaceThread> = {},
) => {
  const w = workspace({ agent });
  return activityGroups(activityEvents(w, thread(entries, threadOver), tools, commits), {
    agent,
    worktree: W,
  });
};
const shape = (groups: ActivityGroup[]) => groups.map((g) => [g.kind, g.status, g.events.length]);

describe('activityEvents (V73)', () => {
  it('pairs a call’s start and end by its ID, whatever order they were written in', () => {
    const [start, end] = call('a', 5, 'Read', 'src/a.ts');
    const events = activityEvents(workspace(), thread([]), [end!, start!], []);
    const calls = events.filter((e) => e.kind === 'call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      key: 'call:a',
      at: at(5),
      call: { id: 'a', tool: 'Read', startedAt: at(5), ms: 500, failed: false },
    });
  });

  it('keeps an end whose start was not read, a start with no end, a line seen twice once', () => {
    const [, endOnly] = call('a', 5, 'Bash', 'ls');
    const [open] = call('b', 6, 'Bash', 'pnpm test');
    const [dupStart, dupEnd] = call('c', 7, 'Read', 'x.ts');
    const events = activityEvents(
      workspace(),
      thread([]),
      [endOnly!, open!, dupStart!, dupStart!, dupEnd!, dupEnd!],
      [],
    );
    const calls = events.flatMap((e) => (e.kind === 'call' ? [e.call] : []));
    expect(calls.map((c) => [c.id, !!c.start, !!c.end])).toEqual([
      ['a', false, true],
      ['b', true, false],
      ['c', true, true],
    ]);
    // An end alone is placed at its own time.
    expect(events.find((e) => e.key === 'call:a')?.at).toBe(endOnly!.at);
  });

  it("the thread, the calls, the commits and the verdict in time order; a call's whole record", () => {
    const tools = bash('b', 3, 'pnpm test', {
      end: { failed: true, exit: 1, output: 'Tests  1 failed (1)' },
    });
    const events = activityEvents(
      workspace(),
      thread(
        [
          entry(1, { kind: 'start', source: 'startup' }),
          entry(2, { kind: 'prompt', text: 'Go' }),
          entry(9, { kind: 'report', text: 'Done' }),
        ],
        { verdict: { at: at(20), event: 'approve', head: 'f00', text: 'OK' } },
      ),
      tools,
      [commit('c0ffee1234', 6, 'Add half')],
    );
    expect(events.map((e) => e.kind)).toEqual([
      'made',
      'start',
      'prompt',
      'call',
      'commit',
      'report',
      'verdict',
    ]);
    const ran = events.find((e) => e.kind === 'call');
    expect(ran?.kind === 'call' && ran.call).toMatchObject({
      input: 'pnpm test',
      exit: 1,
      failed: true,
      output: 'Tests  1 failed (1)',
    });
  });

  it("Codex's items on its app server: no time of their own, in their turn's order", () => {
    const head = { at: at(5), session: 't', untimed: true as const };
    const tools: ActivityEntry[] = [
      { ...head, id: 'x', tool: 'command', subject: 'ls', phase: 'start' },
      { ...head, id: 'x', tool: 'command', subject: 'ls', phase: 'end' },
      { ...head, id: 'y', tool: 'fileChange', subject: 'src/a.rs', phase: 'start' },
      { ...head, id: 'y', tool: 'fileChange', subject: 'src/a.rs', phase: 'end' },
    ];
    const calls = activityEvents(workspace(), thread([]), tools, []).filter(
      (e) => e.kind === 'call',
    );
    expect(calls.map((e) => [e.key, e.at ?? null])).toEqual([
      ['call:x', null],
      ['call:y', null],
    ]);
    expect(calls[0]?.kind === 'call' && calls[0].call.ms).toBeUndefined();
  });

  it('keeps every event its key as new records arrive', () => {
    const entries = [entry(1, { kind: 'prompt', text: 'Go' })];
    const first = call('a', 2, 'Read', 'a.ts', { ms: null });
    const before = activityEvents(workspace(), thread(entries), first, []);
    const after = activityEvents(
      workspace(),
      thread([...entries, entry(9, { kind: 'report', text: 'R' })]),
      [...call('a', 2, 'Read', 'a.ts'), ...call('b', 4, 'Edit', 'a.ts')],
      [commit('c0ffee1234', 5, 'x')],
    );
    expect(after.map((e) => e.key).slice(0, before.length)).toEqual(before.map((e) => e.key));
  });

  it('the raw stream: every line recorded, as recorded, in time order', () => {
    const tools = [...call('a', 3, 'Read', 'a.ts')];
    const lines = rawLines(
      workspace(),
      thread([entry(2, { kind: 'prompt', text: 'Go' }), entry(4, { kind: 'report', text: 'R' })]),
      [...tools, tools[0]!],
      [commit('c0ffee1234', 5, 'x')],
    );
    expect(lines.map((l) => [l.source, l.what])).toEqual([
      ['workspace', 'made'],
      ['thread', 'prompt'],
      ['tool', 'Read start'],
      ['tool', 'Read start'],
      ['tool', 'Read end'],
      ['thread', 'report'],
      ['commit', 'c0ffee1'],
    ]);
    expect(lines[2]?.value).toBe(tools[0]);
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });
});

describe('activityGroups (V73)', () => {
  it('a turn as its phases: exploring, implementing with reads between edits, testing, a commit, a report', () => {
    const tools = [
      ...bash('b1', 3, `cd ${W} && grep -rn half src`),
      ...call('r1', 4, 'Read', 'src/a.ts'),
      ...call('g1', 5, 'Grep', 'half'),
      ...call('e1', 10, 'Edit', 'src/a.ts', { end: { added: 4, removed: 1 } }),
      ...call('r2', 11, 'Read', 'src/b.ts'),
      ...call('t0', 12, 'TaskUpdate', ''),
      ...call('e2', 13, 'Write', 'src/b.ts', { end: { added: 10, removed: 0 } }),
      ...bash('b2', 20, 'pnpm check', {
        end: { output: ' Test Files  3 passed (3)\n      Tests  42 passed (42)' },
      }),
      ...bash('b3', 30, 'git add -A && git commit -q -m "Add half"'),
      ...bash('b4', 32, 'git push -q'),
    ];
    const groups = groupsOf(
      tools,
      [
        entry(2, { kind: 'prompt', text: 'Add half' }),
        entry(40, { kind: 'report', text: 'Done.' }),
      ],
      [commit('c0ffee1234', 30, 'Add half')],
    );
    expect(shape(groups)).toEqual([
      ['made', 'done', 1],
      ['prompt', 'done', 1],
      ['explore', 'done', 3],
      ['implement', 'done', 4],
      ['test', 'done', 1],
      ['commit', 'done', 3],
      ['report', 'done', 1],
    ]);
    const [, , explore, implement, test, done] = groups;
    expect(explore?.summary).toBe('1 file read · 1 search · 1 command');
    expect(implement).toMatchObject({ title: 'Implementation', summary: '2 files · +14 −1' });
    expect(test).toMatchObject({ title: 'Testing', summary: 'pnpm check · 42 passed' });
    expect(done).toMatchObject({
      title: 'Add half',
      sha: 'c0ffee1234',
      summary: 'add · commit · push',
      milestone: true,
    });
    // Times: its first event's start to its last's end.
    expect(implement?.start).toBe(at(10));
    expect(implement?.end).toBe(new Date(Date.parse(at(13)) + 500).toISOString());
  });

  it('a failed test, then edits and a passing run: testing failed, then debugging recovered', () => {
    const tools = [
      ...call('e1', 3, 'Edit', 'src/a.ts'),
      ...bash('t1', 5, 'npx vitest run', {
        end: { failed: true, exit: 1, output: '      Tests  1 failed | 4 passed (5)' },
      }),
      ...call('r1', 8, 'Read', 'src/a.ts'),
      ...call('e2', 9, 'Edit', 'src/a.ts'),
      ...bash('t2', 10, 'npx vitest run', {
        end: { failed: true, exit: 1, output: '      Tests  1 failed | 4 passed (5)' },
      }),
      ...call('e3', 12, 'Edit', 'src/a.ts'),
      ...bash('t3', 14, 'npx vitest run', { end: { output: '      Tests  5 passed (5)' } }),
    ];
    const groups = groupsOf(tools, [entry(2, { kind: 'prompt', text: 'Go' })]);
    expect(shape(groups).slice(2)).toEqual([
      ['implement', 'done', 1],
      ['test', 'failed', 1],
      ['debug', 'recovered', 5],
    ]);
    expect(groups.at(-2)).toMatchObject({
      summary: 'npx vitest run · 1 failed · 4 passed (exit 1)',
    });
    expect(groups.at(-1)).toMatchObject({
      title: 'Debugging',
      summary: 'npx vitest run passed after 2 runs · 2 edits',
    });
  });

  it('a test run piped to tail exits 0: failed all the same when its runner printed failures', () => {
    const tools = bash('t1', 5, 'npm test 2>&1 | tail -60', {
      end: { output: 'ℹ tests 2\nℹ pass 1\nℹ fail 1' },
    });
    const groups = groupsOf(tools, [entry(2, { kind: 'prompt', text: 'Go' })]);
    expect(groups.at(-1)).toMatchObject({
      kind: 'test',
      status: 'failed',
      summary: 'npm test · 1 failed · 1 passed',
    });
  });

  it('a failed test with edits after and no run again: still failing, said so', () => {
    const tools = [
      ...bash('t1', 5, 'pnpm test', { end: { failed: true, exit: 1 } }),
      ...call('e1', 8, 'Edit', 'src/a.ts'),
    ];
    const groups = groupsOf(tools, [entry(2, { kind: 'prompt', text: 'Go' })]);
    expect(shape(groups).slice(2)).toEqual([
      ['test', 'failed', 1],
      ['debug', 'done', 1],
    ]);
    expect(groups.at(-1)?.summary).toBe('pnpm test not run again · 1 edit');
  });

  it('debugging while its test runs again: running, said so', () => {
    const tools = [
      ...bash('t1', 5, 'pnpm test', { end: { failed: true, exit: 1 } }),
      ...call('e1', 8, 'Edit', 'src/a.ts'),
      ...bash('t2', 10, 'pnpm test', { ms: null }),
    ];
    const groups = groupsOf(tools, [entry(2, { kind: 'prompt', text: 'Go' })], [], {
      state: 'working',
    });
    expect(groups.at(-1)).toMatchObject({
      kind: 'debug',
      status: 'running',
      summary: 'pnpm test · running again · 1 edit',
    });
  });

  it('screenshots looked at in a row are visual inspection; one image read among edits is not', () => {
    const tools = [
      ...call('e1', 3, 'Edit', 'src/a.css'),
      ...call('v0', 4, 'Read', '/home/ada/.claude/jobs/1/tmp/a.png'),
      ...call('e2', 5, 'Edit', 'src/a.css'),
      ...bash('v1', 10, 'node .claude/skills/symbiote-style/shots.mjs http://127.0.0.1:4000'),
      ...call('v2', 12, 'Read', '/home/ada/.claude/jobs/1/tmp/dark.png'),
      ...call('v3', 13, 'Read', '/home/ada/.claude/jobs/1/tmp/light.png'),
    ];
    const groups = groupsOf(tools, [entry(2, { kind: 'prompt', text: 'Go' })]);
    expect(shape(groups).slice(2)).toEqual([
      ['implement', 'done', 3],
      ['visual', 'done', 3],
    ]);
    expect(groups.at(-1)).toMatchObject({
      title: 'Visual inspection',
      summary: '2 images · 1 command',
    });
  });

  it('documentation edits are their own phase; a scratch file outside the worktree joins its neighbours', () => {
    const tools = [
      ...call('d1', 3, 'Write', 'docs/plan/v1.md'),
      ...call('d2', 4, 'Edit', 'docs/PLAN.md', { end: { added: 1, removed: 0 } }),
      ...call('x1', 5, 'Write', '/home/ada/.claude/jobs/1/tmp/probe.mjs'),
    ];
    const groups = groupsOf(tools, [entry(2, { kind: 'prompt', text: 'Go' })]);
    expect(shape(groups).slice(2)).toEqual([['docs', 'done', 3]]);
    expect(groups.at(-1)).toMatchObject({ title: 'Documentation', summary: '2 files · +1 −0' });
  });

  it("the agent's task in progress names its phases and splits them where another starts", () => {
    const task = (id: string, s: number, taskId: string, status: string) =>
      call(id, s, 'TaskUpdate', '', { start: { task: { id: taskId, status } } });
    const tools = [
      ...call('c1', 3, 'TaskCreate', '', {
        start: { task: { subject: 'Write the tests' } },
        end: { task: { id: '1', subject: 'Write the tests' } },
      }),
      ...call('c2', 3.5, 'TaskCreate', '', {
        start: { task: { subject: 'Implement it' } },
        end: { task: { id: '2', subject: 'Implement it' } },
      }),
      ...task('u1', 4, '1', 'in_progress'),
      ...call('e1', 5, 'Write', 'test/a.test.ts'),
      ...task('u2', 6, '1', 'completed'),
      ...task('u3', 7, '2', 'in_progress'),
      ...call('e2', 8, 'Edit', 'src/a.ts'),
    ];
    const groups = groupsOf(tools, [entry(2, { kind: 'prompt', text: 'Go' })]);
    expect(groups.slice(2).map((g) => [g.kind, g.task ?? null, g.events.length])).toEqual([
      ['implement', 'Write the tests', 5],
      ['implement', 'Implement it', 2],
    ]);
  });

  it('one commit: the git call that made it and the commit, not two; a commit made elsewhere alone', () => {
    const tools = [
      ...bash('g1', 10, 'git add -A && git commit -q -F - <<EOF\nAdd half\nEOF'),
      ...bash('g2', 40, 'git stash push -u -m x'),
    ];
    const groups = groupsOf(
      tools,
      [entry(2, { kind: 'prompt', text: 'Go' })],
      [commit('aaaaaaa111', 10, 'Add half'), commit('bbbbbbb222', 30, 'From the terminal')],
    );
    expect(groups.slice(2).map((g) => [g.kind, g.title, g.events.map((e) => e.kind)])).toEqual([
      ['commit', 'Add half', ['call', 'commit']],
      ['commit', 'From the terminal', ['commit']],
      ['git', 'Git', ['call']],
    ]);
  });

  it('a call running while the agent works: its phase running; with the agent stopped, no end recorded', () => {
    const tools = [...call('r1', 3, 'Read', 'a.ts'), ...bash('t1', 5, 'pnpm check', { ms: null })];
    const prompt = [entry(2, { kind: 'prompt', text: 'Go' })];
    expect(shape(groupsOf(tools, prompt, [], { state: 'working' })).slice(2)).toEqual([
      ['explore', 'done', 1],
      ['test', 'running', 1],
    ]);
    expect(shape(groupsOf(tools, prompt, [], { state: 'stopped' })).slice(2)).toEqual([
      ['explore', 'done', 1],
      ['test', 'open', 1],
    ]);
  });

  it('stopped by the person: the call cancelled, the session’s end said so', () => {
    const tools = bash('t1', 5, 'pnpm test:e2e', {
      end: { failed: true, interrupted: true, output: 'Interrupted' },
    });
    const groups = groupsOf(tools, [
      entry(2, { kind: 'prompt', text: 'Go' }),
      entry(9, { kind: 'end', reason: 'stopped' }),
    ]);
    expect(shape(groups).slice(2)).toEqual([
      ['test', 'cancelled', 1],
      ['end', 'cancelled', 1],
    ]);
    expect(groups.at(-1)?.title).toBe('Stopped');
  });

  it("an ask waits while the agent waits on it; answered once it is not the agent's last", () => {
    const asks = entry(5, {
      kind: 'asks',
      tool: 'AskUserQuestion',
      questions: [{ question: 'Which store?', options: ['A', 'B'] }],
    });
    const waiting = groupsOf([], [entry(2, { kind: 'prompt', text: 'Go' }), asks], [], {
      state: 'needs-you',
    });
    expect(waiting.at(-1)).toMatchObject({
      kind: 'asks',
      status: 'waiting',
      title: 'Asked: Which store?',
      milestone: true,
    });
    const answered = groupsOf(
      [],
      [entry(2, { kind: 'prompt', text: 'Go' }), asks, entry(8, { kind: 'prompt', text: 'A' })],
      [],
      { state: 'working' },
    );
    expect(answered.slice(2).map((g) => [g.kind, g.status, g.title])).toEqual([
      ['asks', 'done', 'Asked: Which store?'],
      ['message', 'done', 'You: A'],
    ]);
  });

  it('an ask a report came after waits no more, though the agent still reads as waiting', () => {
    const asks = entry(5, {
      kind: 'asks',
      tool: 'AskUserQuestion',
      questions: [{ question: 'Which store?', options: ['A'] }],
    });
    const groups = groupsOf(
      [],
      [entry(2, { kind: 'prompt', text: 'Go' }), asks, entry(8, { kind: 'report', text: 'Done' })],
      [],
      { state: 'needs-you' },
    );
    expect(groups.find((g) => g.kind === 'asks')?.status).toBe('done');
  });

  it('the same milestone recorded twice is one; a failed command among reads is counted, not the phase’s end', () => {
    const report = entry(9, { kind: 'report', text: 'Done.' });
    const tools = [
      ...bash('b1', 3, 'cat missing.ts', { end: { failed: true, exit: 1 } }),
      ...call('r1', 4, 'Read', 'a.ts'),
    ];
    const groups = groupsOf(tools, [entry(2, { kind: 'prompt', text: 'Go' }), report, report]);
    // One report, both of its records in it.
    expect(shape(groups).slice(2)).toEqual([
      ['explore', 'done', 2],
      ['report', 'done', 2],
    ]);
    expect(groups[2]?.failures).toBe(1);
  });

  it("Claude Code's notice of a background task is not the person's message; pasted text is said by its words", () => {
    const groups = groupsOf(
      [],
      [
        entry(2, { kind: 'prompt', text: 'Go' }),
        entry(5, {
          kind: 'prompt',
          text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Background command "Run e2e" completed (exit code 0)</summary>\n</task-notification>',
        }),
        entry(6, {
          kind: 'prompt',
          text: '<task-notification> <task-id>b2</task-id> </task-notification>',
        }),
        entry(8, {
          kind: 'prompt',
          text: '<pasted_content id="b66d">\n FAIL  packages/a.test.ts\n</pasted_content>\nfix it',
        }),
      ],
    );
    expect(groups.slice(2).map((g) => [g.kind, g.milestone, g.title])).toEqual([
      ['notice', false, 'Background command "Run e2e" completed (exit code 0)'],
      ['notice', false, 'A background task ended'],
      ['message', true, 'You: FAIL  packages/a.test.ts'],
    ]);
  });

  it('a Codex run that failed: its end failed, in its words', () => {
    const groups = groupsOf(
      [],
      [
        entry(2, { kind: 'prompt', text: 'Go', run: 'r1' }),
        entry(9, { kind: 'end', reason: 'model refused\nmore', run: 'r1' }),
      ],
    );
    expect(groups.at(-1)).toMatchObject({
      kind: 'end',
      status: 'failed',
      title: 'Failed: model refused',
    });
  });

  it('every event once, in one group, in time order', () => {
    const tools = [
      ...call('r1', 3, 'Read', 'a.ts'),
      ...call('e1', 4, 'Edit', 'a.ts'),
      ...bash('t1', 5, 'pnpm test'),
      ...call('x1', 6, 'Mystery', ''),
    ];
    const entries = [
      entry(2, { kind: 'prompt', text: 'Go' }),
      entry(9, { kind: 'report', text: 'R' }),
    ];
    const w = workspace();
    const events = activityEvents(w, thread(entries), tools, []);
    const groups = activityGroups(events, { agent: w.agent, worktree: W });
    const grouped: ActivityEvent[] = groups.flatMap((g) => g.events);
    expect(grouped.map((e) => e.key)).toEqual(events.map((e) => e.key));
  });

  it("a question's call and Codex's reasoning are the raw stream's: the question has its milestone", () => {
    const tools = [
      ...call('r1', 3, 'Read', 'a.ts'),
      ...call('q1', 4, 'AskUserQuestion', ''),
      ...call('x1', 5, 'reasoning', ''),
    ];
    const groups = groupsOf(tools, [entry(2, { kind: 'prompt', text: 'Go' })]);
    expect(shape(groups).slice(2)).toEqual([['explore', 'done', 1]]);
  });

  it('keeps each group its key as events arrive, so an opened group stays open', () => {
    const prompt = [entry(2, { kind: 'prompt', text: 'Go' })];
    const first = [...call('r1', 3, 'Read', 'a.ts'), ...call('e1', 4, 'Edit', 'a.ts')];
    const before = groupsOf(first, prompt, [], { state: 'working' });
    const after = groupsOf(
      [...first, ...call('r2', 5, 'Read', 'b.ts'), ...call('e2', 6, 'Edit', 'b.ts')],
      prompt,
      [],
      { state: 'working' },
    );
    expect(after.map((g) => g.key)).toEqual(before.map((g) => g.key));
    // The read before the first edit and the one between the edits are the implementation's.
    expect(after.at(-1)?.events).toHaveLength(4);
  });

  it('hundreds of calls stay a few dozen phases, quickly', () => {
    const tools: ActivityEntry[] = [];
    let s = 3;
    for (let round = 0; round < 25; round++) {
      for (let i = 0; i < 8; i++) tools.push(...call(`r${round}-${i}`, s++, 'Read', `src/${i}.ts`));
      for (let i = 0; i < 6; i++) {
        tools.push(...call(`e${round}-${i}`, s++, 'Edit', `src/${i}.ts`));
        tools.push(...bash(`g${round}-${i}`, s++, `grep -n x src/${i}.ts`));
      }
      tools.push(...bash(`t${round}`, s++, 'pnpm check'));
    }
    const started = performance.now();
    const groups = groupsOf(tools, [entry(2, { kind: 'prompt', text: 'Go' })]);
    const took = performance.now() - started;
    expect(tools.length / 2).toBe(525);
    expect(groups.length).toBeLessThanOrEqual(80);
    expect(took).toBeLessThan(200);
  });
});

// V74: `kind`, the running phase's, colours the strip as its group.
describe('liveActivity (V73)', () => {
  const prompt = [entry(2, { kind: 'prompt', text: 'Go' })];
  const live = (tools: ActivityEntry[], agent: WorkspaceAgentState, entries = prompt) => {
    const w = workspace({ agent });
    const events = activityEvents(w, thread(entries), tools, []);
    return liveActivity(w.agent, W, events, activityGroups(events, { agent, worktree: W }));
  };

  it('while it works: the call running, in the agent’s words, its command short, since its start', () => {
    const tools = [
      ...call('r1', 3, 'Read', 'a.ts'),
      ...bash('t1', 5, `cd ${W} && pnpm check`, {
        ms: null,
        start: { about: 'Run the full check' },
      }),
    ];
    expect(live(tools, { state: 'working' })).toEqual({
      state: 'working',
      phase: 'Testing',
      kind: 'test',
      text: 'Run the full check',
      command: 'pnpm check',
      since: at(5),
    });
  });

  it('nothing running: thinking since the last call ended; Codex’s untimed items give no time', () => {
    expect(live(call('r1', 3, 'Read', 'a.ts'), { state: 'working' })).toEqual({
      state: 'thinking',
      text: 'Thinking',
      since: new Date(Date.parse(at(3)) + 500).toISOString(),
    });
    expect(live([], { state: 'working' })).toEqual({
      state: 'thinking',
      text: 'Thinking',
      since: at(2),
    });
    const untimed: ActivityEntry = {
      at: at(3),
      session: 't',
      id: 'x',
      tool: 'command',
      subject: 'cargo test',
      phase: 'start',
      untimed: true,
    };
    expect(live([untimed], { state: 'working' })).toEqual({
      state: 'working',
      phase: 'Testing',
      kind: 'test',
      text: 'Running cargo test',
      command: 'cargo test',
    });
  });

  it('a call left open in an earlier turn is not what runs now', () => {
    const tools = bash('old', 1, 'pnpm dev', { ms: null });
    expect(live(tools, { state: 'working' })).toMatchObject({ state: 'thinking' });
  });

  it('waiting: what it asks, with no animation; finished or stopped: nothing', () => {
    const asks = entry(5, {
      kind: 'asks',
      tool: 'AskUserQuestion',
      questions: [{ question: 'Which store?', options: ['A'] }],
    });
    expect(live([], { state: 'needs-you' }, [...prompt, asks])).toEqual({
      state: 'waiting',
      text: 'Asks: Which store?',
      since: at(5),
    });
    // An ask its turn's report came after: not what it waits on now.
    expect(
      live([], { state: 'needs-you', waitingFor: 'input' }, [
        ...prompt,
        asks,
        entry(8, { kind: 'report', text: 'Done' }),
      ]),
    ).toEqual({ state: 'waiting', text: 'Waiting: input' });
    expect(live([], { state: 'plan-ready' })).toEqual({
      state: 'waiting',
      text: 'Plan ready: read it and answer',
    });
    expect(live([], { state: 'done' })).toBeNull();
    expect(live([], { state: 'stopped' })).toBeNull();
  });
});
