import { describe, expect, it } from 'vitest';
import { nameOf, offWords, onRefusal } from '../src/settings/hive-switch.js';

describe("Hive's switch, in words (HV4, decisions 771, 772)", () => {
  it('says what Hive off does to each step in flight, and what on again does', () => {
    expect(offWords('writing')).toBe('its agent is stopped; on again, Hive tells it to continue');
    expect(offWords('checking')).toBe('its check is stopped; on again, the check runs again');
    expect(offWords('reviewing')).toBe(
      'its review is stopped and its copy deleted; on again, a new review',
    );
    expect(offWords('landing')).toMatch(/^its landing goes on: the merge queue checks, lands/);
  });

  it('refuses to turn on while a workspace is in normal mode, and says what to do', () => {
    expect(onRefusal({ normal: [] })).toBeNull();
    expect(onRefusal({ normal: [{ branch: 'feature/a' }] })).toBe(
      'Hive cannot turn on while a workspace is in normal mode. Land it or clean it up first:',
    );
    expect(onRefusal({ normal: [{ branch: 'a' }, { branch: 'b' }] })).toMatch(
      /^Hive cannot turn on while these workspaces are in normal mode\. Land them/,
    );
  });

  it('names a workspace by its title, else its branch', () => {
    expect(nameOf({ branch: 'feature/a', title: 'A' })).toBe('A');
    expect(nameOf({ branch: 'feature/a' })).toBe('feature/a');
  });
});
