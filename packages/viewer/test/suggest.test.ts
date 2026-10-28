import type { AgentOption, WorkspaceSuggestion } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  proposalWords,
  proposedChoices,
  suggestBlocked,
  withProposal,
} from '../src/workspaces/suggest.js';

const all = { levels: ['low', 'medium', 'high', 'xhigh', 'max'] };
const claude: AgentOption = {
  kind: 'claude',
  command: 'claude',
  permissionMode: 'default',
  efforts: all,
  models: [
    { id: 'opus', name: 'Opus 5.5', efforts: all },
    { id: 'haiku', name: 'Haiku 5.5', efforts: all },
    {
      id: 'claude-opus-4-6',
      name: 'Opus 4.6',
      efforts: { levels: ['low', 'medium', 'high', 'max'] },
    },
  ],
};

const suggestion = (fields: Partial<WorkspaceSuggestion> = {}): WorkspaceSuggestion => ({
  agent: 'claude',
  model: 'opus',
  effort: 'high',
  planFirst: true,
  why: 'Moves storage to SQLite with a migration: large, with a risk to data.',
  by: { model: 'haiku', name: 'Haiku 5.5', effort: 'low' },
  ...fields,
});

describe('Suggest settings', () => {
  it('waits for an agent with a list, the brief, and no start under way', () => {
    const ready = { agent: claude, main: 'Move the records.', heading: 'Goal', running: false };
    expect(suggestBlocked(ready)).toBeNull();
    expect(suggestBlocked({ ...ready, main: '  ' })).toBe('Write the goal first');
    expect(suggestBlocked({ ...ready, main: '', heading: 'What happens' })).toBe(
      'Write what happens first',
    );
    expect(suggestBlocked({ ...ready, agent: null })).toBe('No agent is installed');
    expect(suggestBlocked({ ...ready, agent: { kind: 'hermes' } })).toBe(
      'Hermes lists no models to suggest from',
    );
    expect(suggestBlocked({ ...ready, agent: { kind: 'codex' } })).toBe(
      'Codex lists no models Symbiote can read',
    );
    expect(suggestBlocked({ ...ready, running: true })).toBe('A start is under way');
  });

  it('says who suggests what, by the names the agent lists', () => {
    const current = { planFirst: true };
    expect(proposalWords(suggestion(), claude, current)).toEqual({
      words: 'Haiku 5.5 suggests Opus 5.5 at high effort, plan first',
      same: false,
    });
    expect(
      proposalWords(
        suggestion({
          model: undefined,
          effort: undefined,
          planFirst: false,
          by: { model: 'default', name: "Claude Code's default" },
        }),
        claude,
        current,
      ).words,
    ).toBe("Claude Code suggests Claude Code's default model at its default level, no plan first");
  });

  it('names a level the model does not take as its default, as accepting would hold it', () => {
    const odd = suggestion({ model: 'claude-opus-4-6', effort: 'xhigh' });
    expect(proposedChoices(odd, claude)).toEqual({ model: 'claude-opus-4-6', planFirst: true });
    expect(proposalWords(odd, claude, { planFirst: true }).words).toBe(
      'Haiku 5.5 suggests Opus 4.6 at its default level, plan first',
    );
  });

  it('knows when the cards already hold it', () => {
    expect(
      proposalWords(suggestion(), claude, { model: 'opus', effort: 'high', planFirst: true }).same,
    ).toBe(true);
    expect(proposalWords(suggestion(), claude, { model: 'opus', planFirst: true }).same).toBe(
      false,
    );
  });

  it('accepted, sets the model, the level and plan first, and nothing else of the run', () => {
    const run = {
      agent: 'claude' as const,
      model: 'haiku',
      effort: 'low',
      permissionMode: 'auto' as const,
      planFirst: false,
      from: 'main',
    };
    expect(withProposal(run, suggestion(), claude)).toEqual({
      ...run,
      model: 'opus',
      effort: 'high',
      planFirst: true,
    });
    // "default": the pick goes, so the agent's default model and level apply.
    expect(withProposal(run, suggestion({ model: undefined, effort: undefined }), claude)).toEqual({
      agent: 'claude',
      permissionMode: 'auto',
      planFirst: true,
      from: 'main',
    });
  });
});
