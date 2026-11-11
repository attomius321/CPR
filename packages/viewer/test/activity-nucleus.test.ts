// Nucleus's Activity tab (NU2): its activity file's lines read into the workspace tab's events and
// grouped into its phases and milestones; the workspace's own grouping unchanged.
import { describe, expect, it } from 'vitest';
import type { NucleusActivityLine, NucleusCall, WorkspaceAgentState } from '@symbiote/core';
import {
  nucleusEvents,
  nucleusRawLines,
  type ActivityEvent,
  type ToolCall,
} from '../src/workspaces/activity/events.js';
import { activityGroups } from '../src/workspaces/activity/groups.js';
import { liveActivity } from '../src/workspaces/activity/live.js';
import { phaseOf, statusWords, tokensText } from '../src/workspaces/activity/words.js';
import { nucleusAgent } from '../src/nucleus/page-agent.js';

const ROOT = '/home/ada/app';
const at = (s: number) => new Date(Date.UTC(2026, 9, 30, 10, 0, 0) + s * 1000).toISOString();
const of = { conversation: 'c1', agent: 'claude' as const };

/** A call's lines from Claude Code's hooks: its start (with the gate's decision) and its end. */
function call(
  id: string,
  s: number,
  tool: string,
  {
    start = {},
    end = {},
    ms = 400,
  }: { start?: Partial<NucleusCall>; end?: Partial<NucleusCall> | null; ms?: number } = {},
): NucleusCall[] {
  const head = { session: 'c1', ...of, id, tool };
  const first: NucleusCall = {
    at: at(s),
    ...head,
    phase: 'start',
    gate: { decision: 'allow' },
    ...start,
  };
  if (end === null) return [first];
  return [first, { at: at(s + ms / 1000), ...head, phase: 'end', ms, ...end }];
}

/** Symbiote's own record of a call of its tools (`mcp.ts`). */
function symbiote(
  id: string,
  s: number,
  tool: string,
  input: string,
  end: Partial<NucleusCall> = {},
) {
  const head = { session: 'symbiote', id, tool, source: 'symbiote' as const };
  return [
    { at: at(s), ...head, phase: 'start' as const, input },
    { at: at(s + 1), ...head, phase: 'end' as const, ms: 1000, ...end },
  ];
}

const working: WorkspaceAgentState = { state: 'working', kind: 'claude' };
const done: WorkspaceAgentState = { state: 'done', kind: 'claude' };
const calls = (events: ActivityEvent[]) =>
  events.flatMap((e) => (e.kind === 'call' ? [e.call] : []));
const callOf = (events: ActivityEvent[], id: string) =>
  calls(events).find((c) => c.id === id) as ToolCall;

const conversation: NucleusActivityLine[] = [
  { at: at(0), ...of, kind: 'opened', model: 'opus', effort: 'high' },
  { at: at(1), ...of, kind: 'start', source: 'startup' },
  { at: at(2), ...of, kind: 'prompt', text: 'What changed, and what is new in Vite?' },
  ...call('t1', 3, 'Bash', {
    start: { subject: 'git log --oneline -5', input: 'git log --oneline -5' },
    end: { output: 'abc first' },
  }),
  ...call('t2', 4, 'Read', { start: { subject: 'README.md' } }),
  ...call('t3', 5, 'Bash', {
    start: {
      subject: 'curl https://example.com',
      input: 'curl https://example.com',
      gate: { decision: 'deny', reason: 'curl: only git runs' },
    },
    end: null,
  }),
  ...call('t4', 6, 'WebSearch', {
    start: { subject: 'vite latest' },
    end: { links: [{ title: 'Vite 8', url: 'https://vite.dev/blog' }] },
  }),
  ...call('t5', 8, 'WebFetch', {
    start: { subject: 'https://vite.dev/blog' },
    end: {
      pages: [{ url: 'https://vite.dev/blog', code: 200, bytes: 3926 }],
      output: 'Vite 8.3.5',
    },
  }),
  ...call('t6', 10, 'mcp__symbiote__workspaces', { start: { input: '{}' }, ms: 2000 }),
  ...symbiote('m1-a', 10.5, 'workspaces', '{}', { output: '{"workspaces":[]}' }),
  ...call('t7', 13, 'mcp__symbiote__queue_merge', {
    start: { input: '{"branch":"fix/a"}' },
    ms: 9000,
  }),
  ...symbiote('m2-b', 13.2, 'queue_merge', '{"branch":"fix/a"}', {
    failed: true,
    output: 'The person declined: Merge fix/a into main. Nothing was done.',
  }),
  {
    at: at(13.3),
    kind: 'confirm',
    ask: 'a1',
    tool: 'queue_merge',
    words: 'Merge fix/a into main',
    call: 'm2-b',
    stage: 'asked',
    until: at(613),
  },
  {
    at: at(20),
    kind: 'confirm',
    ask: 'a1',
    tool: 'queue_merge',
    words: 'Merge fix/a into main',
    call: 'm2-b',
    stage: 'ended',
    answer: 'declined',
    ms: 6700,
  },
  {
    at: at(25),
    ...of,
    kind: 'report',
    text: 'Two commits; Vite 8.3.5.',
    tokens: { input: 40, cached: 9000, cacheWrite: 960, output: 1100 },
    ms: 23_000,
  },
  { at: at(30), ...of, kind: 'renewed' },
];

describe('nucleusEvents (NU2)', () => {
  const events = nucleusEvents(conversation);

  it('a call its gate refused ended at its start, refused, with the reason', () => {
    expect(callOf(events, 't3')).toMatchObject({
      failed: true,
      refused: 'curl: only git runs',
      startedAt: at(5),
      endedAt: at(5),
      gate: { decision: 'deny' },
    });
    expect(callOf(events, 't3').ms).toBeUndefined();
  });

  it("Symbiote's record of a call paired with the agent's: one call, its answer beside", () => {
    expect(calls(events).map((c) => c.id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7']);
    expect(callOf(events, 't6').symbiote).toMatchObject({
      id: 'm1-a',
      output: '{"workspaces":[]}',
      ms: 1000,
    });
    expect(callOf(events, 't7').symbiote?.id).toBe('m2-b');
  });

  it('its kinds of work: the web, Symbiote; the rest as a workspace classifies them', () => {
    const kinds = Object.fromEntries(
      calls(events).map((c) => [c.id, phaseOf({ key: '', kind: 'call', call: c })]),
    );
    expect(kinds).toEqual({
      t1: 'explore',
      t2: 'explore',
      // A read-only command, as a workspace classifies it: refused, it stays in its phase.
      t3: 'explore',
      t4: 'web',
      t5: 'web',
      t6: 'symbiote',
      t7: 'symbiote',
    });
  });

  it('two alike at once are not paired: each shown, never guessed', () => {
    const lines = [
      ...call('x1', 0, 'mcp__symbiote__workspaces', { start: { input: '{}' }, ms: 3000 }),
      ...call('x2', 0.5, 'mcp__symbiote__workspaces', { start: { input: '{}' }, ms: 3000 }),
      ...symbiote('s1', 1, 'workspaces', '{}'),
    ];
    const shown = calls(nucleusEvents(lines));
    expect(shown.map((c) => c.id)).toEqual(['x1', 'x2', 's1']);
    expect(shown.every((c) => !c.symbiote)).toBe(true);
  });

  it("pairs Codex's MCP item by its server and tool", () => {
    const lines: NucleusActivityLine[] = [
      {
        at: at(0),
        session: 'th',
        conversation: 'th',
        agent: 'codex',
        id: 'mc1',
        tool: 'mcp',
        subject: 'symbiote.workspaces',
        phase: 'start',
      },
      ...symbiote('s1', 1, 'workspaces', '{}'),
      {
        at: at(4),
        session: 'th',
        conversation: 'th',
        agent: 'codex',
        id: 'mc1',
        tool: 'mcp',
        subject: 'symbiote.workspaces',
        phase: 'end',
      },
    ];
    expect(calls(nucleusEvents(lines))).toMatchObject([{ id: 'mc1', symbiote: { id: 's1' } }]);
  });

  it("a Codex item seen late starts when Symbiote's record of it does, before its Confirm", () => {
    const item = { session: 'th', conversation: 'th', agent: 'codex' as const, id: 'mc9' };
    const head = {
      ...item,
      tool: 'mcp',
      subject: 'symbiote.start_workspace',
      input: '{"kind":"fix"}',
    };
    const lines: NucleusActivityLine[] = [
      ...symbiote('s9', 10, 'start_workspace', '{"kind":"fix"}'),
      {
        at: at(10.5),
        kind: 'confirm',
        ask: 'a9',
        tool: 'start_workspace',
        words: 'Start',
        call: 's9',
        stage: 'asked',
        until: at(610),
      },
      // Read every 2 s: its start and end seen together, after the call ended.
      { at: at(12), ...head, phase: 'start' },
      { at: at(12), ...head, phase: 'end' },
    ];
    const events = nucleusEvents(lines);
    expect(events.map((e) => e.kind)).toEqual(['call', 'confirm']);
    expect(callOf(events, 'mc9').startedAt).toBe(at(10));
  });

  it('a Confirm once, asked and ended, with the call that asked; a compaction once', () => {
    const confirm = events.find((e) => e.kind === 'confirm');
    expect(confirm).toMatchObject({
      key: 'confirm:a1',
      asked: { stage: 'asked' },
      ended: { answer: 'declined' },
      did: { id: 'm2-b' },
    });
    const compacted = nucleusEvents([
      { at: at(0), ...of, kind: 'compact', stage: 'before', trigger: 'auto' },
      { at: at(9), ...of, kind: 'compact', stage: 'after', trigger: 'auto', summary: 'So far…' },
    ]);
    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({
      kind: 'compact',
      before: {},
      after: { summary: 'So far…' },
    });
  });

  it('every line in the raw stream, by where it was recorded', () => {
    const raw = nucleusRawLines(conversation);
    expect(raw).toHaveLength(conversation.length);
    expect(new Set(raw.map((l) => l.source))).toEqual(new Set(['nucleus', 'tool', 'symbiote']));
    expect(raw.find((l) => l.what === 'confirm asked')).toBeDefined();
  });
});

describe("Nucleus's groups (NU2)", () => {
  const groups = activityGroups(nucleusEvents(conversation), {
    agent: done,
    worktree: ROOT,
    nucleus: true,
  });

  it('its milestones and phases in order, in its words', () => {
    expect(groups.map((g) => [g.kind, g.title])).toEqual([
      ['session', 'A conversation opened on Claude Code'],
      ['session', 'Claude Code started'],
      ['message', 'You: What changed, and what is new in Vite?'],
      ['explore', 'Exploration'],
      ['web', 'Web research'],
      ['symbiote', 'Symbiote'],
      ['confirm', 'Confirm: Merge fix/a into main'],
      ['report', 'Answered'],
      ['end', 'New conversation: this one ended'],
    ]);
  });

  it('the refused call stays in sight in its phase, said refused, not failed', () => {
    const explore = groups.find((g) => g.kind === 'explore');
    expect(explore?.summary).toBe('1 file read · 2 commands · 1 refused');
    expect(explore?.failures).toBe(0);
  });

  it("the web's searches and pages, Symbiote's tools, the Confirm's end", () => {
    expect(groups.find((g) => g.kind === 'web')?.summary).toBe('1 search · 1 page');
    const tools = groups.find((g) => g.kind === 'symbiote');
    expect(tools?.summary).toBe('workspaces · queue_merge');
    // The declined call failed by the person's choice: its Confirm says so, not a failure.
    expect(tools?.failures).toBe(0);
    const confirm = groups.find((g) => g.kind === 'confirm');
    expect(confirm?.summary).toBe('queue_merge');
    expect(confirm && statusWords(confirm)).toEqual({ text: 'Declined', tone: 'muted' });
    expect(groups.find((g) => g.title.startsWith('A conversation'))?.summary).toBe(
      'opus · high effort',
    );
  });

  it("an answer's tokens and time", () => {
    const report = groups.find((g) => g.kind === 'report');
    expect(report).toMatchObject({ took: 23_000, tokens: { output: 1100 } });
    expect(tokensText({ input: 40, cached: 9000, cacheWrite: 960, output: 1100 })).toBe(
      '10K in, 90 % cached · 1.1K out',
    );
    expect(tokensText({ input: 300, output: 12 })).toBe('300 in · 12 out');
  });

  it('a Confirm unanswered waits while Nucleus works, and the live strip says so', () => {
    const lines = conversation.filter(
      (l) =>
        'phase' in l ||
        !(
          (l.kind === 'confirm' && l.stage === 'ended') ||
          l.kind === 'report' ||
          l.kind === 'renewed'
        ),
    );
    const events = nucleusEvents(lines);
    const asked = activityGroups(events, { agent: working, worktree: ROOT, nucleus: true });
    expect(asked.find((g) => g.kind === 'confirm')?.status).toBe('waiting');
    expect(liveActivity(working, ROOT, events, asked)).toEqual({
      state: 'waiting',
      text: 'Waiting for your Confirm: Merge fix/a into main',
      since: at(13.3),
    });
    // Nucleus gone with it unanswered: its end was never recorded.
    const later = activityGroups(events, { agent: done, worktree: ROOT, nucleus: true });
    expect(later.find((g) => g.kind === 'confirm')?.status).toBe('open');
  });
});

describe("Nucleus's start without a Confirm (NU8, decision 785)", () => {
  const skipped = (why: 'setting' | 'hive'): NucleusActivityLine[] => [
    {
      at: at(1),
      session: 'symbiote',
      id: 'm1',
      tool: 'start_workspace',
      source: 'symbiote',
      phase: 'start',
    },
    {
      at: at(1.1),
      kind: 'confirm',
      ask: 's1',
      tool: 'start_workspace',
      words: 'Start fix/a, with Claude Code',
      call: 'm1',
      stage: 'skipped',
      why,
    },
    {
      at: at(3),
      session: 'symbiote',
      id: 'm1',
      tool: 'start_workspace',
      source: 'symbiote',
      phase: 'end',
      ms: 2000,
      output: '{"workspace":{"branch":"fix/a"},"withoutConfirm":"setting"}',
    },
  ];

  it('is a milestone of its own, said started without one and why, never waiting', () => {
    for (const [why, said] of [
      ['setting', 'Your setting'],
      ['hive', 'Hive mode'],
    ] as const) {
      const events = nucleusEvents(skipped(why));
      const groups = activityGroups(events, { agent: working, worktree: ROOT, nucleus: true });
      const confirm = groups.find((g) => g.kind === 'confirm');
      expect(confirm?.title).toBe('Started without a Confirm: Start fix/a, with Claude Code');
      expect(confirm?.status).toBe('done');
      expect(confirm?.detail).toContain('fix/a');
      expect(confirm && statusWords(confirm)).toEqual({ text: said, tone: 'muted' });
      // Its call is no failure, and nothing waits for the person.
      expect(groups.find((g) => g.kind === 'symbiote')?.failures).toBe(0);
      expect(liveActivity(working, ROOT, events, groups)?.text ?? '').not.toContain('Confirm');
    }
  });
});

describe('A batch and a lapsed Confirm in the tab (MC3, decisions 989, 994)', () => {
  const confirm = (s: number, fields: Record<string, unknown>) =>
    ({
      at: at(s),
      kind: 'confirm',
      ask: 'a1',
      tool: 'start_workspace',
      words: 'Start 3 workspaces',
      call: 'm1',
      ...fields,
    }) as NucleusActivityLine;
  const asked = confirm(1, {
    stage: 'asked',
    until: at(601),
    items: [
      { name: 'fix/one', words: '“One”, with Claude Code' },
      { name: 'fix/two', words: '“Two”, with Claude Code' },
      {
        name: 'fix/three',
        words: '“Three”, with Claude Code',
        cant: 'a workspace fix/three exists already',
      },
    ],
  });
  const done = confirm(9, {
    stage: 'done',
    items: [
      { name: 'fix/one', outcome: 'done' },
      { name: 'fix/two', outcome: 'failed', error: 'no room' },
      { name: 'fix/three', outcome: 'cant', error: 'a workspace fix/three exists already' },
    ],
  });
  const groupOf = (lines: NucleusActivityLine[]) => {
    const events = nucleusEvents(lines);
    expect(events.filter((e) => e.kind === 'confirm')).toHaveLength(1);
    return activityGroups(events, { agent: working, worktree: ROOT, nucleus: true }).find(
      (g) => g.kind === 'confirm',
    );
  };

  it('a batch is one Confirm, its items and what became of each as its detail', () => {
    const group = groupOf([
      asked,
      confirm(5, { stage: 'ended', answer: 'confirmed', ms: 4000 }),
      done,
    ]);
    expect(group?.title).toBe('Confirm: Start 3 workspaces');
    expect(group && statusWords(group)).toEqual({ text: 'Confirmed', tone: 'ok' });
    expect(group?.detail).toBe(
      'fix/one: started\nfix/two: failed: no room\nfix/three: can’t: a workspace fix/three exists already',
    );
    // Asked and not answered yet: its items as asked.
    expect(groupOf([asked])?.detail).toBe(
      'fix/one: “One”, with Claude Code\nfix/two: “Two”, with Claude Code\nfix/three: can’t: a workspace fix/three exists already',
    );
  });

  it('lapsed, then confirmed late or dismissed: its last end said', () => {
    const expired = confirm(601, { stage: 'ended', answer: 'expired', ms: 600_000 });
    const late = groupOf([
      asked,
      expired,
      confirm(900, { stage: 'ended', answer: 'late', ms: 899_000 }),
      done,
    ]);
    expect(late && statusWords(late)).toEqual({ text: 'Confirmed after it lapsed', tone: 'ok' });
    expect(late?.status).toBe('done');
    expect(late?.detail).toContain('fix/one: started');
    const lapsed = groupOf([asked, expired]);
    expect(lapsed && statusWords(lapsed)).toEqual({
      text: 'No answer in time',
      tone: 'warning',
    });
    const dismissed = groupOf([
      asked,
      expired,
      confirm(900, { stage: 'ended', answer: 'dismissed', ms: 899_000 }),
    ]);
    expect(dismissed && statusWords(dismissed)).toEqual({
      text: 'Dismissed after it lapsed',
      tone: 'muted',
    });
    expect(dismissed?.status).toBe('cancelled');
    const single = groupOf([
      confirm(1, { words: 'Start fix/a', stage: 'asked', until: at(601) }),
      expired,
      confirm(900, { stage: 'ended', answer: 'late', ms: 899_000 }),
      confirm(901, { stage: 'done', error: 'no room' }),
    ]);
    expect(single?.detail).toBe('Failed: no room');
  });
});

describe("Nucleus's conversation as an agent's state (NU2)", () => {
  it.each([
    ['working', { state: 'working', kind: 'codex' }],
    ['needs-you', { state: 'needs-you', kind: 'codex' }],
    ['interrupted', { state: 'needs-you', interrupted: true, kind: 'codex' }],
    ['answered', { state: 'done', kind: 'codex' }],
    ['gone', { state: 'not-running', kind: 'codex' }],
  ] as const)('%s', (state, agent) => {
    expect(nucleusAgent({ kind: 'codex', started: at(0), state })).toEqual(agent);
  });

  it('none without a conversation', () => {
    expect(nucleusAgent(null)).toEqual({ state: 'not-running' });
  });
});
