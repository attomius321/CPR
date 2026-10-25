import { describe, expect, it } from 'vitest';
import type { McpAsk } from '@symbiote/core';
import { askedBy, askLeft, asksBy } from '../src/shell/asks.js';

const ask = (more: Partial<McpAsk> = {}): McpAsk => ({
  id: 'a1',
  tool: 'queue_merge',
  words: 'Merge fix/a at bbbbbbb into main',
  by: { via: 'scout' },
  at: '2026-10-25T12:00:00.000Z',
  until: '2026-10-25T12:10:00.000Z',
  ...more,
});

describe("an ask of Symbiote's MCP, in words (MC1)", () => {
  it('names who asks: Scout, or an agent through symbiote mcp in its folder', () => {
    expect(askedBy(ask())).toBe('Scout');
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

  it('says whether Scout asks: its sidenav mark', () => {
    expect(asksBy([ask()], 'scout')).toBe(true);
    expect(asksBy([ask({ by: { via: 'mcp' } })], 'scout')).toBe(false);
    expect(asksBy([], 'scout')).toBe(false);
  });
});
