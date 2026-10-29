import type { AgentEfforts } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { stopOf, stopWord } from '../src/workspaces/effort.js';
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
    expect(stopWord({ value: 'low', label: 'low' })).toBe('Low');
    expect(stopWord({ value: 'max', label: 'max' })).toBe('Max');
  });

  // V63 (decision 456): the mockup's words, an x before a level kept as it is.
  it('capitalises a level as the mockup does: xHigh', () => {
    expect(stopWord({ value: 'xhigh', label: 'xhigh' })).toBe('xHigh');
    expect(stopWord({ value: 'minimal', label: 'minimal' })).toBe('Minimal');
    expect(stopWord({ value: 'ultra', label: 'ultra' })).toBe('Ultra');
  });
});
