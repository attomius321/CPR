import type { ScoutConversation } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { nextScoutMark, runsOn, scoutStateText } from '../src/scout/scout.js';

describe("the sidenav's mark for Scout (V35, decision 238)", () => {
  it('says working while Scout answers, wherever the person is', () => {
    expect(nextScoutMark(null, 'working', false)).toBe('working');
    expect(nextScoutMark(null, 'working', true)).toBe('working');
  });

  it('says answered when an answer came while the person was on another page, until Scout is opened', () => {
    let mark = nextScoutMark(null, 'working', false);
    mark = nextScoutMark(mark, 'answered', false);
    expect(mark).toBe('answered');
    expect(nextScoutMark(mark, 'answered', false)).toBe('answered');
    expect(nextScoutMark(mark, 'answered', true)).toBeNull();
    // Seen on Scout as it ended: nothing to say after.
    expect(nextScoutMark(nextScoutMark(null, 'working', true), 'answered', true)).toBeNull();
    // An answer that was there before: no mark.
    expect(nextScoutMark(null, 'answered', false)).toBeNull();
  });

  it('counts a turn that waits on the person as an answer, and forgets a conversation that ended', () => {
    expect(nextScoutMark('working', 'needs-you', false)).toBe('answered');
    expect(nextScoutMark('working', 'interrupted', false)).toBe('answered');
    expect(nextScoutMark('answered', undefined, false)).toBeNull();
    expect(nextScoutMark('working', 'gone', false)).toBeNull();
  });
});

describe("Scout's state in words", () => {
  const conversation = (state: ScoutConversation['state']): ScoutConversation => ({
    kind: 'claude',
    started: '2026-10-22T09:00:00.000Z',
    state,
    id: 's9',
  });

  it('says what it does, and what the person can do', () => {
    expect(scoutStateText(conversation('working'))).toBe('Answering');
    expect(scoutStateText(conversation('answered'))).toBe('Answered: ask more in its terminal');
    expect(scoutStateText(conversation('interrupted'))).toBe('Interrupted: waiting for you');
    expect(scoutStateText(conversation('stopped'))).toBe(
      'Stopped: its terminal continues the conversation',
    );
    expect(scoutStateText(conversation('gone'))).toBe(
      'Its session is gone: start a new conversation',
    );
    expect(scoutStateText({ ...conversation('unknown'), error: 'no list' })).toBe(
      'Unknown: no list',
    );
  });
});

// V77 (decision 561): the page shows what the conversation runs on; Settings sets it.
describe('what a page agent runs on, in its line', () => {
  const MODELS = [
    { id: 'sonnet', name: 'Sonnet 5.5' },
    { id: 'claude-opus-4-6', name: 'Opus 4.6' },
  ];

  it('names the agent, the model by its name in the list, and the level', () => {
    expect(runsOn('claude', { model: 'sonnet', effort: 'high' }, MODELS)).toBe(
      'with Claude Code on Sonnet 5.5 at high effort',
    );
    expect(runsOn('codex', { effort: 'low' }, undefined)).toBe('with Codex at low effort');
  });

  it("says a model by its ID when the list has none, and leaves the agent's own unsaid", () => {
    expect(runsOn('claude', { model: 'claude-sonnet-4-5-20250929' }, MODELS)).toBe(
      'with Claude Code on claude-sonnet-4-5-20250929',
    );
    expect(runsOn('claude', { model: 'sonnet' }, undefined)).toBe('with Claude Code on sonnet');
    expect(runsOn('claude', {}, MODELS)).toBe('with Claude Code');
    // Before a conversation: the agent that will run it.
    expect(runsOn('claude', null, MODELS)).toBe('with Claude Code');
  });
});
