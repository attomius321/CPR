import type { ScoutConversation } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { nextScoutMark, scoutStateText } from '../src/scout.js';

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
