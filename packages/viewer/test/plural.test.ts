import { describe, expect, it } from 'vitest';
import { plural } from '../src/ui/plural.js';

describe('a count and its word', () => {
  it('is singular for one only', () => {
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(0, 'file')).toBe('0 files');
    expect(plural(2, 'file')).toBe('2 files');
  });

  it('takes the plural given when adding an s is wrong', () => {
    expect(plural(1, 'match', 'matches')).toBe('1 match');
    expect(plural(3, 'match', 'matches')).toBe('3 matches');
  });
});
