import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import type { CodexThread, CodexTurn } from '../src/app-server.js';
import { codexLines, rolloutTokens, seenOf } from '../src/nucleus-codex.js';

const SEEN_AT = '2026-10-30T10:00:30.000Z';
const start = Date.parse('2026-10-30T10:00:00.000Z') / 1000;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

const thread = (turns: CodexTurn[], status = 'idle'): CodexThread => ({
  id: 'th1',
  createdAt: start,
  updatedAt: start,
  status,
  turns,
});
const of = { session: 'th1', conversation: 'th1', agent: 'codex' };

const running: CodexTurn = {
  id: 'turn-1',
  status: 'inProgress',
  startedAt: start,
  prompts: ['What is new in Vite?'],
  items: [
    {
      id: 'ws1',
      kind: 'webSearch',
      subject: 'vite latest release',
      web: { queries: ['vite latest release'], pages: [] },
    },
    {
      id: 'ex1',
      kind: 'command',
      subject: 'git log --oneline -3',
      status: 'completed',
      command: 'git log --oneline -3',
      exit: 0,
      ms: 40,
      output: 'abc first',
    },
    {
      id: 'mc1',
      kind: 'mcp',
      subject: 'symbiote.workspaces',
      status: 'inProgress',
      mcp: { args: '{"state":"all"}' },
    },
  ],
};

describe("Codex's thread as Nucleus's activity (NU2, decision 606)", () => {
  it('a running turn: its prompt, its items seen now, the running ones started only', () => {
    const seen = new Set<string>();
    const lines = codexLines(thread([running], 'active'), seen, SEEN_AT, new Map());
    expect(lines).toEqual([
      {
        at: iso(start),
        conversation: 'th1',
        agent: 'codex',
        turn: 'turn-1',
        kind: 'prompt',
        text: 'What is new in Vite?',
      },
      // A web search has no status: running while it is a running turn's last item, else done.
      {
        at: SEEN_AT,
        ...of,
        id: 'ws1',
        tool: 'webSearch',
        subject: 'vite latest release',
        phase: 'start',
      },
      {
        at: SEEN_AT,
        ...of,
        id: 'ws1',
        tool: 'webSearch',
        subject: 'vite latest release',
        phase: 'end',
      },
      {
        at: SEEN_AT,
        ...of,
        id: 'ex1',
        tool: 'command',
        subject: 'git log --oneline -3',
        phase: 'start',
        input: 'git log --oneline -3',
      },
      {
        at: SEEN_AT,
        ...of,
        id: 'ex1',
        tool: 'command',
        subject: 'git log --oneline -3',
        phase: 'end',
        ms: 40,
        exit: 0,
        output: 'abc first',
      },
      {
        at: SEEN_AT,
        ...of,
        id: 'mc1',
        tool: 'mcp',
        subject: 'symbiote.workspaces',
        phase: 'start',
        input: '{"state":"all"}',
      },
    ]);
    // Read again: nothing new.
    expect(codexLines(thread([running], 'active'), seen, SEEN_AT, new Map())).toEqual([]);
  });

  it("the turn's end: what was left, a page opened, the answer with its time and tokens", () => {
    const seen = new Set<string>();
    codexLines(thread([running], 'active'), seen, SEEN_AT, new Map());
    const done: CodexTurn = {
      ...running,
      status: 'completed',
      completedAt: start + 40,
      ms: 40_000,
      report: 'Vite 8.3.5.',
      final: true,
      items: [
        ...(running.items ?? []).map((item) =>
          item.id === 'mc1'
            ? {
                ...item,
                status: 'completed',
                mcp: { ...item.mcp, answer: '{"workspaces":[]}', ms: 12 },
              }
            : item,
        ),
        {
          id: 'ws2',
          kind: 'webSearch',
          subject: 'https://vite.dev/releases',
          web: { queries: [], pages: ['https://vite.dev/releases'] },
        },
      ],
    };
    const tokens = new Map([['turn-1', { input: 100, cached: 900, output: 50, reasoning: 10 }]]);
    const at = '2026-10-30T10:00:45.000Z';
    expect(codexLines(thread([done]), seen, at, tokens)).toEqual([
      {
        at,
        ...of,
        id: 'mc1',
        tool: 'mcp',
        subject: 'symbiote.workspaces',
        phase: 'end',
        ms: 12,
        output: '{"workspaces":[]}',
      },
      {
        at,
        ...of,
        id: 'ws2',
        tool: 'webSearch',
        subject: 'https://vite.dev/releases',
        phase: 'start',
      },
      {
        at,
        ...of,
        id: 'ws2',
        tool: 'webSearch',
        subject: 'https://vite.dev/releases',
        phase: 'end',
        pages: [{ url: 'https://vite.dev/releases' }],
      },
      {
        at: iso(start + 40),
        conversation: 'th1',
        agent: 'codex',
        turn: 'turn-1',
        kind: 'report',
        text: 'Vite 8.3.5.',
        ms: 40_000,
        tokens: { input: 100, cached: 900, output: 50, reasoning: 10 },
      },
    ]);
  });

  it('a turn first read once over: its items untimed at its start; interrupted, failed, compacted', () => {
    const seen = new Set<string>();
    const turns: CodexTurn[] = [
      {
        id: 'turn-a',
        status: 'interrupted',
        startedAt: start,
        completedAt: start + 5,
        prompts: ['Look'],
        items: [
          { id: 'ex9', kind: 'command', subject: 'git status', status: 'completed', exit: 0 },
        ],
      },
      {
        id: 'turn-b',
        status: 'failed',
        startedAt: start + 10,
        completedAt: start + 11,
        error: 'unexpected status 401',
        prompts: ['Again'],
        compactions: ['cc1'],
        items: [],
      },
    ];
    const lines = codexLines(thread(turns), seen, SEEN_AT, new Map());
    expect(lines.map((l) => ('kind' in l ? l.kind : `${l.tool} ${l.phase}`))).toEqual([
      'prompt',
      'command start',
      'command end',
      'interrupted',
      'prompt',
      'compact',
      'error',
    ]);
    expect(lines[1]).toMatchObject({ at: iso(start), untimed: true });
    expect(lines[3]).toEqual({
      at: iso(start + 5),
      conversation: 'th1',
      agent: 'codex',
      turn: 'turn-a',
      kind: 'interrupted',
    });
    expect(lines[5]).toMatchObject({ kind: 'compact', stage: 'after', turn: 'turn-b' });
    expect(lines[6]).toMatchObject({ kind: 'error', error: 'unexpected status 401' });
  });

  it('what the file already holds is not written again, after a restart', () => {
    const first = new Set<string>();
    const lines = codexLines(thread([running], 'active'), first, SEEN_AT, new Map());
    const seen = seenOf(lines, 'th1');
    expect(codexLines(thread([running], 'active'), seen, SEEN_AT, new Map())).toEqual([]);
    expect(seenOf(lines, 'another').size).toBe(0);
  });
});

describe("a Codex turn's tokens from its session file", () => {
  it('the total at its end less the total before it; cached input apart', async () => {
    const file = join(tempDir(), 'rollout.jsonl');
    const count = (at: number, input: number, cached: number, output: number, reasoning = 0) =>
      JSON.stringify({
        timestamp: new Date(at * 1000).toISOString(),
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: input,
              cached_input_tokens: cached,
              output_tokens: output,
              reasoning_output_tokens: reasoning,
              total_tokens: input + output,
            },
          },
        },
      });
    writeFileSync(
      file,
      [
        count(start - 100, 1000, 800, 20),
        '{"type":"response_item"}',
        count(start + 3, 1500, 1100, 40, 5),
        count(start + 9, 2100, 1600, 70, 9),
        count(start + 60, 9999, 9999, 999),
      ].join('\n'),
    );
    const tokens = await rolloutTokens(file, [
      { id: 'turn-1', status: 'completed', startedAt: start, completedAt: start + 10, prompts: [] },
      { id: 'turn-0', status: 'inProgress', startedAt: start + 50, prompts: [] },
    ]);
    expect(tokens).toEqual(
      new Map([['turn-1', { input: 300, cached: 800, output: 50, reasoning: 9 }]]),
    );
    expect(await rolloutTokens(join(tempDir(), 'none.jsonl'), [])).toEqual(new Map());
  });
});
