import type { ScoutConversation } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { headChoices, newConversation, nextScoutMark, scoutStateText } from '../src/scout/scout.js';

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

describe('Scout as a terminal (V50)', () => {
  const conversation = (fields: Partial<ScoutConversation> = {}): ScoutConversation => ({
    kind: 'claude',
    started: '2026-10-25T09:00:00.000Z',
    state: 'ready',
    id: 's9',
    ...fields,
  });
  const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const claude = {
    kind: 'claude' as const,
    efforts: { levels: LEVELS },
    models: [
      { id: 'opus', name: 'Opus 5.5', efforts: { levels: LEVELS } },
      { id: 'sonnet', name: 'Sonnet 5.5', efforts: { levels: ['low', 'high'] } },
      { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
    ],
  };

  it('says a conversation asked nothing yet is ready, and marks nothing for it', () => {
    expect(scoutStateText(conversation())).toBe('Ready: ask in its terminal');
    expect(nextScoutMark(null, 'ready', false)).toBeNull();
    expect(nextScoutMark('working', 'ready', false)).toBeNull();
  });

  it("shows the conversation's model and level, the levels its model takes", () => {
    const head = headChoices(claude, conversation({ model: 'sonnet', effort: 'high' }), {
      model: 'opus',
      effort: 'medium',
    });
    expect(head.model).toBe('sonnet');
    expect(head.models.map((m) => m.value)).toEqual([
      '',
      'opus',
      'sonnet',
      'claude-haiku-4-5-20251001',
    ]);
    expect(head.effort).toBe('high');
    expect(head.efforts.map((e) => e.value)).toEqual(['', 'low', 'high']);
    // On its defaults: the agent's own, whatever the project says.
    expect(headChoices(claude, conversation(), { model: 'opus', effort: 'medium' })).toMatchObject({
      model: '',
      effort: '',
    });
    // A model that takes no level: no Effort.
    expect(
      headChoices(claude, conversation({ model: 'claude-haiku-4-5-20251001' }), {}).efforts,
    ).toEqual([]);
  });

  it("shows the project's, where its agent lists them, before a conversation", () => {
    expect(headChoices(claude, null, { model: 'sonnet', effort: 'high' })).toMatchObject({
      model: 'sonnet',
      effort: 'high',
    });
    // Sonnet takes no medium here; Codex lists no sonnet.
    expect(headChoices(claude, null, { model: 'sonnet', effort: 'medium' }).effort).toBe('');
    expect(headChoices(claude, null, { model: 'gpt-6-luna' }).model).toBe('');
    // Not read yet: nothing to pick.
    expect(headChoices(undefined, null, {})).toEqual({
      models: [],
      model: '',
      efforts: [],
      effort: '',
    });
  });
});

describe("Scout's head picks the next conversation (V52)", () => {
  const conversation = (fields: Partial<ScoutConversation> = {}): ScoutConversation => ({
    kind: 'claude',
    started: '2026-10-25T09:00:00.000Z',
    state: 'answered',
    id: 's9',
    ...fields,
  });
  const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const claude = {
    kind: 'claude' as const,
    efforts: { levels: LEVELS },
    models: [
      { id: 'opus', name: 'Opus 5.5', efforts: { levels: LEVELS } },
      { id: 'sonnet', name: 'Sonnet 5.5', efforts: { levels: ['low', 'high'] } },
      { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
    ],
  };
  const codex = {
    kind: 'codex' as const,
    efforts: { levels: ['low', 'medium', 'high'], default: 'medium' },
    models: [{ id: 'gpt-6-luna', name: 'GPT-6-Luna' }],
    defaultModel: { id: 'gpt-6-luna', by: 'agent' as const },
  };
  const opusMedium = conversation({ model: 'opus', effort: 'medium' });

  it("shows what was picked over the conversation's, the levels following the model picked", () => {
    const head = headChoices(claude, opusMedium, {}, { model: 'sonnet', effort: 'high' });
    expect(head).toMatchObject({ model: 'sonnet', effort: 'high' });
    expect(head.efforts.map((e) => e.value)).toEqual(['', 'low', 'high']);
    // Only a level: on the conversation's model.
    expect(headChoices(claude, opusMedium, {}, { effort: 'max' })).toMatchObject({
      model: 'opus',
      effort: 'max',
    });
    // Before a conversation, over the project's.
    expect(
      headChoices(claude, null, { model: 'opus', effort: 'medium' }, { effort: 'xhigh' }),
    ).toMatchObject({ model: 'opus', effort: 'xhigh' });
  });

  it("keeps the level shown when a model picked takes it, else the agent's own", () => {
    const high = conversation({ model: 'opus', effort: 'high' });
    expect(headChoices(claude, high, {}, { model: 'sonnet' }).effort).toBe('high');
    expect(headChoices(claude, opusMedium, {}, { model: 'sonnet' }).effort).toBe('');
    // A level picked, then a model without it, then one with it again: the pick comes back.
    expect(headChoices(claude, opusMedium, {}, { model: 'sonnet', effort: 'max' }).effort).toBe('');
    expect(headChoices(claude, opusMedium, {}, { model: 'opus', effort: 'max' }).effort).toBe(
      'max',
    );
  });

  it("says when New conversation starts on other choices than this conversation's, and which", () => {
    const same = newConversation(
      { kind: 'claude', ...headChoices(claude, opusMedium, {}) },
      opusMedium,
    );
    expect(same.differs).toBe(false);
    expect(same.title).toBe(
      "Ends this conversation (its session is stopped and removed) and starts another on this one's agent, model and effort",
    );

    const sonnet = newConversation(
      {
        kind: 'claude',
        ...headChoices(claude, opusMedium, {}, { model: 'sonnet', effort: 'high' }),
      },
      opusMedium,
    );
    expect(sonnet.differs).toBe(true);
    expect(sonnet.title).toBe(
      'Ends this conversation (on Opus 5.5 at medium; its session is stopped and removed) and starts another on Sonnet 5.5 at high, as picked here',
    );
    // The agent's own, in its words.
    expect(
      newConversation(
        { kind: 'claude', ...headChoices(claude, opusMedium, {}, { model: '', effort: '' }) },
        opusMedium,
      ).title,
    ).toContain("starts another on Claude Code's default at its default level, as picked here");
  });

  it('says another agent, at its own choices', () => {
    const next = newConversation({ kind: 'codex', ...headChoices(codex, null, {}) }, opusMedium);
    expect(next.differs).toBe(true);
    expect(next.title).toBe(
      "Ends this conversation (Claude Code's; its session is stopped and removed) and starts another with Codex, on Codex's default (GPT-6-Luna) at its default level, as picked here",
    );
  });

  it('compares only what the head shows: no models or levels read, no difference by them', () => {
    expect(
      newConversation({ kind: 'claude', ...headChoices(undefined, null, {}) }, opusMedium).differs,
    ).toBe(false);
    // Haiku takes no level: its conversation's is not compared.
    const haiku = conversation({ model: 'claude-haiku-4-5-20251001', effort: 'high' });
    expect(
      newConversation({ kind: 'claude', ...headChoices(claude, haiku, {}) }, haiku).differs,
    ).toBe(false);
  });
});
