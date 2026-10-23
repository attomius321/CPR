import type { AgentEfforts } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { scoutLevel, stopOf, stopWord } from '../src/workspaces/effort.js';
import { effortChoices } from '../src/workspaces/workspaces.js';

const claude: { kind: 'claude'; efforts: AgentEfforts } = {
  kind: 'claude',
  efforts: { levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
};

describe('the effort stepper (fix/scout-effort-level)', () => {
  it("puts a level at its stop, and anything it does not offer at the agent's default", () => {
    const choices = effortChoices(claude);
    expect(stopOf(choices, '')).toBe(0);
    expect(stopOf(choices, 'low')).toBe(1);
    expect(stopOf(choices, 'max')).toBe(5);
    expect(stopOf(choices, 'ultra')).toBe(0);
    expect(stopOf(choices, undefined)).toBe(0);
  });

  it("names the agent's own level Default under the track, a level by its word", () => {
    expect(stopWord({ value: '', label: "Codex's default (medium)" })).toBe('Default');
    expect(stopWord({ value: 'xhigh', label: 'xhigh' })).toBe('xhigh');
  });
});

describe("Scout's level in its question box (fix/scout-effort-level)", () => {
  it("is the one picked, else the project's when the agent lists it, else the agent's own", () => {
    expect(scoutLevel('low', 'high', claude)).toBe('low');
    // Default picked over the project's level.
    expect(scoutLevel('', 'high', claude)).toBe('');
    expect(scoutLevel(null, 'high', claude)).toBe('high');
    expect(scoutLevel(null, 'ultra', claude)).toBe('');
    expect(scoutLevel(null, undefined, claude)).toBe('');
    // A level picked for another agent that this one does not list.
    expect(scoutLevel('ultra', 'high', claude)).toBe('high');
  });
});
