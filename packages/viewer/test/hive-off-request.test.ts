// HV8: Hive off's question for a Hive workspace whose pull or merge request is open. The server
// names the request for every step in flight (`hiveState`'s `flight`), so the words must still say
// what Hive off does at that step: a writer at work after the person's message or a conflict is
// stopped, as on main, while its request stays open on the forge.
import { describe, expect, it } from 'vitest';
import { offWords } from '../src/settings/hive-switch.js';

describe("Hive off, a workspace's request open (HV8)", () => {
  it('a writer at work while its request is open: its agent is stopped, the request stays open', () => {
    const words = offWords('writing', { forge: 'github', number: 12 });
    expect(words).toContain('its agent is stopped');
    expect(words).toContain('#12');
  });

  it('a check running while its request is open: the check is stopped, the request stays open', () => {
    const words = offWords('checking', { forge: 'gitlab', number: 3 });
    expect(words).toContain('its check is stopped');
    expect(words).toContain('!3');
  });
});
