import { describe, expect, it } from 'vitest';
import type { McpAsk } from '@symbiote/core';
import {
  askedAt,
  askedBy,
  askLeft,
  lapsedWords,
  asksBy,
  askTally,
  confirmWords,
  itemState,
  shownAsk,
  waitsForPerson,
} from '../src/shell/asks.js';

const ask = (more: Partial<McpAsk> = {}): McpAsk => ({
  id: 'a1',
  tool: 'queue_merge',
  words: 'Merge fix/a at bbbbbbb into main',
  by: { via: 'nucleus' },
  at: '2026-10-25T12:00:00.000Z',
  until: '2026-10-25T12:10:00.000Z',
  ...more,
});

describe("an ask of Symbiote's MCP, in words (MC1)", () => {
  it('names who asks: Nucleus, or an agent through symbiote mcp in its folder', () => {
    expect(askedBy(ask())).toBe('Nucleus');
    expect(
      askedBy(ask({ by: { via: 'mcp', client: 'claude-code', folder: '/home/p/trial' } })),
    ).toBe('Claude Code in trial');
    expect(askedBy(ask({ by: { via: 'mcp', client: 'codex-mcp-client' } }))).toBe('Codex');
    expect(askedBy(ask({ by: { via: 'mcp', client: 'my-agent', folder: '/x/y/' } }))).toBe(
      'my-agent in y',
    );
    expect(askedBy(ask({ by: { via: 'mcp' } }))).toBe('An agent');
  });

  it('says how long it waits for an answer, in minutes rounded up', () => {
    const at = (iso: string) => new Date(iso).getTime();
    expect(askLeft(ask(), at('2026-10-25T12:00:05.000Z'))).toBe('10 min left');
    expect(askLeft(ask(), at('2026-10-25T12:08:30.000Z'))).toBe('2 min left');
    expect(askLeft(ask(), at('2026-10-25T12:09:10.000Z'))).toBe('under a minute left');
    expect(askLeft(ask(), at('2026-10-25T12:09:40.000Z'))).toBe('under a minute left');
    expect(askLeft(ask(), at('2026-10-25T12:11:00.000Z'))).toBe('under a minute left');
  });

  it('says whether Nucleus asks: its sidenav mark', () => {
    expect(asksBy([ask()], 'nucleus')).toBe(true);
    expect(asksBy([ask({ by: { via: 'mcp' } })], 'nucleus')).toBe(false);
    expect(asksBy([], 'nucleus')).toBe(false);
  });
});

describe('a batch, its results and a lapsed ask, in words (MC3, decisions 988, 994)', () => {
  const items: McpAsk['items'] = [
    { id: 'i1', name: 'fix/one', words: '“One”, with Claude Code' },
    { id: 'i2', name: 'fix/two', words: '“Two”, with Claude Code' },
    { id: 'i3', name: 'fix/three', words: '“Three”', cant: 'a workspace fix/three exists already' },
  ];
  const batch = (more: Partial<McpAsk> = {}) =>
    ask({ id: 'b1', tool: 'start_workspace', words: 'Start 3 workspaces', items, ...more });

  it('shows first an ask being done, then the oldest that waits, then results to read, then lapsed ones', () => {
    const waiting = ask({ id: 'w' });
    const later = ask({ id: 'w2', at: '2026-10-25T12:05:00.000Z' });
    const doing = batch({ id: 'd', stage: 'doing' });
    const done = batch({ id: 'r', stage: 'done' });
    const lapsed = ask({ id: 'l', stage: 'lapsed' });
    expect(shownAsk([lapsed, done, later, waiting, doing])?.id).toBe('d');
    expect(shownAsk([lapsed, done, later, waiting])?.id).toBe('w');
    expect(shownAsk([lapsed, done])?.id).toBe('r');
    expect(shownAsk([lapsed])?.id).toBe('l');
    expect(shownAsk([])).toBeUndefined();
  });

  it('counts as waiting for the person an ask that waits or lapsed, not one being done or done', () => {
    expect(
      [undefined, 'lapsed', 'doing', 'done'].map((stage) =>
        waitsForPerson(ask(stage ? { stage: stage as McpAsk['stage'] } : {})),
      ),
    ).toEqual([true, true, false, false]);
    expect(asksBy([ask({ stage: 'doing' })], 'nucleus')).toBe(false);
    expect(asksBy([ask({ stage: 'lapsed' })], 'nucleus')).toBe(true);
  });

  it("says each row's state in its tool's words", () => {
    const state = (
      outcome: NonNullable<McpAsk['items']>[number]['outcome'],
      tool = 'start_workspace',
    ) => itemState(tool, { id: 'i1', name: 'fix/one', words: '', ...(outcome ? { outcome } : {}) });
    expect(state(undefined)).toBeNull();
    expect(state('running')).toEqual({ tone: 'run', word: 'Starting' });
    expect(state('done')).toEqual({ tone: 'ok', word: 'Started' });
    expect(state('done', 'clean_workspace')).toEqual({ tone: 'ok', word: 'Cleaned up' });
    expect(state('running', 'clean_workspace')).toEqual({ tone: 'run', word: 'Cleaning up' });
    expect(state('failed')).toEqual({ tone: 'error', word: 'Failed' });
    expect(state('declined')).toEqual({ tone: 'idle', word: 'Declined' });
    expect(state('cant')).toEqual({ tone: 'idle', word: 'Can’t' });
  });

  it('tallies a batch being done and done', () => {
    const doing = batch({
      stage: 'doing',
      items: [
        { ...items[0]!, outcome: 'done' },
        { ...items[1]!, outcome: 'running' },
        { ...items[2]!, outcome: 'cant' },
      ],
    });
    expect(askTally(doing)).toBe('1 of 2 started');
    const done = batch({
      stage: 'done',
      items: [
        { ...items[0]!, outcome: 'done' },
        { ...items[1]!, outcome: 'failed', error: 'no room' },
        { ...items[2]!, outcome: 'cant' },
      ],
    });
    expect(askTally(done)).toBe('1 started, 1 failed, 1 can’t');
    expect(askTally(batch({ stage: 'done', tool: 'clean_workspace' }))).toBe('');
    expect(askTally(ask())).toBe('');
  });

  it('names the primary by what it does: Confirm, or Confirm and the number ticked', () => {
    expect(confirmWords(ask(), 0)).toBe('Confirm');
    expect(confirmWords(batch(), 2)).toBe('Confirm 2');
    expect(confirmWords(batch(), 0)).toBe('Confirm');
  });

  it('says how long a lapsed ask waited, from its own times', () => {
    expect(lapsedWords(ask({ stage: 'lapsed' }))).toBe('No answer in 10 minutes: nothing done yet');
    expect(lapsedWords(ask({ stage: 'lapsed', until: '2026-10-25T12:00:01.500Z' }))).toBe(
      'No answer in time: nothing done yet',
    );
  });

  it('says when a lapsed ask was asked, in the clock given', () => {
    expect(askedAt(ask(), (d) => d.toISOString().slice(11, 16))).toBe('12:00');
  });
});
