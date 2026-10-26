import type { WorkspaceAgentState } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  hermes,
  hermesArgs,
  hermesEntries,
  hermesState,
  hermesTools,
  parseHermesEfforts,
  parseHermesExport,
  parseSessionIds,
  type HermesMessage,
  type HermesSession,
} from '../src/hermes.js';
import type { Run } from '../src/programs.js';
import type { WorkspaceFile } from '../src/workspace-record.js';

/** `hermes chat --help` of Hermes 0.21.3 at 80 columns: the options around `--reasoning`. */
const CHAT_HELP = `usage: hermes chat [-h] [-q QUERY | --query-file PATH] [--oneshot]
                   [--image IMAGE] [-m MODEL] [-t TOOLSETS]
                   [--reasoning LEVEL] [-s SKILLS] [--provider PROVIDER] [-v]

Start an interactive chat session with Hermes Agent

options:
  -h, --help            show this help message and exit
  -m MODEL, --model MODEL
                        Model to use (e.g., anthropic/claude-sonnet-4)
  -t TOOLSETS, --toolsets TOOLSETS
                        Comma-separated toolsets to enable
  --reasoning LEVEL     Reasoning effort for this session: none, minimal, low,
                        medium, high, xhigh, max, or ultra. Overrides
                        agent.reasoning_effort for this run only (same levels
                        as the /reasoning slash command).
  -s SKILLS, --skills SKILLS
                        Preload one or more skills for the session (repeat
                        flag or comma-separate)
`;

/** `hermes sessions list --workspace <folder>` as Hermes 0.21.3 prints it (titles made up). */
const SESSIONS_LIST = `Title                        Workspace          Last Active   ID
──────────────────────────────────────────────────────────────────────────────
Add a CSV export             feature-csv        2m ago        20261026_101430_6ffcdc
Feature: csv export          feature-csv        1h ago        20261026_091502_a1b2c3
  … more not shown (use --limit 10 to see more)
`;

const WORKTREE = '/repo.worktrees/feature-csv';

/** A session as `parseHermesExport` gives one, its messages oldest first. */
function session(messages: HermesMessage[], extra: Partial<HermesSession> = {}): HermesSession {
  return { id: '20261026_101430_6ffcdc', cwd: WORKTREE, startedAt: 1793002473, messages, ...extra };
}
const user = (content: string, at = 1793002472.5): HermesMessage => ({ role: 'user', content, at });
const answer = (content: string, at = 1793002480): HermesMessage => ({
  role: 'assistant',
  content,
  at,
  finish: 'stop',
});
const step = (at: number, ...calls: { id: string; name: string; args: string }[]) =>
  ({
    role: 'assistant',
    content: '',
    at,
    finish: 'tool_calls',
    toolCalls: calls.map((call) => ({ id: call.id, name: call.name, arguments: call.args })),
  }) satisfies HermesMessage;
const result = (id: string, name: string, at: number): HermesMessage => ({
  role: 'tool',
  content: '{"output": "ok"}',
  at,
  toolCallId: id,
  toolName: name,
});

function workspace(extra: Partial<WorkspaceFile> = {}): WorkspaceFile {
  return {
    agent: { kind: 'hermes', started: '2026-10-26T10:14:30.000Z' },
    base: 'a'.repeat(40),
    branch: 'feature/csv',
    brief: 'Add a CSV export',
    created: '2026-10-26T10:14:29.000Z',
    planFirst: true,
    worktree: WORKTREE,
    ...extra,
  };
}

describe('hermesArgs (V58)', () => {
  it("starts an interactive session seeded with the prompt, the query in one argument (it may start with '-')", () => {
    expect(hermesArgs({ prompt: '- first, read the brief' })).toEqual([
      'chat',
      '--query=- first, read the brief',
    ]);
  });

  it('continues a session by its ID, with no turn', () => {
    expect(hermesArgs({ session: '20261026_101430_6ffcdc' })).toEqual([
      '--resume',
      '20261026_101430_6ffcdc',
    ]);
  });

  it('gives the level it was started at, on a start and on every resume (a run keeps none)', () => {
    expect(hermesArgs({ prompt: 'Go', effort: 'high' })).toEqual([
      'chat',
      '--query=Go',
      '--reasoning',
      'high',
    ]);
    expect(hermesArgs({ session: 's1', effort: 'low' })).toEqual([
      '--resume',
      's1',
      '--reasoning',
      'low',
    ]);
  });
});

describe('parseHermesEfforts (V58)', () => {
  it("reads `--reasoning`'s levels from `hermes chat --help`, in its order", () => {
    expect(parseHermesEfforts(CHAT_HELP)).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ]);
  });

  it('none without the option, or with anything but words in its list', () => {
    expect(parseHermesEfforts('usage: hermes chat [-h]\n  -m MODEL  Model to use\n')).toBeNull();
    expect(
      parseHermesEfforts('  --reasoning LEVEL     Reasoning effort: low, HIGH; rm -rf, or x.\n'),
    ).toBeNull();
  });
});

describe('parseSessionIds (V58)', () => {
  it("reads the IDs of `hermes sessions list`'s rows, in its order", () => {
    expect(parseSessionIds(SESSIONS_LIST)).toEqual([
      '20261026_101430_6ffcdc',
      '20261026_091502_a1b2c3',
    ]);
  });

  it('none when Hermes found none', () => {
    expect(parseSessionIds('No sessions found.\n')).toEqual([]);
  });
});

describe('parseHermesExport (V58)', () => {
  it('reads a session and its messages from `hermes sessions export --format jsonl`, not rewound or hidden ones', () => {
    const line = JSON.stringify({
      id: '20261026_101430_6ffcdc',
      source: 'cli',
      cwd: WORKTREE,
      started_at: 1793002473.06,
      ended_at: 1793002489.44,
      end_reason: 'cli_close',
      title: 'Add a CSV export',
      messages: [
        { role: 'user', content: 'Add a CSV export', timestamp: 1793002472.57, active: 1 },
        {
          role: 'assistant',
          content: '',
          timestamp: 1793002475.1,
          finish_reason: 'tool_calls',
          active: 1,
          tool_calls: [
            {
              id: 'call_1',
              call_id: 'call_1',
              type: 'function',
              function: { name: 'terminal', arguments: '{"command": "pnpm test"}' },
            },
          ],
        },
        {
          role: 'tool',
          content: '{"exit_code": 0}',
          timestamp: 1793002476.2,
          tool_call_id: 'call_1',
          tool_name: 'terminal',
          active: 1,
        },
        { role: 'assistant', content: 'rewound', timestamp: 1793002477, active: 0 },
        // Hermes's own interface does not show it either.
        {
          role: 'assistant',
          content: '',
          timestamp: 1793002478,
          active: 1,
          display_kind: 'hidden',
        },
        {
          role: 'assistant',
          content: 'Done.',
          timestamp: 1793002480,
          finish_reason: 'stop',
          active: 1,
        },
      ],
    });
    expect(parseHermesExport(`${line}\n`)).toEqual([
      {
        id: '20261026_101430_6ffcdc',
        cwd: WORKTREE,
        startedAt: 1793002473.06,
        endedAt: 1793002489.44,
        endReason: 'cli_close',
        messages: [
          { role: 'user', content: 'Add a CSV export', at: 1793002472.57 },
          {
            role: 'assistant',
            content: '',
            at: 1793002475.1,
            finish: 'tool_calls',
            toolCalls: [{ id: 'call_1', name: 'terminal', arguments: '{"command": "pnpm test"}' }],
          },
          {
            role: 'tool',
            content: '{"exit_code": 0}',
            at: 1793002476.2,
            toolCallId: 'call_1',
            toolName: 'terminal',
          },
          { role: 'assistant', content: 'Done.', at: 1793002480, finish: 'stop' },
        ],
      },
    ]);
  });

  it("skips what is not a session: Hermes's words for a missing one, a broken line", () => {
    expect(
      parseHermesExport(
        'No session \'x\'. Run: hermes sessions list to find the id.\n{"id": 3}\n{broken\n',
      ),
    ).toEqual([]);
  });
});

describe('hermes (V58)', () => {
  /** A fake `run` answering each Hermes command by its arguments; records the calls. */
  function fakeRun(answers: Record<string, string>, calls: string[][] = []): Run {
    return (command, args) => {
      calls.push([command, ...args]);
      const stdout = answers[args.join(' ')];
      return Promise.resolve(
        stdout === undefined
          ? { code: 2, stdout: '', stderr: 'hermes: error: unrecognized arguments' }
          : { code: 0, stdout, stderr: '' },
      );
    };
  }

  it('reads its levels from `chat --help` once', async () => {
    const calls: string[][] = [];
    const agent = hermes('hermes', { run: fakeRun({ 'chat --help': CHAT_HELP }, calls) });
    expect(await agent.efforts()).toEqual({
      levels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    });
    await agent.efforts();
    expect(calls).toEqual([['hermes', 'chat', '--help']]);
  });

  it("lists a folder's sessions and reads one by its ID, open or not", async () => {
    const exported = JSON.stringify({
      id: '20261026_101430_6ffcdc',
      cwd: WORKTREE,
      started_at: 1793002473,
      ended_at: null,
      end_reason: null,
      messages: [],
    });
    const calls: string[][] = [];
    const agent = hermes('/opt/hermes', {
      run: fakeRun(
        {
          [`sessions list --workspace ${WORKTREE} --limit 20`]: SESSIONS_LIST,
          'sessions export --session-id 20261026_101430_6ffcdc --format jsonl -': `${exported}\n`,
          'sessions export --session-id gone --format jsonl -':
            "No session 'gone'. Run: hermes sessions list to find the id.\n",
        },
        calls,
      ),
    });
    expect(await agent.sessions(WORKTREE)).toEqual([
      '20261026_101430_6ffcdc',
      '20261026_091502_a1b2c3',
    ]);
    expect(await agent.read('20261026_101430_6ffcdc')).toEqual({
      id: '20261026_101430_6ffcdc',
      cwd: WORKTREE,
      startedAt: 1793002473,
      messages: [],
    });
    expect(await agent.read('gone')).toBeNull();
    expect(calls.map((call) => call[0])).toEqual(['/opt/hermes', '/opt/hermes', '/opt/hermes']);
  });

  it("rejects with Hermes's words when it cannot list or read", async () => {
    const agent = hermes('hermes', { run: fakeRun({}) });
    await expect(agent.sessions(WORKTREE)).rejects.toThrow(/unrecognized arguments/);
    await expect(agent.read('20261026_101430_6ffcdc')).rejects.toThrow(/unrecognized arguments/);
  });
});

describe('hermesState (V58)', () => {
  const state = (
    read: HermesSession | null | Error,
    running: boolean,
    { ahead = 0, ended = false, file = workspace() } = {},
  ): WorkspaceAgentState => hermesState(file, read, { running, ended, ahead });
  const id = '20261026_101430_6ffcdc';

  it('reads a running Hermes as working until its turn ends: its prompt, a step or a result last', () => {
    expect(state(null, true)).toEqual({ state: 'working', kind: 'hermes' });
    expect(state(session([]), true)).toEqual({ state: 'working', kind: 'hermes', id });
    expect(state(session([user('Go')]), true)).toEqual({ state: 'working', kind: 'hermes', id });
    const calls = { id: 'c1', name: 'terminal', args: '{}' };
    expect(state(session([user('Go'), step(1, calls)]), true).state).toBe('working');
    expect(
      state(session([user('Go'), step(1, calls), result('c1', 'terminal', 2)]), true).state,
    ).toBe('working');
  });

  it("reads a final answer as finished, by the branch's commits and plan first", () => {
    const done = session([user('Go'), answer('Plan: …')]);
    expect(state(done, true)).toEqual({ state: 'plan-ready', kind: 'hermes', id });
    expect(state(done, true, { ahead: 2 })).toEqual({ state: 'ready', kind: 'hermes', id });
    expect(state(done, false, { file: workspace({ planFirst: false }) }).state).toBe('done');
    // A failed or interrupted turn ends with an assistant message too: Hermes waits at its prompt.
    const failed = session([
      user('Go'),
      { role: 'assistant', content: 'Operation interrupted.', at: 2 },
    ]);
    expect(state(failed, true).state).toBe('plan-ready');
  });

  it('reads a Hermes that stopped mid-turn as stopped, and one that ended before a word as failed', () => {
    expect(state(session([user('Go')]), false)).toEqual({ state: 'stopped', kind: 'hermes', id });
    expect(state(null, false, { ended: true })).toEqual({
      state: 'failed',
      kind: 'hermes',
      error:
        'Hermes ended before its first message: start the agent again to see why in its terminal',
    });
    expect(state(null, false)).toEqual({ state: 'not-running', kind: 'hermes' });
  });

  it('says when it did not start, or its session cannot be read', () => {
    expect(
      state(null, false, { file: workspace({ agent: { kind: 'hermes', error: 'no terminals' } }) }),
    ).toEqual({ state: 'not-started', kind: 'hermes', error: 'no terminals' });
    expect(state(new Error('database is locked'), true)).toEqual({
      state: 'unknown',
      kind: 'hermes',
      error: 'Hermes could not read its session: database is locked',
    });
    expect(state(null, false, { file: workspace({ agent: null }) })).toEqual({ state: 'no-agent' });
  });
});

describe('hermesEntries (V58)', () => {
  it("makes V18c's entries of a session: its start, each message given, each final answer, its end", () => {
    const calls = { id: 'c1', name: 'terminal', args: '{"command": "ls"}' };
    const read = session(
      [
        user('Add a CSV export', 1793002472.5),
        step(1793002475, calls),
        result('c1', 'terminal', 1793002476),
        answer('The plan: …', 1793002480),
        user('Go ahead', 1793002500),
        answer('Done.', 1793002560),
      ],
      { endedAt: 1793002600, endReason: 'cli_close' },
    );
    const at = (seconds: number) => new Date(seconds * 1000).toISOString();
    const s = read.id;
    expect(hermesEntries(read)).toEqual([
      { at: at(1793002473), session: s, kind: 'start', source: 'startup' },
      { at: at(1793002472.5), session: s, kind: 'prompt', text: 'Add a CSV export' },
      { at: at(1793002480), session: s, kind: 'report', text: 'The plan: …' },
      { at: at(1793002500), session: s, kind: 'prompt', text: 'Go ahead' },
      { at: at(1793002560), session: s, kind: 'report', text: 'Done.' },
      { at: at(1793002600), session: s, kind: 'end' },
    ]);
  });
});

describe('hermesTools (V58)', () => {
  it("makes each tool call a start and an end at Hermes's times, named as the page words them", () => {
    const read = session([
      user('Go'),
      step(
        1793002475,
        { id: 'c1', name: 'terminal', args: '{"command": "pnpm test\\necho done"}' },
        { id: 'c2', name: 'read_file', args: `{"path": "${WORKTREE}/src/csv.ts"}` },
      ),
      result('c1', 'terminal', 1793002478),
      result('c2', 'read_file', 1793002476),
      step(1793002479, { id: 'c3', name: 'skill_view', args: '{"name": "tdd"}' }),
    ]);
    const at = (seconds: number) => new Date(seconds * 1000).toISOString();
    const s = read.id;
    expect(hermesTools(read, WORKTREE)).toEqual([
      {
        at: at(1793002475),
        session: s,
        id: 'c1',
        tool: 'command',
        subject: 'pnpm test',
        phase: 'start',
      },
      {
        at: at(1793002475),
        session: s,
        id: 'c2',
        tool: 'Read',
        subject: 'src/csv.ts',
        phase: 'start',
      },
      {
        at: at(1793002478),
        session: s,
        id: 'c1',
        tool: 'command',
        subject: 'pnpm test',
        phase: 'end',
      },
      {
        at: at(1793002476),
        session: s,
        id: 'c2',
        tool: 'Read',
        subject: 'src/csv.ts',
        phase: 'end',
      },
      { at: at(1793002479), session: s, id: 'c3', tool: 'skill_view', phase: 'start' },
    ]);
  });
});
